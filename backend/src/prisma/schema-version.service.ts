import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma.service';
import {
  AppliedMigration,
  compareSchemaVersion,
  describeVerdict,
  readMigrationsOnDisk,
} from './schema-version';

/**
 * Refuses to serve traffic against a database whose schema is older than this
 * build (DEBT-041).
 *
 * ## Why this exists
 *
 * Until the DEBT-040 mitigation, `backend/docker-entrypoint.sh` ran
 * `prisma migrate deploy` before starting the API, which incidentally guaranteed
 * the app never ran on a stale schema — it migrated itself first. Moving
 * migrations to a once-per-deploy step removed that guarantee: a release that
 * ships new code and skips the migrate step now boots happily and fails later,
 * at query time, in whichever request first touches the missing column.
 *
 * This restores the guarantee, and deliberately does NOT restore the exposure.
 * The check runs over `PrismaService` — the pg driver adapter connection, which
 * pins the CA and verifies the server certificate (see pg-config.ts). It never
 * invokes Prisma's schema engine, the component that cannot authenticate the
 * server at all. So the app gains back "never serve on an old schema" without
 * re-opening the unverified-TLS window that migrating-on-boot created.
 *
 * ## Lifecycle
 *
 * `OnApplicationBootstrap` rather than `onModuleInit`: it runs after every
 * module's init hook, so PrismaService's pool is definitely up, and it still runs
 * before `app.listen()` — a throw here aborts the boot rather than letting a
 * half-ready process accept a request.
 *
 * ## What it deliberately does not do
 *
 * It does not compare checksums. Prisma's own `migrate deploy` refuses to run on
 * a drifted history, so checksum enforcement already exists at the point where it
 * can act on it. Repeating it here would only add a second, less actionable place
 * for the same failure to surface.
 */
@Injectable()
export class SchemaVersionService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SchemaVersionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.get<string>('SKIP_SCHEMA_VERSION_CHECK') === 'true') {
      this.logger.warn(
        'SKIP_SCHEMA_VERSION_CHECK=true — not verifying that the database ' +
          'schema matches this build. Queries may fail at runtime.',
      );
      return;
    }

    const onDisk = readMigrationsOnDisk();

    if (onDisk === null) {
      // Cannot compare, so do not claim to have. This is a packaging problem —
      // the Dockerfile COPYs prisma/ into the runtime image — and it is reported
      // rather than treated as a pass or a failure.
      this.logger.error(
        'Cannot find prisma/migrations relative to the working directory, so ' +
          'the database schema version was NOT verified. This is a packaging ' +
          'fault, not a schema fault.',
      );
      return;
    }

    if (onDisk.length === 0) {
      this.logger.warn(
        'prisma/migrations contains no migrations; nothing to verify.',
      );
      return;
    }

    const applied = await this.readAppliedMigrations();
    const verdict = compareSchemaVersion(onDisk, applied);

    if (verdict.unknown.length > 0) {
      // The database is ahead of this build. Normal and transient during a
      // rolling deploy, where an old instance briefly runs against the new
      // schema; additive migrations are safe there. Worth saying out loud,
      // because if it persists it means a rollback left code behind the data.
      this.logger.warn(
        `Database has ${verdict.unknown.length} migration(s) this build does ` +
          `not ship: ${verdict.unknown.join(', ')}. Expected mid-rollout; a ` +
          'problem if it persists.',
      );
    }

    if (!verdict.ok) {
      const message = describeVerdict(verdict);
      this.logger.error(message);
      throw new Error(message);
    }

    this.logger.log(
      `Database schema verified: all ${onDisk.length} migration(s) applied ` +
        `(latest ${onDisk[onDisk.length - 1]}).`,
    );
  }

  /**
   * Read Prisma's migration bookkeeping directly. Raw SQL because
   * `_prisma_migrations` is Prisma's own table and is not in schema.prisma, so
   * there is no generated model for it.
   *
   * A missing table means the database has never been migrated at all — a
   * distinct and more actionable failure than "some migrations are pending", so
   * it gets its own message rather than being reported as eight pending
   * migrations.
   */
  private async readAppliedMigrations(): Promise<AppliedMigration[]> {
    try {
      return await this.prisma.$queryRaw<AppliedMigration[]>`
        SELECT "migration_name", "finished_at", "rolled_back_at"
        FROM "_prisma_migrations"
      `;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);

      // 42P01 = undefined_table. Prisma surfaces the driver's code in the
      // message for raw queries.
      if (/42P01|does not exist|_prisma_migrations/i.test(detail)) {
        throw new Error(
          [
            'Database has no migration history (_prisma_migrations is absent) — refusing to start.',
            '',
            'This database has never been migrated. The application does not',
            'migrate on boot (DEBT-040); run the deploy-time migration step:',
            '',
            '  docker compose --profile migrate run --rm migrate',
            '',
            'or ./scripts/deploy.sh, which sequences build -> migrate -> up.',
          ].join('\n'),
        );
      }

      throw new Error(
        `Could not read the database's migration history, so the schema ` +
          `version was not verified: ${detail}`,
      );
    }
  }
}
