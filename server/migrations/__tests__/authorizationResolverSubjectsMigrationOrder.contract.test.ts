import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

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

const PAIR_TABLES = ['authorization_resolver_subjects', 'co_managed_seat_assignments'];

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

  // main ships 20261113140000_grant_service_read_to_msp_roles beside the index migration; both
  // are in deployed ledgers, so neither can be renamed. A shared timestamp is harmless only when
  // the other migration leaves the pair's tables alone: then their relative order cannot matter.
  it('shares its timestamps only with migrations that leave the pair\'s tables alone', () => {
    const pair = PAIR.map(fileFor);
    const pairSource = pair.map((name) => readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8')).join('\n');
    for (const table of PAIR_TABLES) expect(pairSource, `pair touches ${table}`).toContain(table);
    for (const name of pair) {
      const ts = timestampOf(name);
      const neighbours = allMigrations.filter((other) => timestampOf(other) === ts && !pair.includes(other));
      for (const other of neighbours) {
        const source = readFileSync(path.join(MIGRATIONS_DIR, other), 'utf8');
        for (const table of PAIR_TABLES) {
          expect(new RegExp(`\\b${table}\\b`).test(source), `${other} shares ${ts} with ${name} and touches ${table}`).toBe(false);
        }
      }
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
