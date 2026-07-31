import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '../slaActions.ts'), 'utf8');

function sourceBetween(start: string): string {
  const startIndex = source.indexOf(start);

  expect(startIndex).toBeGreaterThanOrEqual(0);

  return source.slice(startIndex);
}

describe('SLA bulk assignment and resolution tenant-scoped query contract', () => {
  it('uses structural tenant scoping for bulk assignment and resolver roots', () => {
    const section = sourceBetween('// Batch Board/Client Assignment');

    expect(section).toContain("tenantScopedTable(trx, 'boards', tenant)");
    expect(section).toContain("tenantScopedTable(trx, 'clients', tenant)");
    expect(section).toContain("tenantScopedTable(trx, 'sla_policies', tenant)");
    expect(section).toContain("tenantScopedTable(trx, 'tickets', tenant)");
    expect(section).toContain("tenantScopedTable(trx, 'sla_policy_targets', tenant)");
    expect(section).toContain("tenantScopedTable(trx, 'sla_notification_thresholds', tenant)");
    expect(section).not.toContain('.where({ tenant })');
    expect(section).not.toContain('.where({ tenant, sla_policy_id: policyId');
    expect(section).not.toContain('.where({ tenant, client_id:');
    expect(section).not.toContain('.where({ tenant, board_id:');
    expect(section).not.toContain('.where({ tenant, is_default: true');
    expect(section).not.toContain('.where({ tenant, ticket_id: ticketId');
  });
});
