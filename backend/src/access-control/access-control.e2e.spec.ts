import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  INestApplication,
  Post,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../app.module';
import { Public } from '../common/decorators/public.decorator';
import { ApiExceptionFilter } from '../common/filters/http-exception.filter';
import { PasswordService } from '../auth/password.service';
import { PrismaService } from '../prisma/prisma.service';
import { RateLimitConfig } from '../rate-limit/rate-limit.config';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import {
  NoModuleRequired,
  RequiresPermission,
} from './access-control.decorators';

/**
 * End-to-end coverage of middleware chain steps 2, 5 and 6 (Section 6.2).
 *
 * The application has no business endpoints yet, so there is nothing in
 * AppModule for the access-control guards to protect. This spec therefore
 * declares its own controller and registers it in the testing module only — the
 * global guards apply to it exactly as they would to a real feature controller,
 * and no test route is ever compiled into the shipped app.
 *
 * Several cases double as regression tests for the seed reconciliation: the
 * canonical matrix in src/config/permissions.ts gives Manager `settings.read`
 * but not `settings.write`, and gives Cashier no `reports` access at all. Both
 * were over-granted by the old seed, so a failure here means the surplus grants
 * have come back.
 *
 * Requires `npm run db:seed` to have run against the DATABASE_URL in backend/.env.
 */
@Controller('test-access')
class TestAccessController {
  @Public()
  @Get('public')
  publicRoute(): { ok: true } {
    return { ok: true };
  }

  @NoModuleRequired()
  @Get('identity')
  identity(): { ok: true } {
    return { ok: true };
  }

  /** Declares nothing — must be refused by the fail-closed default. */
  @Get('undeclared')
  undeclared(): { ok: true } {
    return { ok: true };
  }

  @RequiresPermission('sales', 'read')
  @Get('sales-read')
  salesRead(): { ok: true } {
    return { ok: true };
  }

  @RequiresPermission('sales', 'refund')
  @Post('sales-refund')
  @HttpCode(HttpStatus.OK)
  salesRefund(): { ok: true } {
    return { ok: true };
  }

  /** The dev tenant has no clinic subscription — isolates step 5 from step 6. */
  @RequiresPermission('clinic', 'read')
  @Get('clinic-read')
  clinicRead(): { ok: true } {
    return { ok: true };
  }

  @RequiresPermission('reports', 'read')
  @Get('reports-read')
  reportsRead(): { ok: true } {
    return { ok: true };
  }

  @RequiresPermission('settings', 'read')
  @Get('settings-read')
  settingsRead(): { ok: true } {
    return { ok: true };
  }

  @RequiresPermission('settings', 'write')
  @Post('settings-write')
  @HttpCode(HttpStatus.OK)
  settingsWrite(): { ok: true } {
    return { ok: true };
  }
}

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    retryAfter?: number;
  };
}

interface TokenEnvelope {
  accessToken: string;
  expiresIn: number;
}

const bodyOf = <T>(res: { body: unknown }): T => res.body as T;

const OWNER_EMAIL = 'owner@dev.local';
const OWNER_PASSWORD = 'DevPassw0rd!';
/** Created and destroyed by this suite; suffixed so it cannot collide. */
const MANAGER_EMAIL = 'manager.accesstest@dev.local';
const CASHIER_EMAIL = 'cashier.accesstest@dev.local';
const TEST_USER_PASSWORD = 'AccessTest0!';

describe('Access control (e2e)', () => {
  // bcrypt(12) hashes plus logins for three users against a remote Postgres.
  jest.setTimeout(90_000);

  let app: INestApplication;
  let prisma: PrismaService;
  let limiter: RateLimitService;

  /**
   * Overridden as a mutable object rather than a fixed value: the throttling
   * case at the end of this file flips `enabled` on for its own burst, while
   * every other case needs limiting off so that ~10 logins do not trip it.
   */
  const rateLimitConfig = {
    enabled: false,
    authIpLimit: 2,
    globalIpLimit: 10_000,
    tenantLimit: 10_000,
  };

  const get = (path: string) => request(app.getHttpServer() as never).get(path);
  const post = (path: string) =>
    request(app.getHttpServer() as never).post(path);

  const tokenFor = async (email: string, password: string): Promise<string> => {
    const res = await post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    return bodyOf<TokenEnvelope>(res).accessToken;
  };

  let ownerToken: string;
  let managerToken: string;
  let cashierToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [TestAccessController],
    })
      .overrideProvider(RateLimitConfig)
      .useValue(rateLimitConfig)
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
    limiter = app.get(RateLimitService);
    const passwords = app.get(PasswordService);

    const tenant = await prisma.tenant.findUnique({ where: { slug: 'dev' } });
    if (!tenant) {
      throw new Error('Dev tenant is missing. Run `npm run db:seed` first.');
    }

    // Leftovers from an aborted previous run would break the unique
    // (tenantId, email) constraint below.
    await removeTestUsers();

    const passwordHash = await passwords.hash(TEST_USER_PASSWORD);
    for (const [email, roleName] of [
      [MANAGER_EMAIL, 'Manager'],
      [CASHIER_EMAIL, 'Cashier'],
    ] as const) {
      const role = await prisma.role.findFirst({
        where: { tenantId: null, name: roleName },
      });
      if (!role) {
        throw new Error(
          `Built-in role ${roleName} is missing. Re-run the seed.`,
        );
      }
      // Unscoped client: there is no request and therefore no tenant context,
      // so tenantId is supplied explicitly (as the seed does).
      await prisma.user.create({
        data: {
          tenantId: tenant.id,
          email,
          passwordHash,
          roleId: role.id,
        },
      });
    }

    ownerToken = await tokenFor(OWNER_EMAIL, OWNER_PASSWORD);
    managerToken = await tokenFor(MANAGER_EMAIL, TEST_USER_PASSWORD);
    cashierToken = await tokenFor(CASHIER_EMAIL, TEST_USER_PASSWORD);
  }, 120_000);

  afterAll(async () => {
    // The dev database is disposable but must not accumulate this suite's users
    // or sessions (C-05).
    await removeTestUsers();
    await prisma.refreshToken.deleteMany({
      where: { user: { email: OWNER_EMAIL } },
    });
    await app.close();
  }, 60_000);

  async function removeTestUsers(): Promise<void> {
    const emails = [MANAGER_EMAIL, CASHIER_EMAIL];
    await prisma.refreshToken.deleteMany({
      where: { user: { email: { in: emails } } },
    });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
  }

  describe('chain ordering', () => {
    it('still serves a @Public route with no credentials', async () => {
      await get('/api/v1/test-access/public').expect(200);
    });

    it('answers 401, not 403, when a guarded route gets no token', async () => {
      // Proves authentication (step 3) runs before the access checks (5 and 6):
      // if they ran first they would 403 on the missing role context instead.
      const res = await get('/api/v1/test-access/sales-read').expect(401);
      expect(bodyOf<ErrorEnvelope>(res).error.code).toBe('UNAUTHORIZED');
    });

    it('allows an authenticated route that declares no business module', async () => {
      await get('/api/v1/test-access/identity')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
    });

    it('refuses a route that declares no access requirements at all', async () => {
      // Fail-closed default (DEBT-017): a forgotten decorator must not become an
      // unguarded endpoint, even for an Owner.
      const res = await get('/api/v1/test-access/undeclared')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(403);
      expect(bodyOf<ErrorEnvelope>(res).error.code).toBe('FORBIDDEN');
    });
  });

  describe('step 5 — module access', () => {
    it('allows a core module with no subscription row', async () => {
      // sales is a core module (DEBT-016): RBAC-only, never subscribed, and the
      // seed leaves it with no TenantModuleSubscription row at all. Reaching it
      // proves the guard's core short-circuit — access without a row, decided by
      // step 6 alone.
      await get('/api/v1/test-access/sales-read')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
    });

    it('refuses an unsubscribed industry module even when the role has the permission', async () => {
      // Owner holds clinic.read in the canonical matrix, and clinic is an
      // industry module, so only the missing TenantModuleSubscription row can be
      // refusing this — step 5's industry path in isolation.
      const res = await get('/api/v1/test-access/clinic-read')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(403);
      expect(bodyOf<ErrorEnvelope>(res).error.message).toContain('clinic');
    });
  });

  describe('step 6 — role permissions', () => {
    it('allows an action the role holds', async () => {
      await get('/api/v1/test-access/sales-read')
        .set('Authorization', `Bearer ${cashierToken}`)
        .expect(200);
    });

    it('refuses sales.refund to a Cashier while sales.read is allowed', async () => {
      // BR-03: refund is its own action, deliberately not implied by write.
      // Sales is a core module — always available — so this isolates step 6.
      const res = await post('/api/v1/test-access/sales-refund')
        .set('Authorization', `Bearer ${cashierToken}`)
        .expect(403);
      expect(bodyOf<ErrorEnvelope>(res).error.message).toContain(
        'sales.refund',
      );
    });

    it('allows sales.refund to an Owner', async () => {
      await post('/api/v1/test-access/sales-refund')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
    });
  });

  describe('canonical matrix regressions', () => {
    it('grants Manager settings.read but refuses settings.write', async () => {
      await get('/api/v1/test-access/settings-read')
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);

      // The reconciliation that matters most: with settings.write a Manager
      // could create branches and custom roles (Section 6.4/6.5).
      await post('/api/v1/test-access/settings-write')
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(403);
    });

    it('refuses reports.read to a Cashier', async () => {
      // The canonical matrix omits reports for Cashier entirely; the old seed
      // granted it.
      await get('/api/v1/test-access/reports-read')
        .set('Authorization', `Bearer ${cashierToken}`)
        .expect(403);
    });

    it('allows an Owner settings.write', async () => {
      await post('/api/v1/test-access/settings-write')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
    });
  });

  describe('step 2 — rate limiting', () => {
    // Last, and self-contained: it is the only case that turns limiting on.
    beforeAll(() => {
      limiter.reset();
      rateLimitConfig.enabled = true;
    });

    afterAll(() => {
      rateLimitConfig.enabled = false;
      limiter.reset();
    });

    it('returns the Section 6.1 429 envelope and Retry-After header', async () => {
      // Empty bodies: guards run before pipes, so each request is counted while
      // costing no bcrypt comparison. authIpLimit is overridden to 2.
      await post('/api/v1/auth/login').send({}).expect(422);
      await post('/api/v1/auth/login').send({}).expect(422);

      const limited = await post('/api/v1/auth/login').send({}).expect(429);

      const { error } = bodyOf<ErrorEnvelope>(limited);
      expect(error.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(error.message).toBe(
        'Too many requests. Please retry after the indicated time.',
      );
      expect(error.retryAfter).toBeGreaterThan(0);
      expect(error.retryAfter).toBeLessThanOrEqual(60);

      // RFC 9110 requires the header; the body field duplicates it (Section 6.1).
      expect(limited.headers['retry-after']).toBe(String(error.retryAfter));
    });
  });
});
