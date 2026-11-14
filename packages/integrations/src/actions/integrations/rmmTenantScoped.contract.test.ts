import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const readSource = (file: string) => readFileSync(resolve(__dirname, file), 'utf8');

describe('RMM integrations tenant-scoped query contracts', () => {
  // The queries moved to lib/rmm/rmmIntegrationStatus.ts so the v1 API can
  // share them without importing a 'use server' module. The scoping contract
  // follows the queries — and still holds the action to introducing none of its
  // own.
  it('uses tenantDb for integration status roots', () => {
    const source = readSource('../../lib/rmm/rmmIntegrationStatus.ts');

    expect(source).toContain("import { tenantDb } from '@alga-psa/db';");
    expect(source).toContain('const db = tenantDb(knex, tenant);');
    expect(source).toContain("db.table('rmm_integrations')");
    expect(source).toContain("db.table('assets')");
    expect(source).not.toContain("knex('rmm_integrations')");
    expect(source).not.toContain("knex('assets')");
    expect(source).not.toContain('.where({ tenant })');
  });

  it('keeps raw queries out of the status action itself', () => {
    const source = readSource('rmmIntegrationStatusActions.ts');

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
  it('keeps every UniFi action tier-gated, RBAC-checked and tenantDb-scoped', () => {
    const actions = readSource('../../../../../ee/server/src/lib/actions/integrations/uniFiActions.ts');
    const sync = readSource('../../../../../ee/server/src/lib/integrations/unifi/sync/syncEngine.ts');
    const fetcher = readSource('../../../../../ee/server/src/lib/integrations/unifi/alerts/reconciliationFetcher.ts');

    const exported = [...actions.matchAll(/^export const (\w+) = (\w+)\(/gm)];
    expect(exported.map((m) => m[1])).toEqual(
      expect.arrayContaining([
        'getUniFiSettings',
        'saveUniFiConfiguration',
        'testUniFiConnection',
        'disconnectUniFiIntegration',
        'syncUniFiSites',
        'listUniFiSiteMappings',
        'updateUniFiSiteMapping',
        'triggerUniFiFullSync',
        'syncUniFiSingleDevice',
        'runUniFiAlertCheckNow',
        'getUniFiConnectionSummary',
      ])
    );
    for (const [, name, wrapper] of exported) {
      expect(wrapper, name).toBe('withAdvancedAssetsAccess');
    }
    // Every action body checks system_settings RBAC (read for getters, update otherwise).
    expect((actions.match(/hasPermission\(user as any, 'system_settings', '(read|update)'\)/g) ?? []).length).toBe(
      exported.length
    );
    expect(actions).toContain('assertTierAccess(TIER_FEATURES.ADVANCED_ASSETS)');

    const combined = `${actions}\n${sync}\n${fetcher}`;
    expect(actions).toContain("import { tenantDb } from '@alga-psa/db';");
    expect(sync).toContain("import { tenantDb } from '@alga-psa/db';");
    for (const table of ['assets', 'clients', 'rmm_alerts', 'rmm_integrations', 'rmm_organization_mappings', 'tenant_external_entity_mappings']) {
      expect(combined).not.toMatch(new RegExp(`\\b(?:knex|trx|deps\\.knex)\\s*\\(\\s*['"]${table}['"]\\s*\\)`));
    }
    expect(combined).not.toMatch(/\.where\(\{\s*tenant/);
  });
});
