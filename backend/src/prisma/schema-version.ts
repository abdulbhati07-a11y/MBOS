import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * One row of Prisma's `_prisma_migrations` bookkeeping table.
 *
 * A migration counts as applied only when `finished_at` is set and
 * `rolled_back_at` is not. Prisma writes the row at the *start* of a migration,
 * so "row exists" is not the same as "migration succeeded" — a crash mid-DDL
 * leaves a row with a null `finished_at`, and that is precisely the state that
 * must stop a boot rather than be read as success.
 */
export interface AppliedMigration {
  migration_name: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
}

export interface SchemaVersionVerdict {
  /** Migrations present in the image but not successfully applied. Fatal. */
  readonly pending: string[];
  /** Rows that started and never finished, or were rolled back. Fatal. */
  readonly failed: string[];
  /** Applied in the database but absent from the image. A warning, not fatal. */
  readonly unknown: string[];
  readonly ok: boolean;
}

/**
 * Compare the migrations baked into this build against what the database says it
 * has applied. Pure, so the interesting cases are unit-testable without a
 * database — see schema-version.spec.ts.
 */
export function compareSchemaVersion(
  onDisk: readonly string[],
  applied: readonly AppliedMigration[],
): SchemaVersionVerdict {
  const succeeded = new Set(
    applied
      .filter((m) => m.finished_at !== null && m.rolled_back_at === null)
      .map((m) => m.migration_name),
  );

  const failed = applied
    .filter((m) => m.finished_at === null || m.rolled_back_at !== null)
    .map((m) => m.migration_name)
    .sort();

  const pending = onDisk.filter((name) => !succeeded.has(name)).sort();

  const onDiskSet = new Set(onDisk);
  const unknown = [...succeeded].filter((name) => !onDiskSet.has(name)).sort();

  return {
    pending,
    failed,
    unknown,
    ok: pending.length === 0 && failed.length === 0,
  };
}

/**
 * The migration directory names shipped with this build, in lexical order (which
 * is also chronological — Prisma prefixes each with a UTC timestamp).
 *
 * Returns `null` when the directory cannot be found at all, which is a different
 * condition from "nothing is applied": it means we cannot make the comparison,
 * not that the comparison failed. The caller reports the two differently.
 */
export function readMigrationsOnDisk(
  root: string = process.cwd(),
): string[] | null {
  const dir = join(root, 'prisma', 'migrations');
  if (!existsSync(dir)) return null;

  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** Human-readable explanation of a failed verdict, for the boot log. */
export function describeVerdict(verdict: SchemaVersionVerdict): string {
  const lines: string[] = [
    'Database schema does not match this build — refusing to start.',
    '',
  ];

  if (verdict.pending.length > 0) {
    lines.push(
      `${verdict.pending.length} migration(s) shipped with this build have not been applied:`,
      ...verdict.pending.map((name) => `  - ${name}`),
      '',
      'The application no longer migrates on boot (DEBT-040). Apply them as a',
      'deploy step before starting the containers:',
      '',
      '  docker compose --profile migrate run --rm migrate',
      '',
      'or use ./scripts/deploy.sh, which does that in the right order.',
      '',
    );
  }

  if (verdict.failed.length > 0) {
    lines.push(
      `${verdict.failed.length} migration(s) are recorded as started but not`,
      'completed, or were rolled back. The database is in a partially-migrated',
      'state and needs manual attention — `prisma migrate resolve` marks a',
      'migration applied or rolled back once you have established which it is:',
      ...verdict.failed.map((name) => `  - ${name}`),
      '',
    );
  }

  lines.push(
    'To start anyway — accepting that queries may fail against the schema that',
    'is actually there — set SKIP_SCHEMA_VERSION_CHECK="true".',
  );

  return lines.join('\n');
}
