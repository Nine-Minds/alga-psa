import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const recurringBillingRunActionsSource = fs.readFileSync(
  path.resolve(
    process.cwd(),
    '../packages/billing/src/actions/recurringBillingRunActions.ts',
  ),
  'utf8',
);

describe('recurring billing run actions source', () => {
  it('T028: recurring run actions no longer accept raw billingCycleIds or billing-period selection helpers', () => {
    expect(recurringBillingRunActionsSource).not.toContain('billingCycleIds?: string[]');
    expect(recurringBillingRunActionsSource).not.toContain('getAvailableBillingPeriods(');
    expect(recurringBillingRunActionsSource).not.toContain('buildClientBillingCycleExecutionWindow');
  });
});
