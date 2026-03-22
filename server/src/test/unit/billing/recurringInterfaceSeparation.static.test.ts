import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('recurring interface separation', () => {
  it('T071: shared package/server interfaces separate client billing cycle models from recurring execution models', () => {
    const recurringTimingSource = readFileSync(
      resolve(
        __dirname,
        '../../../../../packages/types/src/interfaces/recurringTiming.interfaces.ts',
      ),
      'utf8',
    );
    const packageBillingSource = readFileSync(
      resolve(
        __dirname,
        '../../../../../packages/types/src/interfaces/billing.interfaces.ts',
      ),
      'utf8',
    );
    const serverBillingSource = readFileSync(
      resolve(__dirname, '../../../interfaces/billing.interfaces.ts'),
      'utf8',
    );

    const invoiceWindowSource = recurringTimingSource.slice(
      recurringTimingSource.indexOf('export interface IRecurringInvoiceWindow'),
      recurringTimingSource.indexOf('export interface IRecurringCoverage'),
    );

    expect(invoiceWindowSource).not.toContain('billingCycleId');
    expect(packageBillingSource).not.toContain('IBillingCycleInvoiceRequest');
    expect(serverBillingSource).not.toContain('IBillingCycleInvoiceRequest');
    expect(packageBillingSource).toContain("export type BillingCycleType = 'weekly'");
    expect(recurringTimingSource).toContain("export interface IRecurringRunExecutionWindowIdentity");
  });
});
