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

describe('SLA policy actions tenant-scoped query contract', () => {
  it('uses structural tenant scoping for policy-management roots', () => {
    const policySection = sourceBetween(
      '// SLA Policies',
      '// SLA Policy Targets',
    );

    expect(source).toContain("import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db'");
    expect(source).toContain('function tenantScopedTable(');
    expect(source).toContain('tenantDb(conn, tenant).table(table)');
    expect(source).not.toContain('createTenantScopedQuery');
    expect(policySection).toContain("tenantScopedTable(trx, 'sla_policies', tenant)");
    expect(policySection).toContain("tenantScopedTable(trx, 'sla_policy_targets', tenant)");
    expect(policySection).toContain("tenantScopedTable(trx, 'sla_notification_thresholds', tenant)");
    expect(policySection).toContain("tenantScopedTable(trx, 'boards', tenant)");
    expect(policySection).toContain("tenantScopedTable(trx, 'clients', tenant)");
    expect(policySection).toContain("tenantScopedTable(trx, 'tickets', tenant)");
    expect(policySection).not.toContain('.where({ tenant })');
    expect(policySection).not.toContain('.where({ tenant, sla_policy_id: policyId');
    expect(policySection).not.toContain('.where({ tenant, is_default: true');
  });
});
