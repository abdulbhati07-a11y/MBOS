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
};

/**
 * `getStatus()` returns a plain number, so the enum member is widened once here
 * rather than cast at each comparison site.
 */
const VALIDATION_STATUS: number = HttpStatus.UNPROCESSABLE_ENTITY;

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
        code: CODE_BY_STATUS[status] ?? 'ERROR',
        message: extractMessage(payload, exception.message),
      },
    };

    if (status === VALIDATION_STATUS) {
      const details = extractDetails(payload);
      if (details.length > 0) {
        body.error.details = details;
      }
    }

    response.status(status).json(body);
  }
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
