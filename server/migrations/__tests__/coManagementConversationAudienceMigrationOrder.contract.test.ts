import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Knex runs migrations in filename order. The L4a conversation-audience set splits each
// NOT VALID add from its VALIDATE into separate files, so the pair order is load-bearing, and
// the files cross-reference each other by timestamp. Renumbering the set (e.g. to land after
// newer migrations on main) must keep both intact.
const MIGRATIONS_DIR = path.resolve(__dirname, '..');

const L4A_SUFFIXES = [
  'add_comment_audience_columns',
  'validate_comment_audience_constraints',
  'index_comment_audience_lookups',
  'create_co_management_private_threads_and_comments',
  'create_co_management_private_command_receipts',
  'extend_participation_evidence_conversation_sources',
  'validate_participation_evidence_source_type_check',
  'create_co_management_command_receipts',
  'add_ticket_audit_log_actor_reference_columns',
  'validate_ticket_audit_log_actor_fk',
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

describe('co-management conversation audience migration ordering', () => {
  it('runs every NOT VALID add before its VALIDATE and indexes after validation', () => {
    const order = L4A_SUFFIXES.map(fileFor);
    expect([...order].sort()).toEqual(order);
  });

  it('gives each L4a migration a timestamp no other migration file uses', () => {
    for (const name of L4A_SUFFIXES.map(fileFor)) {
      const ts = timestampOf(name);
      expect(allMigrations.filter((other) => timestampOf(other) === ts), name).toEqual([name]);
    }
  });

  it('cross-references only migrations that exist in the set', () => {
    const set = L4A_SUFFIXES.map(fileFor);
    const timestamps = new Set(set.map(timestampOf));
    for (const name of set) {
      const source = readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8');
      for (const [ref] of source.matchAll(/\b20\d{12}\b/g)) {
        expect(timestamps.has(ref), `${name} references ${ref}`).toBe(true);
      }
    }
  });
});
