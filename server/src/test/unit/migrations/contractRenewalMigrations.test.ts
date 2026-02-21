import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('contract renewal migrations', () => {
  it('T244: creates required renewal queue status/audit columns on client_contracts', () => {
    const migration = readRepoFile(
      'server/migrations/202602211100_add_contract_renewal_queue_status_audit_columns.cjs'
    );

    expect(migration).toContain("table.text('status').notNullable().defaultTo('pending')");
    expect(migration).toContain("table.date('snoozed_until').nullable()");
    expect(migration).toContain("table.uuid('assigned_to').nullable()");
    expect(migration).toContain("table.text('last_action').nullable()");
    expect(migration).toContain("table.uuid('last_action_by').nullable()");
    expect(migration).toContain("table.timestamp('last_action_at').nullable()");
    expect(migration).toContain("table.text('last_action_note').nullable()");
    expect(migration).toContain("CHECK (status IN ('pending', 'renewing', 'non_renewing', 'snoozed', 'completed'))");
  });

  it('T245: creates required renewal-cycle columns on client_contracts', () => {
    const migration = readRepoFile(
      'server/migrations/202602211105_add_contract_renewal_cycle_columns.cjs'
    );

    expect(migration).toContain("table.date('decision_due_date').nullable()");
    expect(migration).toContain("table.date('renewal_cycle_start').nullable()");
    expect(migration).toContain("table.date('renewal_cycle_end').nullable()");
    expect(migration).toContain("table.text('renewal_cycle_key').nullable()");
    expect(migration).toContain("table.dropColumn('renewal_cycle_key')");
    expect(migration).toContain("table.dropColumn('renewal_cycle_end')");
    expect(migration).toContain("table.dropColumn('renewal_cycle_start')");
    expect(migration).toContain("table.dropColumn('decision_due_date')");
  });
});
