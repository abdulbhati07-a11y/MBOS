// ---------------------------------------------------------------------------
// src/lib/api/client.ts
//
// The single place the frontend talks to the API. Every `queries.ts` /
// `mutations.ts` module in this folder goes through `api.get/post/patch/del` —
// nothing else in `src/` should call `fetch` against the backend directly.
//
// What this file owns:
//   - the base URL and query-string encoding
//   - the in-memory access token (see "Token storage" below)
//   - turning the Section 6.1 error envelope into a typed `ApiError`
//   - refreshing an expired access token exactly once, and retrying the request
//
// Talking to the backend cross-origin is deliberate, not incidental:
// `backend/src/main.ts` enables CORS with an explicit origin allow-list and
// `credentials: true` precisely so the browser can reach it on :3001 while the
// refresh cookie rides along. That is why every request below sends
// `credentials: "include"`. Do not "simplify" this into a Next.js rewrite proxy
// without also revisiting that CORS block — the two are one design.
// ---------------------------------------------------------------------------

import type { ApiErrorBody, FieldError } from "./types"

/**
 * The backend sets a global prefix of `api/v1` (Section 6.1: URL versioning
 * only) and listens on 3001 so it does not collide with `next dev` on 3000.
 */
const DEFAULT_BASE_URL = "http://localhost:3001/api/v1"

/** Trailing slashes are stripped so `${BASE}/customers` never doubles up. */
export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_BASE_URL
).replace(/\/+$/, "")

// ---------------------------------------------------------------------------
// Token storage
//
// The access token lives in a module-scoped variable and nowhere else — not
// localStorage, not sessionStorage, not a non-httpOnly cookie. Anything
// persistent is readable by any script that gets injected into the page, and a
// bearer token is replayable for its full 15-minute life.
//
// The cost of this choice is that a full page reload loses the token. That is
// recovered, not worked around: the refresh token is an httpOnly cookie the
// browser still holds, so on boot the session provider calls `POST /auth/refresh`
// to mint a fresh access token. See `src/contexts/session-context.tsx`.
// ---------------------------------------------------------------------------

let accessToken: string | null = null

export function setAccessToken(token: string | null): void {
  accessToken = token
}

export function getAccessToken(): string | null {
  return accessToken
}

/**
 * Called when the session is definitively gone — refresh failed, or the user
 * logged out. Registered by the session provider so it can drop its user state
 * and send the browser to /login without this module importing React.
 */
type AuthFailureHandler = () => void
let onAuthFailure: AuthFailureHandler | null = null

export function setAuthFailureHandler(handler: AuthFailureHandler | null): void {
  onAuthFailure = handler
}

// ---------------------------------------------------------------------------
// ApiError
// ---------------------------------------------------------------------------

/**
 * A non-2xx response, carrying the parsed Section 6.1 envelope.
 *
 * Prefer branching on `code` over `message`: the codes are spec-pinned while the
 * messages are prose and get reworded. `status` is kept too, because 400 vs 422
 * is meaningful here — the backend uses 400 for a bad query parameter and 422
 * for a bad body, including unknown body fields (`forbidNonWhitelisted`).
 */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: FieldError[]
  readonly retryAfter?: number

  constructor(args: {
    status: number
    code: string
    message: string
    details?: FieldError[]
    retryAfter?: number
  }) {
    super(args.message)
    this.name = "ApiError"
    this.status = args.status
    this.code = args.code
    this.details = args.details
    this.retryAfter = args.retryAfter
  }

  /** 422 — the body failed validation. `details` names the offending fields. */
  get isValidation(): boolean {
    return this.status === 422
  }

  /** 403 — authenticated but the role lacks the permission. Not a login prompt. */
  get isForbidden(): boolean {
    return this.status === 403
  }

  /** 409 — a business-rule conflict (duplicate email, illegal status move). */
  get isConflict(): boolean {
    return this.status === 409
  }

  /**
   * Flattens `details` into a `{ [field]: message }` map for react-hook-form's
   * `setError`. Returns an empty object when there are no field errors.
   */
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const detail of this.details ?? []) {
      // First message per field wins; class-validator can emit several.
      if (!(detail.field in out)) out[detail.field] = detail.message
    }
    return out
  }
}

/** Narrowing helper so callers do not import the class just to `instanceof`. */
export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError
}

// ---------------------------------------------------------------------------
// Request plumbing
// ---------------------------------------------------------------------------

export type QueryValue = string | number | boolean | null | undefined

export interface RequestOptions {
  /** Appended as a query string. Empty, null and undefined values are dropped. */
  query?: Record<string, QueryValue>
  /** JSON-serialised into the body. Omit for GET/DELETE. */
  body?: unknown
  signal?: AbortSignal
  /**
   * Skip the Authorization header. Only the auth endpoints need this — they are
   * `@Public()` and, for login, sending a stale bearer token is pointless.
   */
  anonymous?: boolean
  /**
   * Skip the 401 → refresh → retry dance. Set on the auth endpoints themselves
   * so a failed refresh cannot recurse into another refresh.
   */
  noRetry?: boolean
}

/**
 * Builds the query string. Values that are `undefined`, `null` or `""` are
 * omitted rather than sent empty, because the backend validates query params
 * strictly and answers a malformed one with 400 — sending `?search=` where the
 * user simply cleared the search box would be a hard error instead of a no-op.
 */
function encodeQuery(query: Record<string, QueryValue> | undefined): string {
  if (!query) return ""
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue
    params.append(key, String(value))
  }
  const encoded = params.toString()
  return encoded ? `?${encoded}` : ""
}

/**
 * Reads the error envelope off a failed response.
 *
 * Falls back to a synthetic envelope when the body is not the expected shape —
 * a proxy 502 returning HTML, or a network-level failure that never reached the
 * exception filter. Callers get an `ApiError` either way, so no call site has to
 * handle "the error itself failed to parse".
 */
async function toApiError(response: Response): Promise<ApiError> {
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // Non-JSON body — fall through to the synthetic envelope below.
  }

  const envelope = (body as ApiErrorBody | null)?.error
  if (envelope && typeof envelope.code === "string") {
    return new ApiError({
      status: response.status,
      code: envelope.code,
      message: envelope.message || response.statusText,
      details: envelope.details,
      retryAfter: envelope.retryAfter,
    })
  }

  return new ApiError({
    status: response.status,
    code: "ERROR",
    message:
      response.statusText ||
      `Request failed with status ${String(response.status)}`,
  })
}

/**
 * Parses a successful response.
 *
 * 204 is a real outcome here, not an edge case — `POST /auth/logout` and the
 * DELETE endpoints return it — so it resolves to `undefined` rather than
 * throwing on an empty body. The `T` in that case should be `void`.
 */
async function parseBody<T>(response: Response): Promise<T> {
  if (response.status === 204 || response.headers.get("content-length") === "0") {
    return undefined as T
  }
  const text = await response.text()
  if (!text) return undefined as T
  return JSON.parse(text) as T
}

// ---------------------------------------------------------------------------
// Refresh: single-flight
//
// This has to be single-flight, and not merely as an optimisation. The backend
// issues *rotating, single-use* refresh tokens: `POST /auth/refresh` consumes
// the presented token and sets a new cookie. If two requests 401 at the same
// moment — which is the normal case, since a dashboard page fires several
// queries at once and they all expire together — and both called refresh, the
// second would present a token the first had already consumed. The backend
// would reject it as replay, and the whole session would be torn down for no
// reason. So the first 401 starts the refresh, and every concurrent 401 awaits
// that same promise.
// ---------------------------------------------------------------------------

let refreshInFlight: Promise<boolean> | null = null

async function performRefresh(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: "POST",
      credentials: "include",
    })
    if (!response.ok) return false
    const data = await parseBody<{ accessToken?: string }>(response)
    if (!data?.accessToken) return false
    setAccessToken(data.accessToken)
    return true
  } catch {
    // Network failure. Treated as "could not refresh" — the caller surfaces the
    // original 401 rather than a confusing error from the refresh attempt.
    return false
  }
}

/**
 * Refreshes the access token, coalescing concurrent callers onto one request.
 * Resolves true when a new token is in place.
 */
export function refreshAccessToken(): Promise<boolean> {
  refreshInFlight ??= performRefresh().finally(() => {
    refreshInFlight = null
  })
  return refreshInFlight
}

// ---------------------------------------------------------------------------
// The request function
// ---------------------------------------------------------------------------

async function send(
  method: string,
  path: string,
  options: RequestOptions,
): Promise<Response> {
  const headers: Record<string, string> = {}

  // Set only when there is a body. A bare GET needs no Content-Type, and the
  // CORS allow-list is deliberately narrow (`Authorization`, `Content-Type`) —
  // adding headers beyond it would fail preflight.
  const hasBody = options.body !== undefined
  if (hasBody) headers["Content-Type"] = "application/json"

  if (!options.anonymous && accessToken) {
    headers.Authorization = `Bearer ${accessToken}`
  }

  return fetch(`${API_BASE_URL}${path}${encodeQuery(options.query)}`, {
    method,
    headers,
    // Always included: the refresh cookie is scoped to /api/v1/auth, so it only
    // actually travels on the auth routes, but the flag has to be set for the
    // browser to attach it there at all.
    credentials: "include",
    body: hasBody ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  })
}

/**
 * Performs a request and returns the parsed body, throwing `ApiError` on
 * failure.
 *
 * On a 401 it refreshes once and replays the request. A second 401 is final: the
 * auth-failure handler fires and the error propagates, which is what moves the
 * user to /login instead of leaving a page half-loaded.
 */
export async function request<T>(
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  let response = await send(method, path, options)

  if (response.status === 401 && !options.noRetry) {
    const refreshed = await refreshAccessToken()
    if (refreshed) {
      response = await send(method, path, options)
    }
    if (response.status === 401) {
      setAccessToken(null)
      onAuthFailure?.()
      throw await toApiError(response)
    }
  }

  if (!response.ok) throw await toApiError(response)
  return parseBody<T>(response)
}

/**
 * Verb helpers. `del` rather than `delete` because `delete` is a reserved word
 * and cannot be a shorthand method name on the exported object.
 */
export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, "body">) =>
    request<T>("GET", path, options ?? {}),

  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>("POST", path, { ...options, body }),

  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>("PATCH", path, { ...options, body }),

  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>("PUT", path, { ...options, body }),

  del: <T = void>(path: string, options?: Omit<RequestOptions, "body">) =>
    request<T>("DELETE", path, options ?? {}),
}
