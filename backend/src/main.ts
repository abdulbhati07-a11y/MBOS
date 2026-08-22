import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

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
