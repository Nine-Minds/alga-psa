import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const readSource = (file: string) => readFileSync(resolve(__dirname, file), 'utf8');

describe('RMM integrations tenant-scoped query contracts', () => {
  it('uses tenantDb for integration status roots', () => {
    const source = readSource('rmmIntegrationStatusActions.ts');

    expect(source).toContain("import { createTenantKnex, tenantDb } from '@alga-psa/db';");
    expect(source).toContain('const db = tenantDb(knex, tenant);');
    expect(source).toContain("db.table('rmm_integrations')");
    expect(source).toContain("db.table('assets')");
    expect(source).not.toContain("knex('rmm_integrations')");
    expect(source).not.toContain("knex('assets')");
    expect(source).not.toContain('.where({ tenant })');
  });

  it('uses tenantDb for registered RMM alert settings and option roots', () => {
    const source = readSource('rmmAlertRuleActions.ts');

    expect(source).toContain("import { createTenantKnex, tenantDb } from '@alga-psa/db';");
    for (const table of [
      'rmm_alert_rules',
      'rmm_maintenance_windows',
      'rmm_integrations',
      'boards',
      'priorities',
      'statuses',
      'users',
      'rmm_organization_mappings',
    ]) {
      expect(source).toContain(`table('${table}')`);
      expect(source).not.toContain(`knex('${table}')`);
    }
    expect(source).not.toContain("trx('rmm_alert_rules')");
    expect(source).not.toContain(".where({ tenant, provider: input.provider })");
    expect(source).not.toContain(".where({ tenant, rule_id: input.ruleId })");
    expect(source).not.toContain(".where({ tenant, window_id: input.windowId })");
    expect(source).not.toContain(".where({ tenant, status_type: 'ticket', is_closed: true })");
  });
});
