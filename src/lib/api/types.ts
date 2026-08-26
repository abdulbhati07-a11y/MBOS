// ---------------------------------------------------------------------------
// src/lib/api/types.ts
//
// Wire types shared by every API module. These mirror the backend contracts
// documented in Section 6.1 and implemented in:
//
//   backend/src/common/dto/pagination.dto.ts   → PaginatedEnvelope, PaginationMeta
//   backend/src/common/filters/http-exception.filter.ts → ApiErrorBody, FieldError
//
// They are hand-mirrored rather than imported: the frontend and backend are
// separate TypeScript projects with separate tsconfigs, and the backend types
// live behind a Nest/Prisma dependency graph the browser bundle must not pull
// in. The pair is small, stable and spec-pinned, so drift is cheap to spot —
// but it IS drift, so any change to the backend DTOs must be echoed here.
// ---------------------------------------------------------------------------

/**
 * Pagination metadata, verbatim from Section 6.1.
 *
 * `pageIndex` is 0-based to match @tanstack/react-table, which is what consumes
 * it. `pageCount` is `Math.ceil(total / pageSize)`, so an empty result set is 0
 * pages rather than 1 — DataTable renders its own empty state and does not need
 * a phantom page to land on.
 */
export interface PaginationMeta {
  pageIndex: number
  pageSize: number
  pageCount: number
  total: number
}

/** Every list endpoint returns this envelope — never a bare array. */
export interface PaginatedEnvelope<T> {
  data: T[]
  pagination: PaginationMeta
}

/** Server-side page size defaults, mirrored so callers can pre-size requests. */
export const DEFAULT_PAGE_SIZE = 10
export const MAX_PAGE_SIZE = 100

/**
 * One field-level validation failure. The backend only emits `details` on 422
 * (Section 6.1 allows it on no other status), and `field` is recovered from the
 * class-validator message prefix, so it is the DTO property name.
 */
export interface FieldError {
  field: string
  message: string
}

/** The single error envelope every non-2xx response uses. */
export interface ApiErrorBody {
  error: {
    code: string
    message: string
    details?: FieldError[]
    /** Seconds to wait; present only on 429, alongside the Retry-After header. */
    retryAfter?: number
  }
}

/**
 * The `code` values the backend's exception filter can produce, keyed by the
 * status that yields them. Useful for `err.code === API_ERROR_CODES.CONFLICT`
 * checks that survive a message rewording.
 */
export const API_ERROR_CODES = {
  BAD_REQUEST: "BAD_REQUEST",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
  INTERNAL_SERVER_ERROR: "INTERNAL_SERVER_ERROR",
  /** Fallback the filter uses for a status it has no mapping for. */
  ERROR: "ERROR",
} as const

export type ApiErrorCode =
  (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES]

// ---------------------------------------------------------------------------
// Auth — mirrors backend/src/auth/dto/auth-response.dto.ts
// ---------------------------------------------------------------------------

export interface AccessTokenResponse {
  accessToken: string
  /** Access-token lifetime in seconds (15 minutes at the time of writing). */
  expiresIn: number
}

export interface MfaRequiredResponse {
  mfaRequired: true
  mfaSessionToken: string
}

/**
 * `POST /auth/login` returns one of two shapes. Discriminate on `mfaRequired`
 * rather than on the presence of `accessToken` — see `isMfaRequired` in
 * `./auth/mutations`.
 */
export type LoginResponse = AccessTokenResponse | MfaRequiredResponse

/**
 * `GET /auth/me`. This is the payload that resolves DEBT-006: `roleName` is the
 * real role the RoleProvider seeds itself from, replacing the hardcoded
 * `initialRole = "Manager"` default.
 */
export interface CurrentUserResponse {
  id: string
  email: string
  roleName: string
  roleId: string
  tenantId: string
  mfaEnabled: boolean
  /**
   * The branch this session's writes are filed against — the tenant's default.
   *
   * Both `POST /orders` and `POST /inventory/adjustments` require a `branchId`,
   * and `GET /branches` needs `settings.read`, which no Cashier holds. Without
   * this field the one role that exists to ring up sales could not name the branch
   * a sale belongs to. It arrives at boot, so no screen has to fetch it.
   *
   * `null` means the tenant has no active branch. Nothing that writes an order or
   * an adjustment can proceed in that state — surface it, do not substitute a
   * guess. See `useOperatingBranch` in `@/contexts/session-context`.
   */
  branchId: string | null
  branchName: string | null
}
