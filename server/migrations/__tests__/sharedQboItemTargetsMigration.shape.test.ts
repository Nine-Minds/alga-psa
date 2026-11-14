import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';

// Migration-shape test (alga-2026-0002899): drives the real migration against a
// recording, catalog-simulating Knex executor so the DDL ORDER, the guard
// invariant, the `down` refusal and the Citus probes are asserted without a
// database. The behavioral twin is sharedQboItemTargetsMigration.integration.test.ts.

const require = createRequire(import.meta.url);
const migration = require(
  path.resolve(__dirname, '../20261029170000_allow_shared_quickbooks_online_item_targets.cjs')
) as { up: (k: any) => Promise<void>; down: (k: any) => Promise<void>; config: { transaction: boolean } };

type Kind = 'old' | 'new' | 'unexpected';
type Idx = { kind: Kind; valid: boolean } | null;

const KEYS = ['tenant', 'integration_type', 'alga_entity_type', 'external_entity_id', "COALESCE(external_realm_id, ''::text)"];
const BASE =
  "((integration_type <> 'xero'::text) OR (COALESCE((metadata ->> 'xeroTargetKind'::text), 'item'::text) <> 'account'::text)) AND ((integration_type <> 'quickbooks_desktop'::text) OR (alga_entity_type <> ALL (ARRAY['service'::text, 'discount'::text, 'tax_code'::text]))) AND (deleted_at IS NULL)";
const predicates: Record<Kind, string> = {
  old: `${BASE} AND ((integration_type <> 'quickbooks_online'::text) OR (alga_entity_type <> 'tax_code'::text))`,
  new: `${BASE} AND ((integration_type <> 'quickbooks_online'::text) OR (alga_entity_type <> ALL (ARRAY['service'::text, 'discount'::text, 'tax_code'::text])))`,
  unexpected: "(integration_type <> 'xero'::text)",
};

type Options = {
  canonical?: Idx;
  guard?: Idx;
  duplicateGroups?: number;
  citus?: { distributed: boolean; localRows: boolean };
  failBuild?: 'guard' | 'canonical';
};

function fakeKnex(opts: Options = {}) {
  const state = {
    canonical: opts.canonical === undefined ? ({ kind: 'old', valid: true } as Idx) : opts.canonical,
    guard: opts.guard === undefined ? null : opts.guard,
  };
  const log: string[] = [];
  const kindOf = (sql: string): Kind => (sql.includes("NOT IN ('service', 'discount', 'tax_code')") && sql.includes("'quickbooks_online' OR alga_entity_type NOT IN") ? 'new' : 'old');

  const raw = async (sql: string, bindings?: unknown[]) => {
    const s = sql.replace(/\s+/g, ' ').trim();

    if (s.startsWith('SELECT i.indisvalid')) {
      const idx = bindings![0] === 'idx_unique_external_mapping' ? state.canonical : state.guard;
      log.push(`inspect ${bindings![0]}`);
      return {
        rows: idx
          ? [{ valid: idx.valid, unique: true, predicate: predicates[idx.kind], keys: KEYS }]
          : [],
      };
    }
    if (s.includes('to_regclass')) {
      log.push('probe:citus');
      return { rows: [{ has_citus: !!opts.citus }] };
    }
    if (s.includes('FROM pg_dist_partition')) {
      log.push('probe:distributed');
      return { rows: opts.citus?.distributed ? [{}] : [] };
    }
    if (s.includes('FROM ONLY')) {
      log.push('probe:local-rows');
      return { rows: opts.citus?.localRows ? [{}] : [] };
    }
    if (s.includes('truncate_local_data_after_distributing_table')) {
      log.push('truncate-local');
      return { rows: [] };
    }
    if (s.startsWith('SELECT COUNT(*)')) {
      log.push('count-duplicates');
      return { rows: [{ groups: opts.duplicateGroups ?? 0 }] };
    }
    if (s.startsWith('CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS')) {
      const name = s.match(/IF NOT EXISTS (\S+)/)![1];
      const kind = kindOf(s);
      log.push(`create ${name} ${kind}`);
      const slot = name === 'idx_unique_external_mapping' ? 'canonical' : 'guard';
      if (opts.failBuild === (slot === 'guard' ? 'guard' : 'canonical')) {
        state[slot] = { kind, valid: false }; // a failed concurrent build leaves an invalid index
        throw new Error('could not create unique index (duplicate key)');
      }
      if (!state[slot]) state[slot] = { kind, valid: true }; // IF NOT EXISTS keeps whatever is there
      return { rows: [] };
    }
    if (s.startsWith('DROP INDEX CONCURRENTLY IF EXISTS')) {
      const name = s.match(/EXISTS (\S+)/)![1];
      log.push(`drop ${name}`);
      if (name === 'idx_unique_external_mapping') state.canonical = null;
      else state.guard = null;
      return { rows: [] };
    }
    throw new Error(`unexpected statement: ${s}`);
  };
  return { knex: { raw }, state, log };
}

const ddl = (log: string[]) => log.filter((l) => l.startsWith('create') || l.startsWith('drop'));

describe('shared QBO item targets migration shape', () => {
  it('runs outside a transaction (concurrent DDL)', () => {
    expect(migration.config).toEqual({ transaction: false });
  });

  it('up: guard first, then drop canonical, rebuild, drop guard — in that order', async () => {
    const { knex, state, log } = fakeKnex();
    await migration.up(knex);
    expect(ddl(log)).toEqual([
      'create idx_unique_external_mapping_qbo_guard new',
      'drop idx_unique_external_mapping',
      'create idx_unique_external_mapping new',
      'drop idx_unique_external_mapping_qbo_guard',
    ]);
    expect(state.canonical).toEqual({ kind: 'new', valid: true });
    expect(state.guard).toBeNull();
  });

  it('up: the guard is verified valid before the canonical index is dropped', async () => {
    const { knex, log } = fakeKnex();
    await migration.up(knex);
    const created = log.indexOf('create idx_unique_external_mapping_qbo_guard new');
    const dropped = log.indexOf('drop idx_unique_external_mapping');
    const inspectedBetween = log.slice(created, dropped).filter((l) => l === 'inspect idx_unique_external_mapping_qbo_guard');
    expect(inspectedBetween.length).toBeGreaterThan(0);
  });

  it('a valid protective index exists after every statement (never unprotected)', async () => {
    const { knex, state } = fakeKnex();
    const protectedAtEveryStep: boolean[] = [];
    const raw = knex.raw;
    knex.raw = async (sql: string, b?: unknown[]) => {
      const r = await raw(sql, b);
      if (/^\s*(CREATE|DROP)/.test(sql)) {
        protectedAtEveryStep.push(!!(state.canonical?.valid || state.guard?.valid));
      }
      return r;
    };
    await migration.up(knex);
    expect(protectedAtEveryStep).toEqual([true, true, true, true]);
  });

  it('up is a no-op when the canonical index is already at the destination', async () => {
    const { knex, log } = fakeKnex({ canonical: { kind: 'new', valid: true } });
    await migration.up(knex);
    expect(ddl(log)).toEqual([]);
  });

  it('up cleans only a leftover guard when the canonical index is already at the destination', async () => {
    const { knex, log, state } = fakeKnex({
      canonical: { kind: 'new', valid: true },
      guard: { kind: 'new', valid: true },
    });
    await migration.up(knex);
    expect(ddl(log)).toEqual(['drop idx_unique_external_mapping_qbo_guard']);
    expect(state.guard).toBeNull();
  });

  it('up resumes after a crash between guard build and canonical drop', async () => {
    const { knex, log, state } = fakeKnex({ guard: { kind: 'new', valid: true } });
    await migration.up(knex);
    expect(ddl(log)).toEqual([
      'create idx_unique_external_mapping_qbo_guard new', // IF NOT EXISTS keeps the valid one
      'drop idx_unique_external_mapping',
      'create idx_unique_external_mapping new',
      'drop idx_unique_external_mapping_qbo_guard',
    ]);
    expect(state.canonical).toEqual({ kind: 'new', valid: true });
  });

  it('up resumes after a crash with the canonical index dropped and only the guard standing', async () => {
    const { knex, state } = fakeKnex({ canonical: null, guard: { kind: 'new', valid: true } });
    await migration.up(knex);
    expect(state.canonical).toEqual({ kind: 'new', valid: true });
    expect(state.guard).toBeNull();
  });

  it('up replaces an INVALID guard before building a new one', async () => {
    const { knex, log } = fakeKnex({ guard: { kind: 'new', valid: false } });
    await migration.up(knex);
    expect(ddl(log).slice(0, 2)).toEqual([
      'drop idx_unique_external_mapping_qbo_guard',
      'create idx_unique_external_mapping_qbo_guard new',
    ]);
  });

  it('up fails loudly, with no DDL, on a valid canonical index of unexpected definition', async () => {
    const { knex, log } = fakeKnex({ canonical: { kind: 'unexpected', valid: true } });
    await expect(migration.up(knex)).rejects.toThrow(/unexpected definition/);
    expect(ddl(log)).toEqual([]);
  });

  it('a failed guard build drops the invalid guard, keeps the canonical index and says how to retry', async () => {
    const { knex, state } = fakeKnex({ failBuild: 'guard' });
    await expect(migration.up(knex)).rejects.toThrow(/left in place/);
    expect(state.guard).toBeNull();
    expect(state.canonical).toEqual({ kind: 'old', valid: true });
  });

  it('a failed canonical rebuild leaves the valid guard protecting', async () => {
    const { knex, state } = fakeKnex({ failBuild: 'canonical' });
    await expect(migration.up(knex)).rejects.toThrow();
    expect(state.guard).toEqual({ kind: 'new', valid: true });
  });

  describe('down', () => {
    it('refuses on duplicate target groups before issuing ANY index statement', async () => {
      const { knex, log, state } = fakeKnex({
        canonical: { kind: 'new', valid: true },
        duplicateGroups: 2,
      });
      await expect(migration.down(knex)).rejects.toThrow(/2 duplicate target group/);
      expect(log).toEqual(['count-duplicates']);
      expect(state.canonical).toEqual({ kind: 'new', valid: true });
      expect(state.guard).toBeNull();
    });

    it('with no duplicates restores the three-predicate index, guard first', async () => {
      const { knex, log, state } = fakeKnex({ canonical: { kind: 'new', valid: true } });
      await migration.down(knex);
      expect(ddl(log)).toEqual([
        'create idx_unique_external_mapping_qbo_guard old',
        'drop idx_unique_external_mapping',
        'create idx_unique_external_mapping old',
        'drop idx_unique_external_mapping_qbo_guard',
      ]);
      expect(state.canonical).toEqual({ kind: 'old', valid: true });
    });
  });

  describe('Citus probes', () => {
    it('plain Postgres: probes pg_dist_partition existence and stops', async () => {
      const { knex, log } = fakeKnex();
      await migration.up(knex);
      expect(log).toContain('probe:citus');
      expect(log).not.toContain('probe:distributed');
      expect(log).not.toContain('truncate-local');
    });

    it('Citus, distributed table, stale coordinator-local rows: truncates local data before any index build', async () => {
      const { knex, log } = fakeKnex({ citus: { distributed: true, localRows: true } });
      await migration.up(knex);
      expect(log).toContain('truncate-local');
      expect(log.indexOf('truncate-local')).toBeLessThan(log.findIndex((l) => l.startsWith('create')));
    });

    it('Citus, distributed table, clean local shell: no truncate', async () => {
      const { knex, log } = fakeKnex({ citus: { distributed: true, localRows: false } });
      await migration.up(knex);
      expect(log).toContain('probe:local-rows');
      expect(log).not.toContain('truncate-local');
    });

    it('Citus present but table not distributed: no local-row probe, no truncate', async () => {
      const { knex, log } = fakeKnex({ citus: { distributed: false, localRows: true } });
      await migration.up(knex);
      expect(log).not.toContain('probe:local-rows');
      expect(log).not.toContain('truncate-local');
    });
  });
});
