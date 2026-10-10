import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const contractCadenceSource = readFileSync(
  resolve(__dirname, '../../../../../packages/billing/src/actions/contractCadenceServicePeriodMaterialization.ts'),
  'utf8',
);
const clientCadenceSource = readFileSync(
  resolve(__dirname, '../../../../../shared/billingClients/clientCadenceScheduleRegeneration.ts'),
  'utf8',
);
const recurringAdminSource = readFileSync(
  resolve(__dirname, '../../../../../packages/billing/src/actions/recurringServicePeriodActions.ts'),
  'utf8',
);

const liveLineScopeSource = readFileSync(
  resolve(__dirname, '../../../../../shared/billingClients/liveRecurringLineScope.ts'),
  'utf8',
);

describe('system-managed default recurring exclusion wiring', () => {
  it('T024: system-managed default contracts never materialize recurring service periods or appear as schedulable recurring obligations', () => {
    // The system-managed-default exclusion now lives in the shared live-line scope
    // helper (alga0002168); the materializers must adopt it with the exclusion on.
    expect(liveLineScopeSource).toContain('.whereNull(`${aliases.ct}.is_system_managed_default`)');
    expect(liveLineScopeSource).toContain('.orWhere(`${aliases.ct}.is_system_managed_default`, false)');
    expect(contractCadenceSource).toContain('scopeToLiveRecurringContractLines(');
    expect(contractCadenceSource).toContain('{ excludeSystemManagedDefault: true }');
    expect(clientCadenceSource).toContain('scopeToLiveRecurringContractLines(');
    expect(clientCadenceSource).toContain('{ excludeSystemManagedDefault: true }');

    expect(recurringAdminSource).toContain('context.is_system_managed_default');
    expect(recurringAdminSource).toContain('System-managed default contracts are attribution-only and cannot be managed in recurring service period admin tools.');
    expect(recurringAdminSource).toContain(".where((builder: any) =>");
    expect(recurringAdminSource).toContain("builder.whereNull('ct.is_system_managed_default').orWhere('ct.is_system_managed_default', false)");
  });
});
