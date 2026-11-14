import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Knex runs migrations in filename order. The resolver-membership pair adds a NOT VALID
// foreign key and CHECK on co_managed_seat_assignments, then validates them in a separate
// file. Both must sort after every earlier migration that alters co_managed_seat_assignments,
// including main's seat-reader marker; otherwise fresh databases run them in a different order
// than deployed ones (migration-lint R6).
//
// Released migration names are immutable: deployed databases record them in knex_migrations,
// and knex refuses to migrate when a recorded file is missing (the upgrade-order gate). So a
// migration that shares the pair's timestamp cannot be restamped away once it is on main.
// Knex then breaks the tie by full filename. That order is safe because the sibling touches
// none of the pair's tables, so neither order changes what the pair does.
const MIGRATIONS_DIR = path.resolve(__dirname, '..');
const LINT_ENGINE = path.resolve(__dirname, '../../../scripts/lib/migration-lint.mjs');

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

  it('shares its timestamps only with migrations that touch none of its tables', async () => {
    const { deriveSchemaFacts } = await import(pathToFileURL(LINT_ENGINE).href);
    const pair = PAIR.map(fileFor);
    const timestamps = new Set(pair.map(timestampOf));
    const siblings = allMigrations.filter((name) => timestamps.has(timestampOf(name)) && !pair.includes(name));
    const touches = (names: string[]): Array<{ name: string; tables: string[] }> =>
      deriveSchemaFacts(
        names.map((name) => ({ name, source: readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8') })),
      ).touches;

    const pairTables = new Set(touches(pair).flatMap((t) => t.tables));
    expect(pairTables).toContain('co_managed_seat_assignments');
    for (const sibling of touches(siblings)) {
      const shared = sibling.tables.filter((table) => pairTables.has(table));
      expect(shared, `${sibling.name} shares a timestamp with the resolver pair and touches its tables`).toEqual([]);
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
