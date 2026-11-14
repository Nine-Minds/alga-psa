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
const SHIPPED_PAIR = [
  '20261113140000_index_authorization_resolver_subjects.cjs',
  '20261113140100_validate_authorization_resolver_subjects.cjs',
];
const PAIR_TABLES = ['authorization_resolver_subjects', 'co_managed_seat_assignments'];
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

  // Deployed databases record these names in knex_migrations, and knex refuses to migrate when a
  // recorded file is missing, so a shipped migration is never renamed to resolve an ordering clash.
  it('keeps the filenames deployed databases have recorded', () => {
    expect(PAIR.map(fileFor)).toEqual(SHIPPED_PAIR);
  });

  // Knex breaks timestamp ties by full filename, so a neighbour sharing a timestamp only matters
  // when it touches the same tables; then fresh and deployed databases could order them differently.
  it('shares its timestamps only with migrations that touch none of the pair\'s tables', () => {
    for (const name of PAIR.map(fileFor)) {
      const ts = timestampOf(name);
      for (const other of allMigrations.filter((o) => o !== name && timestampOf(o) === ts)) {
        const source = readFileSync(path.join(MIGRATIONS_DIR, other), 'utf8');
        for (const table of PAIR_TABLES) {
          expect(new RegExp(`\\b${table}\\b`).test(source), `${other} touches ${table}`).toBe(false);
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
