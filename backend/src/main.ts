import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/filters/http-exception.filter';

/** Where the Next.js dev server runs, used when CORS_ORIGIN is unset. */
const DEFAULT_CORS_ORIGIN = 'http://localhost:3000';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

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
