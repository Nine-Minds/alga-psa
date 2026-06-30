import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '../slaActions.ts'), 'utf8');

function sourceBetween(start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);

  return source.slice(startIndex, endIndex);
}

describe('SLA threshold and assignment actions tenant-scoped query contract', () => {
  it('uses structural tenant scoping for thresholds and direct client/board assignments', () => {
    const section = sourceBetween(
      '// SLA Notification Thresholds',
      '// Batch Board/Client Assignment',
    );

    expect(section).toContain("tenantScopedTable(trx, 'sla_notification_thresholds', tenant)");
    expect(section).toContain("tenantScopedTable(trx, 'sla_policies', tenant)");
    expect(section).toContain("tenantScopedTable(trx, 'clients', tenant)");
    expect(section).toContain("tenantScopedTable(trx, 'boards', tenant)");
    expect(section).not.toContain('.where({ tenant, sla_policy_id: policyId');
    expect(section).not.toContain('.where({ tenant, client_id: clientId');
    expect(section).not.toContain('.where({ tenant, board_id: boardId');
    expect(section).not.toContain('.where({ tenant, sla_policy_id: client.sla_policy_id');
    expect(section).not.toContain('.where({ tenant, sla_policy_id: board.sla_policy_id');
  });
});
