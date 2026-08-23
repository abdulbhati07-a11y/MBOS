import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/filters/http-exception.filter';

/** Where the Next.js dev server runs, used when CORS_ORIGIN is unset. */
const DEFAULT_CORS_ORIGIN = 'http://localhost:3000';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  // DEBT-013: the per-IP rate limits are only sound if req.ip is trustworthy.
  // Express derives it from X-Forwarded-For only when `trust proxy` is set, so
  // this is configured explicitly and conservatively: default OFF (req.ip is the
  // socket address, forwarded headers ignored), and the blanket `true` — trust
  // every hop, i.e. believe any forged X-Forwarded-For — is rejected outright.
  // In front of a real proxy, set TRUST_PROXY to that proxy's IP/CIDR (or a hop
  // count) so only it can set the client address.
  app.set('trust proxy', resolveTrustProxy(config.get<string>('TRUST_PROXY')));

  // Step 1 of the middleware chain (Section 6.2): security headers, then CORS.
  // Helmet first so its headers are present on every response including the
  // ones CORS or a guard rejects.
  app.use(helmet());

  // `credentials` is required, not optional: the refresh token travels as an
  // httpOnly cookie (Section 6.3), and a browser will not send it on a
  // cross-origin request unless the response allows credentials. The origin is
  // an explicit allow-list rather than a reflection of the request's Origin —
  // reflecting it with credentials enabled would let any site drive the API
  // with the user's cookie.
  app.enableCors({
    origin: (config.get<string>('CORS_ORIGIN') ?? DEFAULT_CORS_ORIGIN)
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
  });

  // Section 6.1: URL versioning only — no Accept-header negotiation.
  app.setGlobalPrefix('api/v1');

  // Refresh tokens travel as an httpOnly cookie (Section 6.3).
  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      // 422, not the default 400: Section 6.1 reserves 400 for malformed
      // bodies and 422 for bodies that parse but fail validation.
      errorHttpStatusCode: 422,
    }),
  );

  app.useGlobalFilters(new ApiExceptionFilter());

  // 3001 so the API does not collide with `next dev` on 3000.
  await app.listen(process.env.PORT ?? 3001);
}
void bootstrap();

/**
 * Turns the TRUST_PROXY env var into an Express `trust proxy` setting.
 *
 *   unset / '' / 'false'  → false        (dev default: trust no proxy)
 *   a positive integer    → that many hops are trusted (nearest-hop count)
 *   anything else         → a comma-separated list of proxy IPs/CIDRs/presets
 *                           (e.g. '10.0.0.0/8' or 'loopback, 172.16.0.1')
 *
 * The literal 'true' is rejected: it tells Express to believe the left-most
 * X-Forwarded-For entry from anyone, which any client can forge, defeating every
 * per-IP limit. Trusting a proxy must be a deliberate, pinned choice.
 */
function resolveTrustProxy(raw: string | undefined): boolean | number | string[] {
  const value = raw?.trim();
  if (value === undefined || value === '' || value.toLowerCase() === 'false') {
    return false;
  }
  if (value.toLowerCase() === 'true') {
    throw new Error(
      "TRUST_PROXY='true' is refused: it trusts a forgeable X-Forwarded-For " +
        'from any client and bypasses the per-IP rate limits (DEBT-013). Set it ' +
        "to the reverse proxy's IP/CIDR or a hop count instead.",
    );
  }
  if (/^\d+$/.test(value)) {
    return Number(value);
  }
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
