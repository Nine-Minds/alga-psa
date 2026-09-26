import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Every export of a 'use server' module is a publicly callable server action.
// The auto-pay bridge trusts its tenantId argument, so it must stay out of them.
const TENANT_TRUSTING_EXPORTS = [
  'startSavedPaymentMethodSetup', 'inspectSavedPaymentMethodSetup', 'completeSavedPaymentMethodSetup',
  'removeSavedPaymentMethod', 'getAutopayProfileOverview', 'enrollBillingProfileAutopay',
  'disableBillingProfileAutopay', 'getInvoiceAutopayContextsForTenant', 'enqueueInvoiceAutopay',
];

describe('auto-pay server-action boundary', () => {
  it('keeps tenant-trusting auto-pay functions out of the paymentActions server-action module', () => {
    const source = readFileSync(path.resolve(__dirname, '../src/actions/paymentActions.ts'), 'utf8');
    expect(source.startsWith("'use server'")).toBe(true);
    for (const name of TENANT_TRUSTING_EXPORTS) {
      expect(source).not.toMatch(new RegExp(`export\\s+(async\\s+)?(function|const)\\s+${name}\\b`));
    }
  });

  it('keeps the bridge module free of the use server directive', () => {
    const source = readFileSync(path.resolve(__dirname, '../src/services/autopayBridge.ts'), 'utf8');
    expect(source).not.toMatch(/^\s*['"]use server['"]/m);
  });
});
