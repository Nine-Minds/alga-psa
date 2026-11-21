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

  it('organization SLA clock, store, notifications and lock obey the same structural scoping', () => {
    const dir = path.resolve(import.meta.dirname, '../../../../../shared/lib/sla');
    const store = ['organizationSlaStore.ts', 'organizationSlaNotifications.ts']
      .map(file => fs.readFileSync(path.join(dir, file), 'utf8')).join('\n');
    expect(store).toContain("import { tenantDb } from '@alga-psa/db';");
    expect(store).toContain('tenantDb(trx, ');
    expect(store).not.toMatch(/\.where\(\{\s*tenant[,}]/);
    expect(store).not.toMatch(/\.where\(['"]tenant['"],/);
    const clock = fs.readFileSync(path.join(dir, 'organizationSlaClock.ts'), 'utf8');
    expect(clock).not.toMatch(/knex|Date\.now\(\)|i18n/);
  });
});
