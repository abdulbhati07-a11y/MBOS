import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { ApiExceptionFilter } from './http-exception.filter';

/**
 * Tests for the single error envelope Section 6.1 mandates:
 * `{ error: { code, message, details? } }`.
 *
 * The cases here are the ones where the envelope is load-bearing rather than
 * cosmetic: a client or a monitoring system branches on `code`, so a status that
 * falls through to the generic `'ERROR'` is a silent loss of information.
 */
describe('ApiExceptionFilter', () => {
  const filter = new ApiExceptionFilter();

  /** Minimal ArgumentsHost capturing what the filter writes. */
  const capture = () => {
    const sent: {
      status?: number;
      body?: unknown;
      headers: Record<string, string>;
    } = { headers: {} };
    const response = {
      status(code: number) {
        sent.status = code;
        return response;
      },
      json(body: unknown) {
        sent.body = body;
        return response;
      },
      setHeader(name: string, value: string) {
        sent.headers[name] = value;
      },
    };
    const host = {
      switchToHttp: () => ({ getResponse: () => response }),
    } as unknown as ArgumentsHost;
    return { host, sent };
  };

  const run = (exception: unknown) => {
    const { host, sent } = capture();
    filter.catch(exception, host);
    return sent;
  };

  const bodyOf = (sent: { body?: unknown }) =>
    sent.body as {
      error: { code: string; message: string; details?: unknown[] };
    };

  it.each([
    [HttpStatus.BAD_REQUEST, 'BAD_REQUEST'],
    [HttpStatus.UNAUTHORIZED, 'UNAUTHORIZED'],
    [HttpStatus.FORBIDDEN, 'FORBIDDEN'],
    [HttpStatus.NOT_FOUND, 'NOT_FOUND'],
    [HttpStatus.CONFLICT, 'CONFLICT'],
    [HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_ERROR'],
    [HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMIT_EXCEEDED'],
    [HttpStatus.SERVICE_UNAVAILABLE, 'SERVICE_UNAVAILABLE'],
  ])('maps status %i to code %s', (status, code) => {
    const sent = run(new HttpException('boom', status));

    expect(sent.status).toBe(status);
    expect(bodyOf(sent).error.code).toBe(code);
  });

  it('gives the readiness failure a specific code, not the generic ERROR', () => {
    // AppService.getReadiness throws ServiceUnavailableException with an object
    // payload. Before 503 was mapped, a monitoring system reading `code` learned
    // only 'ERROR' — indistinguishable from any unclassified failure.
    const sent = run(
      new HttpException(
        { status: 'unavailable', db: 'down' },
        HttpStatus.SERVICE_UNAVAILABLE,
      ),
    );

    expect(sent.status).toBe(503);
    expect(bodyOf(sent).error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('lets a thrower name its own code, overriding the status default', () => {
    // Section 6.9 specifies 409 with code INVALID_STATUS_TRANSITION, which the
    // status alone cannot express — a plain 409 is CONFLICT.
    const sent = run(
      new HttpException(
        {
          code: 'INVALID_STATUS_TRANSITION',
          message: 'Draft cannot go to Received',
        },
        HttpStatus.CONFLICT,
      ),
    );

    expect(bodyOf(sent).error.code).toBe('INVALID_STATUS_TRANSITION');
    expect(bodyOf(sent).error.message).toBe('Draft cannot go to Received');
  });

  it('emits details only for 422, the one status the spec allows it on', () => {
    // Nest's ValidationPipe puts an array of strings in `message`; the filter
    // turns each into a `{ field, message }` pair, taking the field from the
    // leading word (class-validator's convention).
    const validationPayload = {
      message: ['email must be an email', 'password is too short'],
    };

    const validation = run(
      new HttpException(validationPayload, HttpStatus.UNPROCESSABLE_ENTITY),
    );
    expect(bodyOf(validation).error.details).toEqual([
      { field: 'email', message: 'email must be an email' },
      { field: 'password', message: 'password is too short' },
    ]);
    // The array is collapsed to a single human-readable line for `message`.
    expect(bodyOf(validation).error.message).toBe('Request validation failed.');

    const conflict = run(
      new HttpException(validationPayload, HttpStatus.CONFLICT),
    );
    expect(bodyOf(conflict).error.details).toBeUndefined();
  });

  it('sets Retry-After as a header and in the body on 429 (RFC 9110)', () => {
    const { host, sent } = capture();
    filter.catch(
      new HttpException(
        {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests.',
          retryAfter: 30,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      ),
      host,
    );

    expect(sent.headers['Retry-After']).toBe('30');
    expect(
      (sent.body as { error: { retryAfter?: number } }).error.retryAfter,
    ).toBe(30);
  });

  it('renders a non-HttpException as 500 without leaking its message', () => {
    // An unexpected throw must not put a stack trace or an internal string on
    // the wire; the generic body is deliberate.
    const sent = run(new Error('DATABASE_URL=postgres://user:secret@host/db'));

    expect(sent.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(bodyOf(sent).error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(JSON.stringify(sent.body)).not.toContain('secret');
  });
});
