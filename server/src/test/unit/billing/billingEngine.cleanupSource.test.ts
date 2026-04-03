import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const billingEngineSource = fs.readFileSync(
  path.resolve(
    process.cwd(),
    '../packages/billing/src/lib/billing/billingEngine.ts',
  ),
  'utf8',
);

describe('BillingEngine recurring timing cleanup source contracts', () => {
  it('T163: source cleanup removes resolveServicePeriod from migrated recurring charge execution paths', () => {
    expect(billingEngineSource).not.toContain('private async resolveServicePeriod(');
    expect(billingEngineSource).not.toContain('.resolveServicePeriod(');
  });

  it('T164: source cleanup removes duplicated late-stage proration helpers from migrated recurring charge paths', () => {
    expect(billingEngineSource).not.toContain('private _calculateProrationFactor(');
    expect(billingEngineSource).not.toContain('private applyProrationToPlan(');
    expect(billingEngineSource).not.toContain('const proratedFixedCharges =');
  });
});
