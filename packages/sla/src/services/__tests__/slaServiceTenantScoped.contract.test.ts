import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const servicePath = path.resolve(import.meta.dirname, '../slaService.ts');

describe('slaService tenant-scoped query contract', () => {
  it('uses structural tenant scoping for SLA lifecycle roots', () => {
    const source = fs.readFileSync(servicePath, 'utf8');

    expect(source).toContain("import { createTenantScopedQuery } from '@alga-psa/db';");
    expect(source).toContain('function tenantScopedTable(');
    expect(source).toContain('createTenantScopedQuery(conn, { table, tenant }).builder');

    [
      'tickets',
      'sla_notification_thresholds',
      'clients',
      'boards',
      'sla_policies',
      'sla_policy_targets',
      'business_hours_schedules',
      'business_hours_entries',
      'holidays',
    ].forEach((table) => {
      expect(source).toContain(`'${table}'`);
    });

    expect(source).not.toMatch(/\.where\(\{\s*tenant[,}]/);
    expect(source).not.toMatch(/\.where\(\{\s*'[^']*\.tenant':\s*tenant/);
    expect(source).not.toMatch(/\.where\(['"]tenant['"],\s*tenant\)/);
  });
});
