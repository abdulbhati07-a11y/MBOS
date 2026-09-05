import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

interface FieldError {
  field: string;
  message: string;
}

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: FieldError[];
    retryAfter?: number;
  };
}

/** Maps HTTP status to the `code` string Section 6.1 documents. */
const CODE_BY_STATUS: Readonly<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'VALIDATION_ERROR',
  [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMIT_EXCEEDED',
  // 503 is what the readiness probe raises when the database is unreachable
  // (AppService.getReadiness). Without an entry here it fell through to the
  // generic 'ERROR', which told a monitoring system nothing about *why* the
  // instance was unready.
  [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
};

/**
 * `getStatus()` returns a plain number, so the enum member is widened once here
 * rather than cast at each comparison site.
 */
const VALIDATION_STATUS: number = HttpStatus.UNPROCESSABLE_ENTITY;
const RATE_LIMITED_STATUS: number = HttpStatus.TOO_MANY_REQUESTS;

/**
 * Renders every error in the single envelope Section 6.1 mandates:
 * `{ error: { code, message, details? } }`.
 *
 * `details` is emitted only for 422 — that is the one status the spec allows it
 * on. Unexpected exceptions become a 500 with a generic message; the real error
 * is logged server-side so internals never leak to a client.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (!(exception instanceof HttpException)) {
      this.logger.error('Unhandled exception', exception as Error);
      response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred.',
        },
      } satisfies ErrorBody);
      return;
    }

    const status = exception.getStatus();
    const payload = exception.getResponse();
    const body: ErrorBody = {
      error: {
        // A thrower may name its own code; the status-derived default covers
        // everything else. Section 6.9 needs this — its invalid-transition case
        // is specified as `409` with `code: "INVALID_STATUS_TRANSITION"`, which
        // the status alone cannot express because a plain 409 is `CONFLICT`. A
        // client distinguishing "wrong transition" from "PO number taken" would
        // otherwise have to match on message text.
        //
        // It follows `retryAfter` below: the thrower puts the value in the
        // payload and this filter decides how it reaches the wire, so the
        // envelope still has exactly one author.
        code: extractCode(payload) ?? CODE_BY_STATUS[status] ?? 'ERROR',
        message: extractMessage(payload, exception.message),
      },
    };

    if (status === VALIDATION_STATUS) {
      const details = extractDetails(payload);
      if (details.length > 0) {
        body.error.details = details;
      }
    }

    if (status === RATE_LIMITED_STATUS) {
      const retryAfter = extractRetryAfter(payload);
      if (retryAfter !== undefined) {
        // Both, per Section 6.1: the header because RFC 9110 requires it, and
        // the body field for clients that only read JSON.
        response.setHeader('Retry-After', String(retryAfter));
        body.error.retryAfter = retryAfter;
      }
    }

    response.status(status).json(body);
  }
}

/**
 * An explicit `code` from the thrower, when it supplied one.
 *
 * Constrained to `A-Z0-9_` deliberately. The code is a contract token clients
 * branch on, so this rejects a payload that happens to carry a `code` field
 * meaning something else — a Prisma error code like `P2002`, or a nested DTO
 * property — rather than passing it through as though it were a documented
 * value. Anything rejected falls back to the status-derived default, so a
 * malformed code degrades to a correct generic answer instead of an error.
 */
const CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;

function extractCode(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const code = (payload as { code?: unknown }).code;
  if (typeof code !== 'string' || !CODE_PATTERN.test(code)) return undefined;
  return code;
}

function extractMessage(payload: unknown, fallback: string): string {
  if (typeof payload === 'string') return payload;
  if (payload && typeof payload === 'object') {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return 'Request validation failed.';
  }
  return fallback;
}

/**
 * Pulls the retry hint out of a 429 payload. RateLimitGuard puts it there rather
 * than setting the header itself, so that every error — whatever throws it —
 * still leaves this filter as the single place the wire format is decided.
 */
function extractRetryAfter(payload: unknown): number | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const retryAfter = (payload as { retryAfter?: unknown }).retryAfter;
  if (typeof retryAfter !== 'number' || !Number.isFinite(retryAfter)) {
    return undefined;
  }
  return Math.max(0, Math.ceil(retryAfter));
}

/**
 * ValidationPipe hands us `message: string[]`. Each entry is prefixed with the
 * property name by class-validator, so the field is recoverable without
 * threading the raw ValidationError objects through.
 */
function extractDetails(payload: unknown): FieldError[] {
  if (!payload || typeof payload !== 'object') return [];
  const message = (payload as { message?: unknown }).message;
  if (!Array.isArray(message)) return [];
  return message
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => {
      const field = entry.split(' ')[0];
      return { field, message: entry };
    });
}
