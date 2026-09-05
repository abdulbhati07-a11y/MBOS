import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/filters/http-exception.filter';
import { ApiValidationPipe } from './common/pipes/api-validation.pipe';

/**
 * Boot smoke test — the cheapest possible proof that the application actually
 * assembles and serves.
 *
 * This file replaces the Nest scaffold that shipped with the project and was
 * never updated: it asserted `GET /` returns `'Hello World!'`, a string that
 * appears nowhere in `src/`, against a route that does not exist (every
 * controller sits under the `api/v1` global prefix). It also lived in `test/`,
 * outside Jest's `rootDir: "src"`, so `npm test` never collected it and the
 * assertion never ran. Both are fixed: the file now sits beside the other
 * `*.e2e.spec.ts` suites and checks the real health endpoints.
 *
 * What it is for: catching the class of failure where the app cannot start at
 * all — a broken DI graph, a missing provider, a module that throws on init.
 * Every other e2e suite assumes the app boots; this one asserts it.
 *
 * The prefix/pipe/filter wiring below mirrors `src/main.ts`, because
 * `Test.createTestingModule` applies none of it. Only what affects routing and
 * response shape is replicated — helmet, CORS and `trust proxy` are transport
 * concerns that the other suites cover where they matter.
 *
 * Requires the ephemeral e2e database (`npm run test:e2e`): AppModule
 * constructs PrismaService, and the readiness probe genuinely queries.
 */
describe('Application boot (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ApiValidationPipe());
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    // Also exercises the shutdown path: EmbeddingService.onModuleDestroy drains
    // any detached embedding work here, and PrismaService closes its pool.
    await app.close();
  });

  it('serves the liveness probe unauthenticated', async () => {
    const res = await request(app.getHttpServer() as never).get(
      '/api/v1/health',
    );

    expect(res.status).toBe(200);
    expect(res.text).toBe('MBOS API is running');
  });

  it('serves the readiness probe, reporting the database as up', async () => {
    const res = await request(app.getHttpServer() as never).get(
      '/api/v1/health/ready',
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'up' });
  });

  it('404s an unknown route rather than falling through to a handler', async () => {
    const res = await request(app.getHttpServer() as never).get('/api/v1/nope');

    expect(res.status).toBe(404);
  });

  it('has no route at the un-prefixed root', async () => {
    // Guards against the prefix being dropped: the scaffold this file replaced
    // asserted a 200 here, which is what let it rot unnoticed.
    const res = await request(app.getHttpServer() as never).get('/');

    expect(res.status).toBe(404);
  });
});
