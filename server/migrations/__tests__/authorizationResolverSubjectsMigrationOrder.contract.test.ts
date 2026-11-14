import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
// Same table analysis migration-lint rule 6 uses to decide whether two migrations' order matters.
import { deriveSchemaFacts } from '../../../scripts/lib/migration-lint.mjs';

// Knex runs migrations in filename order. The resolver-membership pair adds a NOT VALID
// foreign key and CHECK on co_managed_seat_assignments, then validates them in a separate
// file. Both must sort after every earlier migration that alters co_managed_seat_assignments,
// including main's seat-reader marker; otherwise fresh databases run them in a different order
// than deployed ones (migration-lint R6).
const MIGRATIONS_DIR = path.resolve(__dirname, '..');

const PAIR = ['index_authorization_resolver_subjects', 'validate_authorization_resolver_subjects'];
const PRIOR_SEAT_TABLE_MIGRATIONS = [
  'create_co_managed_seat_ticket_work',
  'add_users_seat_reader_marker',
];

const allMigrations = readdirSync(MIGRATIONS_DIR)
  .filter((name) => /^\d{14}_.*\.cjs$/.test(name))
  .sort();

const fileFor = (suffix: string): string => {
  const matches = allMigrations.filter((name) => name.endsWith(`_${suffix}.cjs`));
  expect(matches, suffix).toHaveLength(1);
  return matches[0];
};
const timestampOf = (name: string) => name.slice(0, 14);

describe('authorization resolver subjects migration ordering', () => {
  it('adds the NOT VALID constraints before validating them', () => {
    const order = PAIR.map(fileFor);
    expect([...order].sort()).toEqual(order);
  });

  it('runs after the seat-table migrations it follows on deployed databases', () => {
    const [first] = PAIR.map(fileFor);
    for (const suffix of PRIOR_SEAT_TABLE_MIGRATIONS) {
      const prior = fileFor(suffix);
      expect(timestampOf(prior) < timestampOf(first), `${first} must sort after ${prior}`).toBe(true);
    }
  });

  // A timestamp shared with a migration that is already on main (here main's
  // 20261113140000_grant_service_read_to_msp_roles) cannot be fixed by renaming either file:
  // deployed databases have recorded both names. What must hold is migration-lint rule 6's
  // concern: a co-stamped migration's order relative to the pair (knex breaks the tie by
  // filename) must not matter, so it may not touch any table the pair touches.
  it('shares its timestamps only with migrations that touch none of the pair\'s tables', () => {
    const facts = deriveSchemaFacts(
      allMigrations.map((name) => ({ name, source: readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8') })),
    );
    const tablesOf = (name: string): string[] => facts.touches.find((t) => t.name === name)?.tables ?? [];
    const pair = PAIR.map(fileFor);
    const pairTables = new Set(pair.flatMap(tablesOf));
    expect(pairTables.has('co_managed_seat_assignments')).toBe(true);

    const pairTimestamps = new Set(pair.map(timestampOf));
    for (const other of allMigrations.filter((name) => pairTimestamps.has(timestampOf(name)) && !pair.includes(name))) {
      expect(tablesOf(other).filter((table) => pairTables.has(table)), `${other} shares a timestamp with the pair`).toEqual([]);
    }
  });

  it('cross-references only migrations in the pair', () => {
    const set = PAIR.map(fileFor);
    const timestamps = new Set(set.map(timestampOf));
    for (const name of set) {
      const source = readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8');
      for (const [ref] of source.matchAll(/\b20\d{12}\b/g)) {
        expect(timestamps.has(ref), `${name} references ${ref}`).toBe(true);
      }
    }
  });
});
