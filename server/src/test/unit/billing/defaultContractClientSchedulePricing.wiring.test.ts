import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const billingEngineSource = readFileSync(
  resolve(__dirname, '../../../../../packages/billing/src/lib/billing/billingEngine.ts'),
  'utf8',
);

describe('system-managed default runtime billing routing and pricing wiring', () => {
  it('F075: forces client schedule cadence semantics for system-managed default lines', () => {
    expect(billingEngineSource).toContain('const isSystemManagedDefault = (clientContractLine as { is_system_managed_default?: boolean | null })');
    expect(billingEngineSource).toContain('const cadenceOwner = isSystemManagedDefault');
    expect(billingEngineSource).toContain('? "client"');
    expect(billingEngineSource).toContain(': resolveCadenceOwner(clientContractLine.cadence_owner);');
  });

  it('F076: ignores contract-authored service configuration pricing overrides for system-managed default lines', () => {
    expect(billingEngineSource).toContain('if (serviceConfig && !isSystemManagedDefault) {');
    // Per-user-type override is still gated on !isSystemManagedDefault, but now reads as a const
    // assignment inside the time-rate resolution chain rather than a standalone if-statement.
    expect(billingEngineSource).toContain('!isSystemManagedDefault &&');
    expect(billingEngineSource).toContain('serviceConfig.userTypeRates.has(entry.user_type)');
    expect(billingEngineSource).toContain('serviceConfig.config.custom_rate');
    expect(billingEngineSource).toContain('serviceConfig.config.enable_tiered_pricing');
  });
});
