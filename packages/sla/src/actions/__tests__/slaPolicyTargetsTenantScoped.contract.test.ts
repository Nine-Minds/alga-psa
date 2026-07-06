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

describe('SLA policy target actions tenant-scoped query contract', () => {
  it('uses structural tenant scoping for target CRUD and upsert roots', () => {
    const targetsSection = sourceBetween(
      '// SLA Policy Targets',
      '// SLA Notification Thresholds',
    );

    expect(targetsSection).toContain("tenantScopedTable(trx, 'sla_policy_targets', tenant)");
    expect(targetsSection).toContain("tenantScopedTable(trx, 'sla_policies', tenant)");
    expect(targetsSection).toContain("tenantScopedTable(trx, 'priorities', tenant)");
    expect(targetsSection).not.toContain('.where({ tenant, sla_policy_id: policyId');
    expect(targetsSection).not.toContain('.where({ tenant, target_id: targetId');
    expect(targetsSection).not.toContain('.where({ tenant, priority_id:');
    expect(targetsSection).not.toContain('.where({ tenant, sla_policy_id: existingTarget.sla_policy_id');
    expect(targetsSection).not.toContain('.where({ tenant, target_id: existing.target_id');
  });
});
