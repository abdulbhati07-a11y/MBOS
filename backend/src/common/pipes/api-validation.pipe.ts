import {
  ArgumentMetadata,
  BadRequestException,
  HttpException,
  Injectable,
  ValidationPipe,
} from '@nestjs/common';

/**
 * The one global validation pipe, encoding Section 6.1's split between the two
 * validation failures:
 *
 *   - **422** for a body that parses but fails validation.
 *   - **400** for a malformed query or path parameter.
 *
 * Why this is a subclass rather than a 422 global pipe plus a 400 pipe on each
 * `@Query()`: Nest runs **global pipes before parameter-level pipes**, so a param
 * pipe never sees a value the global pipe has already rejected. The per-parameter
 * approach silently did nothing — `?pageSize=101` answered 422 where Section 6.1
 * promises 400 by name. Branching on `metadata.type` here is the only place the
 * distinction can actually be drawn.
 *
 * The re-thrown 400 keeps class-validator's message array, so ApiExceptionFilter
 * still renders a useful message; `details` stays 422-only, which is what Section
 * 6.1 requires ("`details` is only present on 422").
 */
@Injectable()
export class ApiValidationPipe extends ValidationPipe {
  constructor() {
    super({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      errorHttpStatusCode: 422,
    });
  }

  async transform(
    value: unknown,
    metadata: ArgumentMetadata,
  ): Promise<unknown> {
    try {
      return await super.transform(value, metadata);
    } catch (error) {
      // Bodies keep 422. Anything else — query, param, custom — is a malformed
      // request value, which Section 6.1 codes as 400.
      if (metadata.type === 'body' || !(error instanceof HttpException)) {
        throw error;
      }

      const payload = error.getResponse();
      const message =
        payload !== null && typeof payload === 'object' && 'message' in payload
          ? (payload as { message: string | string[] }).message
          : error.message;

      throw new BadRequestException(message);
    }
  }
}
