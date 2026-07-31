import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const migration = readFileSync(
  resolve(__dirname, '../../../../migrations/20260709120000_add_suppression_to_board_auto_close_rules.cjs'),
  'utf8',
);

describe('auto-close suppression migration', () => {
  it('adds both suppression columns with non-null false defaults and a coupling check', () => {
    expect(migration).toContain("hasColumn('board_auto_close_rules', 'suppress_contact_notifications')");
    expect(migration).toContain("hasColumn('board_auto_close_rules', 'suppress_internal_notifications')");
    expect(migration).toContain("table.boolean('suppress_contact_notifications').notNullable().defaultTo(false)");
    expect(migration).toContain("table.boolean('suppress_internal_notifications').notNullable().defaultTo(false)");
    expect(migration).toContain('board_auto_close_rules_suppression_check');
    expect(migration).toContain('CHECK (suppress_contact_notifications OR NOT suppress_internal_notifications)');
  });

  it('drops the check and both columns on rollback', () => {
    expect(migration).toContain('DROP CONSTRAINT IF EXISTS board_auto_close_rules_suppression_check');
    expect(migration).toContain("table.dropColumn('suppress_internal_notifications')");
    expect(migration).toContain("table.dropColumn('suppress_contact_notifications')");
  });
});
