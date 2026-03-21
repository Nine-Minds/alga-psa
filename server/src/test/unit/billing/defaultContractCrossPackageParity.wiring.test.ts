import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readRepo = (relativePath: string): string =>
  readFileSync(resolve(__dirname, '../../../../../', relativePath), 'utf8');

describe('default-contract cross-package parity wiring', () => {
  it('F066: integration-created clients keep first billing-config touchpoint default-contract ensure hook', () => {
    const source = readRepo('packages/integrations/src/services/xeroCsvClientSyncService.ts');
    expect(source).toContain('ensureDefaultContractForClientIfBillingConfigured');
    expect(source).toContain('await ensureDefaultContractForClientIfBillingConfigured(trx, {');
    expect(source).toContain('await trx(\'clients\').insert({');
  });

  it('F067: package action layers continue using shared billing-settings ensure helpers', () => {
    const sharedBillingSettingsSource = readRepo('shared/billingClients/billingSettings.ts');
    const sharedBillingScheduleSource = readRepo('shared/billingClients/billingSchedule.ts');
    const billingCycleAnchorActionsSource = readRepo('packages/billing/src/actions/billingCycleAnchorActions.ts');
    const billingScheduleActionsSource = readRepo('packages/billing/src/actions/billingScheduleActions.ts');

    expect(sharedBillingSettingsSource).toContain('await ensureDefaultContractForClient(trx, params);');
    expect(sharedBillingScheduleSource).toContain('import { ensureClientBillingSettingsRow } from \'./billingSettings\';');
    expect(billingCycleAnchorActionsSource).toContain('import { ensureClientBillingSettingsRow } from \'@shared/billingClients/billingSettings\';');
    expect(billingScheduleActionsSource).toContain('import { ensureClientBillingSettingsRow } from \'./billingCycleAnchorActions\';');
  });

  it('T018: integration-created clients still rely on first qualifying billing-config touchpoint for default-contract ensure', () => {
    const source = readRepo('packages/integrations/src/services/xeroCsvClientSyncService.ts');
    expect(source).toContain('await trx(\'clients\').insert({');
    expect(source).toContain('await ensureDefaultContractForClientIfBillingConfigured(trx, {');
    expect(source).toContain('tenant,');
    expect(source).toContain('clientId,');
  });
});
