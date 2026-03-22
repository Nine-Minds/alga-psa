import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sharedBillingScheduleSource = readFileSync(
  resolve(__dirname, '../../../../../shared/billingClients/billingSchedule.ts'),
  'utf8',
);
const billingEngineSource = readFileSync(
  resolve(__dirname, '../../../../../packages/billing/src/lib/billing/billingEngine.ts'),
  'utf8',
);
const billingAndTaxSource = readFileSync(
  resolve(__dirname, '../../../../../packages/billing/src/actions/billingAndTax.ts'),
  'utf8',
);

// This test locks the cross-module contract required for historical backdated unmatched work:
// history bootstrap creates historical client schedule windows, and default-contract runtime
// billing uses client-schedule timing + default attribution/pricing semantics.
describe('historical bootstrap + default-contract billing route wiring', () => {
  it('T023: back-dated unmatched work path is anchored to client schedule windows with system-managed default attribution semantics', () => {
    expect(sharedBillingScheduleSource).toContain('billingHistoryStartDate?: ISO8601String | null;');
    expect(sharedBillingScheduleSource).toContain('resolveNormalizedBootstrapBoundary');
    expect(sharedBillingScheduleSource).toContain('regenerateHistoricalClientBillingCyclesFromBootstrap');
    expect(sharedBillingScheduleSource).toContain("Cannot move billing history earlier than invoiced history boundary");

    expect(billingEngineSource).toContain('const isSystemManagedDefault = (clientContractLine as { is_system_managed_default?: boolean | null })');
    expect(billingEngineSource).toContain('const cadenceOwner = isSystemManagedDefault');
    expect(billingEngineSource).toContain('? "client"');
    expect(billingEngineSource).toContain('if (serviceConfig && !isSystemManagedDefault) {');

    expect(billingAndTaxSource).toContain("source === 'system_managed_default_contract'");
    expect(billingAndTaxSource).toContain("label: source === 'system_managed_default_contract'");
    expect(billingAndTaxSource).toContain("'System-managed default contract'");
  });
});
