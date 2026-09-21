import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const servicePath = path.resolve(import.meta.dirname, '../slaService.ts');

describe('slaService tenant-scoped query contract', () => {
  it('uses structural tenant scoping for SLA lifecycle roots', () => {
    const source = [servicePath, path.resolve(import.meta.dirname, '../../../../../shared/lib/sla/slaPolicyResolver.ts')]
      .map(file => fs.readFileSync(file, 'utf8')).join('\n');

    expect(source).toContain("import { tenantDb } from '@alga-psa/db';");
    expect(source).toContain('function tenantScopedTable(');
    expect(source).toContain('tenantDb(conn, tenant).table(table)');
    expect(source).not.toContain('createTenantScopedQuery');

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
