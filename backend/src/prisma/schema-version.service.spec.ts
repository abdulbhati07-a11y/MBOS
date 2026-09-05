import { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma.service';
import { SchemaVersionService } from './schema-version.service';
import * as schemaVersion from './schema-version';

/**
 * Tests for the boot-time guard itself, not just its comparison function
 * (schema-version.spec.ts covers that).
 *
 * This file exists because of a gap the CI run exposed: the e2e job's fourteen
 * suites all boot AppModule and therefore all run this hook, but Jest suppresses
 * worker-level Nest logger output for passing suites, so a green e2e run is NOT
 * evidence that the hook executed — only that it did not throw. "Did not throw"
 * and "never ran" look identical from outside. So the hook's behaviour is pinned
 * here, directly.
 */
describe('SchemaVersionService', () => {
  const MIGRATIONS = [
    '20260821145848_init',
    '20260830000000_smart_search_pgvector',
  ];

  let onDiskSpy: jest.SpyInstance;

  const applied = (names: string[]) =>
    names.map((migration_name) => ({
      migration_name,
      finished_at: new Date('2026-09-01T00:00:00Z'),
      rolled_back_at: null,
    }));

  /**
   * A PrismaService stand-in whose $queryRaw returns the given rows. The mock is
   * returned alongside it rather than read back off the object, so assertions
   * never reference an unbound method.
   */
  const prismaReturning = (
    rows: unknown[] | Error,
  ): { prisma: PrismaService; queryRaw: jest.Mock } => {
    const queryRaw = jest.fn(() =>
      rows instanceof Error ? Promise.reject(rows) : Promise.resolve(rows),
    );
    return {
      prisma: { $queryRaw: queryRaw } as unknown as PrismaService,
      queryRaw,
    };
  };

  const configWith = (vars: Record<string, string> = {}): ConfigService =>
    ({ get: (key: string) => vars[key] }) as unknown as ConfigService;

  beforeEach(() => {
    onDiskSpy = jest
      .spyOn(schemaVersion, 'readMigrationsOnDisk')
      .mockReturnValue([...MIGRATIONS]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('completes quietly when every shipped migration is applied', async () => {
    const service = new SchemaVersionService(
      prismaReturning(applied(MIGRATIONS)).prisma,
      configWith(),
    );

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
  });

  it('throws, naming the missing migration, when the migrate step was skipped', async () => {
    const service = new SchemaVersionService(
      prismaReturning(applied([MIGRATIONS[0]])).prisma,
      configWith(),
    );

    await expect(service.onApplicationBootstrap()).rejects.toThrow(
      /20260830000000_smart_search_pgvector/,
    );
    await expect(service.onApplicationBootstrap()).rejects.toThrow(
      /refusing to start/i,
    );
  });

  it('throws with a distinct message when the database was never migrated', async () => {
    // 42P01 = undefined_table: _prisma_migrations does not exist. A different
    // and more actionable failure than "some migrations are pending".
    const service = new SchemaVersionService(
      prismaReturning(
        new Error('relation "_prisma_migrations" does not exist (42P01)'),
      ).prisma,
      configWith(),
    );

    await expect(service.onApplicationBootstrap()).rejects.toThrow(
      /no migration history/i,
    );
  });

  it('throws rather than passing when the history cannot be read for another reason', async () => {
    const service = new SchemaVersionService(
      prismaReturning(new Error('connection terminated unexpectedly')).prisma,
      configWith(),
    );

    await expect(service.onApplicationBootstrap()).rejects.toThrow(
      /was not verified/i,
    );
  });

  it('honours SKIP_SCHEMA_VERSION_CHECK and never queries', async () => {
    const { prisma, queryRaw } = prismaReturning(applied([]));
    const service = new SchemaVersionService(
      prisma,
      configWith({ SKIP_SCHEMA_VERSION_CHECK: 'true' }),
    );

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('does not treat a missing migrations directory as a pass or a failure', async () => {
    // "Cannot compare" is a packaging fault. It must not boot-fail a deployment,
    // and it must not be reported as a verified schema either.
    onDiskSpy.mockReturnValue(null);
    const { prisma, queryRaw } = prismaReturning(applied([]));
    const service = new SchemaVersionService(prisma, configWith());

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('tolerates a database ahead of the build', async () => {
    const service = new SchemaVersionService(
      prismaReturning(applied([...MIGRATIONS, '20260901000000_future'])).prisma,
      configWith(),
    );

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
  });

  it('refuses to start on a half-applied migration', async () => {
    const service = new SchemaVersionService(
      prismaReturning([
        ...applied([MIGRATIONS[0]]),
        {
          migration_name: MIGRATIONS[1],
          finished_at: null,
          rolled_back_at: null,
        },
      ]).prisma,
      configWith(),
    );

    await expect(service.onApplicationBootstrap()).rejects.toThrow(
      /migrate resolve/,
    );
  });
});
