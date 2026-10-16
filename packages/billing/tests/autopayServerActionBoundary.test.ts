import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Every export of a 'use server' module is a publicly callable server action.
// The auto-pay bridge trusts its tenantId argument, so it must stay out of them.
const TENANT_TRUSTING_EXPORTS = [
  'startSavedPaymentMethodSetup', 'inspectSavedPaymentMethodSetup', 'completeSavedPaymentMethodSetup',
  'removeSavedPaymentMethod', 'getAutopayProfileOverview', 'enrollBillingProfileAutopay',
  'disableBillingProfileAutopay', 'getInvoiceAutopayContextsForTenant', 'startInvoiceAutopay',
  'signalAutopayInvoiceSettled', 'chargeInvoiceWithAutopayNow',
];

const FORBIDDEN_AUTOPAY_JOB_REFERENCES = /scheduleImmediateJob|scheduleRecurringJob|pg-boss|pgboss|invoice_autopay_(?:schedule|process)|autopay-due-attempts/;
const FORBIDDEN_LEGACY_JOB_NAMES = /invoice_autopay_(?:schedule|process)|scheduleAutopaySweepJob|autopay-due-attempts/;

function listFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(fullPath) : /\.(?:ts|tsx|js|mjs|cjs)$/.test(entry.name) ? [fullPath] : [];
  });
}

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

  it('keeps every auto-pay source file free of pg-boss scheduling paths', () => {
    const root = path.resolve(__dirname, '../../..');
    const candidates = [
      ...listFiles(path.join(root, 'ee/server/src/lib/payments')),
      path.join(root, 'ee/server/src/lib/temporal/invoiceAutopay.ts'),
      path.join(root, 'packages/billing/src/services/autopayBridge.ts'),
    ];
    for (const file of candidates) {
      const source = readFileSync(file, 'utf8');
      expect(source, path.relative(root, file)).not.toMatch(FORBIDDEN_AUTOPAY_JOB_REFERENCES);
    }
    const legacyPaths = [
      'server/src/lib/jobs/index.ts',
      'server/src/lib/jobs/initializeScheduledJobs.ts',
      'server/src/lib/eventBus/subscribers/maintenanceJobSubscriber.ts',
      'ee/temporal-workflows/src/schedules/setupSchedules.ts',
      'ee/temporal-workflows/src/activities/tenant-deletion-activities.ts',
    ];
    for (const relativePath of legacyPaths) {
      expect(readFileSync(path.join(root, relativePath), 'utf8'), relativePath).not.toMatch(FORBIDDEN_LEGACY_JOB_NAMES);
    }
  });
});
