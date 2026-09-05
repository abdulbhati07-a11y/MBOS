import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AppliedMigration,
  compareSchemaVersion,
  describeVerdict,
  readMigrationsOnDisk,
} from './schema-version';

/**
 * Unit tests for the schema-version comparison (DEBT-041).
 *
 * The behaviours pinned here are the ones that decide whether a deployment boots
 * or refuses to, so each maps to a concrete operational situation rather than to
 * a line of code.
 */
describe('compareSchemaVersion', () => {
  /** Convenience: a migration Prisma finished successfully. */
  const done = (name: string): AppliedMigration => ({
    migration_name: name,
    finished_at: new Date('2026-09-01T00:00:00Z'),
    rolled_back_at: null,
  });

  /** Started and never finished — a crash part-way through the DDL. */
  const halfDone = (name: string): AppliedMigration => ({
    migration_name: name,
    finished_at: null,
    rolled_back_at: null,
  });

  const rolledBack = (name: string): AppliedMigration => ({
    migration_name: name,
    finished_at: new Date('2026-09-01T00:00:00Z'),
    rolled_back_at: new Date('2026-09-01T00:05:00Z'),
  });

  it('passes when every shipped migration is applied', () => {
    const verdict = compareSchemaVersion(
      ['20260821145848_init', '20260830000000_smart_search_pgvector'],
      [
        done('20260821145848_init'),
        done('20260830000000_smart_search_pgvector'),
      ],
    );

    expect(verdict).toEqual({
      pending: [],
      failed: [],
      unknown: [],
      ok: true,
    });
  });

  it('fails when the deploy skipped the migrate step — the DEBT-041 scenario', () => {
    const verdict = compareSchemaVersion(
      ['20260821145848_init', '20260830000000_smart_search_pgvector'],
      [done('20260821145848_init')],
    );

    expect(verdict.ok).toBe(false);
    expect(verdict.pending).toEqual(['20260830000000_smart_search_pgvector']);
  });

  it('fails against a database that has never been migrated', () => {
    const verdict = compareSchemaVersion(['20260821145848_init'], []);

    expect(verdict.ok).toBe(false);
    expect(verdict.pending).toEqual(['20260821145848_init']);
  });

  it('treats a started-but-unfinished migration as failed, not applied', () => {
    // Prisma inserts the row when the migration starts, so presence alone must
    // never be read as success — this is the partially-migrated database.
    const verdict = compareSchemaVersion(
      ['20260821145848_init'],
      [halfDone('20260821145848_init')],
    );

    expect(verdict.ok).toBe(false);
    expect(verdict.failed).toEqual(['20260821145848_init']);
    expect(verdict.pending).toEqual(['20260821145848_init']);
  });

  it('treats a rolled-back migration as failed', () => {
    const verdict = compareSchemaVersion(
      ['20260821145848_init'],
      [rolledBack('20260821145848_init')],
    );

    expect(verdict.ok).toBe(false);
    expect(verdict.failed).toEqual(['20260821145848_init']);
  });

  it('reports a database ahead of the build without failing the boot', () => {
    // A rolling deploy has old instances running against the new schema for a
    // few seconds. Additive migrations make that safe, so this warns rather
    // than refusing to start.
    const verdict = compareSchemaVersion(
      ['20260821145848_init'],
      [done('20260821145848_init'), done('20260901000000_future_work')],
    );

    expect(verdict.ok).toBe(true);
    expect(verdict.unknown).toEqual(['20260901000000_future_work']);
  });

  it('sorts its output so log lines are stable across runs', () => {
    const verdict = compareSchemaVersion(['c_three', 'a_one', 'b_two'], []);

    expect(verdict.pending).toEqual(['a_one', 'b_two', 'c_three']);
  });
});

describe('describeVerdict', () => {
  it('names the pending migrations and the command that applies them', () => {
    const message = describeVerdict({
      pending: ['20260830000000_smart_search_pgvector'],
      failed: [],
      unknown: [],
      ok: false,
    });

    expect(message).toContain('20260830000000_smart_search_pgvector');
    expect(message).toContain('--profile migrate run --rm migrate');
    expect(message).toContain('SKIP_SCHEMA_VERSION_CHECK');
  });

  it('explains a partially-migrated database differently from a stale one', () => {
    const message = describeVerdict({
      pending: [],
      failed: ['20260821145848_init'],
      unknown: [],
      ok: false,
    });

    expect(message).toContain('prisma migrate resolve');
  });
});

describe('readMigrationsOnDisk', () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'mbos-schema-version-'));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns null when prisma/migrations is absent, rather than an empty list', () => {
    // The distinction matters: "cannot compare" is a packaging fault and must
    // not be reported as "no migrations are applied".
    expect(readMigrationsOnDisk(root)).toBeNull();
  });

  it('lists only directories, sorted, ignoring migration_lock.toml', () => {
    const dir = join(root, 'prisma', 'migrations');
    mkdirSync(join(dir, '20260830000000_second'), { recursive: true });
    mkdirSync(join(dir, '20260821145848_first'), { recursive: true });
    writeFileSync(
      join(dir, 'migration_lock.toml'),
      'provider = "postgresql"\n',
    );

    expect(readMigrationsOnDisk(root)).toEqual([
      '20260821145848_first',
      '20260830000000_second',
    ]);
  });

  it('reads this repository’s real migration set', () => {
    // Guards the path convention itself: if prisma/migrations ever moves, this
    // fails here rather than silently disabling the boot check in production.
    const actual = readMigrationsOnDisk();

    expect(actual).not.toBeNull();
    expect(actual).toContain('20260821145848_init');
    expect(actual).toContain('20260830000000_smart_search_pgvector');
  });
});
