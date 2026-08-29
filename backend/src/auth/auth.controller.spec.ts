import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../app.module';
import { ApiExceptionFilter } from '../common/filters/http-exception.filter';
import { PrismaService } from '../prisma/prisma.service';
import { RateLimitConfig } from '../rate-limit/rate-limit.config';
import { REFRESH_COOKIE } from './auth.controller';
import { CurrentUserResponse } from './dto/auth-response.dto';
import { TokenService } from './token.service';

/**
 * End-to-end coverage of the Section 6.3 auth surface, against the seeded dev
 * tenant (`npm run db:seed` must have run for the DATABASE_URL in backend/.env).
 *
 * The app is wired exactly as main.ts wires it — same global prefix, cookie
 * parser, 422 validation pipe and error filter — so what these tests exercise is
 * the shipped request pipeline, not a reduced test harness.
 */
const SEEDED_EMAIL = 'owner@dev.local';
const SEEDED_PASSWORD = 'DevPassw0rd!';

/** Supertest types `body` as `any`; these narrow it at the read site. */
interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: { field: string; message: string }[];
  };
}

interface TokenEnvelope {
  accessToken: string;
  expiresIn: number;
}

const bodyOf = <T>(res: { body: unknown }): T => res.body as T;

describe('AuthController (e2e)', () => {
  // Each login costs a bcrypt(12) comparison plus a round trip to a remote
  // Postgres, so the 5s default is not enough for the multi-request cases.
  jest.setTimeout(30_000);

  let app: INestApplication;
  let prisma: PrismaService;
  let tokens: TokenService;

  const post = (path: string) =>
    request(app.getHttpServer() as never).post(path);
  const get = (path: string) => request(app.getHttpServer() as never).get(path);

  const login = () =>
    post('/api/v1/auth/login').send({
      email: SEEDED_EMAIL,
      password: SEEDED_PASSWORD,
    });

  /** Pulls the `name=value` pair of the refresh cookie out of Set-Cookie. */
  const refreshCookie = (headers: Record<string, unknown>): string => {
    const raw = headers['set-cookie'];
    const all = Array.isArray(raw) ? (raw as string[]) : [];
    const match = all.find((cookie) => cookie.startsWith(`${REFRESH_COOKIE}=`));
    if (!match) {
      throw new Error('Expected a refresh cookie to be set');
    }
    return match.split(';')[0];
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      // This suite logs in a dozen times from one address. Rate limiting is a
      // separate concern with its own coverage in access-control.e2e.spec.ts, so
      // switching it off here keeps these assertions about auth and stops the
      // suite from becoming sensitive to the DEBT-013 thresholds.
      .overrideProvider(RateLimitConfig)
      .useValue({
        enabled: false,
        authIpLimit: 0,
        globalIpLimit: 0,
        tenantLimit: 0,
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        errorHttpStatusCode: 422,
      }),
    );
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();

    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);
  }, 60_000);

  afterAll(async () => {
    // Every login here mints a refresh token row; the dev database is
    // disposable but should not accumulate this suite's sessions (C-05).
    const user = await prisma.user.findFirst({
      where: { email: SEEDED_EMAIL },
    });
    if (user) {
      await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
    }
    await app.close();
  }, 60_000);

  it('keeps the liveness route public', async () => {
    await get('/api/v1/health').expect(200);
  });

  it('keeps the readiness route public and shaped {status, db}', async () => {
    const res = await get('/api/v1/health/ready').expect(200);
    expect(res.body).toEqual({ status: 'ok', db: 'up' });
  });

  it('rejects an unauthenticated GET /auth/me in the Section 6.1 envelope', async () => {
    const res = await get('/api/v1/auth/me').expect(401);
    expect(bodyOf<ErrorEnvelope>(res)).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Missing bearer token' },
    });
  });

  it('returns 422 with per-field details on a malformed body', async () => {
    const res = await post('/api/v1/auth/login')
      .send({ email: 'not-an-email' })
      .expect(422);

    const { error } = bodyOf<ErrorEnvelope>(res);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'email' }),
        expect.objectContaining({ field: 'password' }),
      ]),
    );
  });

  it('refuses a body that tries to smuggle in a tenantId', async () => {
    // Tenant context comes only from validated JWT claims (Section 4.3), so an
    // unexpected property is a hard failure rather than a field quietly dropped.
    const res = await post('/api/v1/auth/login')
      .send({
        email: SEEDED_EMAIL,
        password: SEEDED_PASSWORD,
        tenantId: 'forged-tenant-id',
      })
      .expect(422);

    const { error } = bodyOf<ErrorEnvelope>(res);
    expect(JSON.stringify(error.details)).toContain('tenantId');
  });

  it('answers a wrong password and an unknown email identically', async () => {
    const wrongPassword = await post('/api/v1/auth/login')
      .send({ email: SEEDED_EMAIL, password: 'definitely-not-it' })
      .expect(401);
    const unknownEmail = await post('/api/v1/auth/login')
      .send({ email: 'nobody@dev.local', password: 'definitely-not-it' })
      .expect(401);

    expect(bodyOf<ErrorEnvelope>(wrongPassword)).toEqual(
      bodyOf<ErrorEnvelope>(unknownEmail),
    );
  });

  it('returns the access token in the body and the refresh token in a cookie', async () => {
    const res = await login().expect(200);

    expect(bodyOf<TokenEnvelope>(res)).toEqual({
      accessToken: expect.any(String),
      expiresIn: tokens.accessTokenLifetimeSeconds,
    });
    // The refresh token must never appear in a response body.
    expect(JSON.stringify(bodyOf<TokenEnvelope>(res))).not.toContain('refresh');

    const cookie = refreshCookieHeader(res.headers);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/api/v1/auth');
  });

  it('resolves identity and role from the database on GET /auth/me', async () => {
    const session = bodyOf<TokenEnvelope>(await login().expect(200));

    const res = await get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200);

    expect(bodyOf<CurrentUserResponse>(res)).toEqual({
      id: expect.any(String),
      email: SEEDED_EMAIL,
      roleName: 'Owner',
      roleId: expect.any(String),
      tenantId: expect.any(String),
      mfaEnabled: false,
      // The seed creates a default branch. Asserted as a string rather than
      // `expect.anything()` because null is the failure this field exists to
      // prevent: with no branch here, a Cashier cannot file a sale at all.
      branchId: expect.any(String),
      branchName: expect.any(String),
    });
  });

  it('rotates the refresh token and rejects a replay of the old one', async () => {
    const first = await login().expect(200);
    const original = refreshCookie(first.headers);

    const rotated = await post('/api/v1/auth/refresh')
      .set('Cookie', original)
      .expect(200);
    expect(bodyOf<TokenEnvelope>(rotated).accessToken).toEqual(
      expect.any(String),
    );
    expect(refreshCookie(rotated.headers)).not.toBe(original);

    await post('/api/v1/auth/refresh').set('Cookie', original).expect(401);
  });

  it('returns 401 when refreshing with no cookie present', async () => {
    await post('/api/v1/auth/refresh').expect(401);
  });

  it('revokes the refresh token on logout', async () => {
    const session = await login().expect(200);
    const cookie = refreshCookie(session.headers);

    await post('/api/v1/auth/logout').set('Cookie', cookie).expect(204);
    await post('/api/v1/auth/refresh').set('Cookie', cookie).expect(401);
  });

  it('treats logout without a cookie as a no-op', async () => {
    await post('/api/v1/auth/logout').expect(204);
  });

  it('refuses an MFA session token used as a bearer credential', async () => {
    // Same signing key, different scope: verifyAccessToken must reject it, or
    // the first factor alone would grant a full session.
    const mfaToken = await tokens.signMfaSessionToken(
      '00000000-0000-4000-8000-000000000000',
    );

    await get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${mfaToken}`)
      .expect(401);
  });

  it('rejects a bogus MFA session token on POST /auth/mfa/verify', async () => {
    await post('/api/v1/auth/mfa/verify')
      .send({ mfaSessionToken: 'not-a-token', code: '123456' })
      .expect(401);
  });

  it('rejects a garbage bearer token', async () => {
    await get('/api/v1/auth/me')
      .set('Authorization', 'Bearer not.a.jwt')
      .expect(401);
  });

  it('returns the envelope for an unknown route', async () => {
    const res = await get('/api/v1/does-not-exist').expect(404);
    expect(bodyOf<ErrorEnvelope>(res).error.code).toBe('NOT_FOUND');
  });

  /** The whole Set-Cookie entry, for flag assertions. */
  function refreshCookieHeader(headers: Record<string, unknown>): string {
    const raw = headers['set-cookie'];
    const all = Array.isArray(raw) ? (raw as string[]) : [];
    const match = all.find((cookie) => cookie.startsWith(`${REFRESH_COOKIE}=`));
    if (!match) {
      throw new Error('Expected a refresh cookie to be set');
    }
    return match;
  }
});
