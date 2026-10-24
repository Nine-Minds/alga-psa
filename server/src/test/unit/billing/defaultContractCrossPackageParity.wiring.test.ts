import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readRepo = (relativePath: string): string =>
  readFileSync(resolve(__dirname, '../../../../../', relativePath), 'utf8');

describe('default-contract cross-package parity wiring', () => {
  it('F066: integration-created clients keep first billing-config touchpoint default-contract ensure hook', () => {
    // Xero-created clients no longer own their `clients` insert: the shared
    // creation seam does the insert and carries the default-contract ensure
    // hook for every creation path, so the parity assertion follows it there.
    const xeroSource = readRepo('packages/integrations/src/services/xeroCsvClientSyncService.ts');
    const seamSource = readRepo('shared/models/clientCreation.ts');

    expect(xeroSource).toMatch(/await createClientWithDefaults\(\s*trx,\s*tenant,/);
    expect(seamSource).toContain('ensureDefaultContractForClientIfBillingConfigured');
    expect(seamSource).toContain('await ensureDefaultContractForClientIfBillingConfigured(trx, {');
    expect(seamSource).toContain('await db.table(\'clients\')');
  });

  it('F067: package action layers continue using shared billing-settings ensure helpers', () => {
    const sharedBillingSettingsSource = readRepo('shared/billingClients/billingSettings.ts');
    const sharedBillingScheduleSource = readRepo('shared/billingClients/billingSchedule.ts');
    const billingCycleAnchorActionsSource = readRepo('packages/billing/src/actions/billingCycleAnchorActions.ts');
    const billingScheduleActionsSource = readRepo('packages/billing/src/actions/billingScheduleActions.ts');

    expect(sharedBillingSettingsSource).toContain('await ensureDefaultContractForClient(trx, params);');
    expect(sharedBillingScheduleSource).toContain('import { ensureClientBillingSettingsRow } from \'./billingSettings\';');
    expect(billingCycleAnchorActionsSource).toContain('import { ensureClientBillingSettingsRow } from \'@shared/billingClients/billingSettings\';');
    // billingScheduleActions now routes settings/cadence changes through the
    // shared applyClientCadenceChange layer (which keeps the billing-settings
    // and recurring_service_periods ledger consistent) instead of importing the
    // ensure helper directly; assert that shared wiring stays in place.
    expect(billingScheduleActionsSource).toContain('applyClientCadenceChange');
    expect(billingScheduleActionsSource).toContain('from \'@alga-psa/shared/billingClients\'');
  });

  it('T018: integration-created clients still rely on first qualifying billing-config touchpoint for default-contract ensure', () => {
    const xeroSource = readRepo('packages/integrations/src/services/xeroCsvClientSyncService.ts');
    const seamSource = readRepo('shared/models/clientCreation.ts');

    // The integration path must not re-grow its own insert; the gated ensure
    // call stays adjacent to the single insert inside the seam.
    expect(xeroSource).not.toContain('await db.table(\'clients\').insert({');
    expect(seamSource).toContain('await db.table(\'clients\')');
    expect(seamSource).toContain('.insert({');
    expect(seamSource).toContain('await ensureDefaultContractForClientIfBillingConfigured(trx, {');
    expect(seamSource).toContain('tenant,');
    expect(seamSource).toContain('clientId: created.client_id,');
  });
});
