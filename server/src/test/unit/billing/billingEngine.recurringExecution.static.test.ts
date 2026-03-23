import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const billingEngineSource = fs.readFileSync(
  path.join(process.cwd(), '../packages/billing/src/lib/billing/billingEngine.ts'),
  'utf8',
);

const selectDueRecurringSection = billingEngineSource
  .split('async selectDueRecurringServicePeriodsForBillingWindow')[1]
  .split('private async loadPersistedRecurringTimingSelections')[0];

const persistedSelectionSection = billingEngineSource
  .split('private async loadPersistedRecurringTimingSelections')[1]
  .split('private async calculateBillingInternal')[0];

const preparedBillingSection = billingEngineSource
  .split('private async calculateBillingForPreparedPeriod')[1]
  .split('private async getClientContractLinesForBillingPeriod')[0];

describe('billing engine recurring execution cutover', () => {
  it('T051: selector-input recurring execution no longer rebuilds due work from client billing cycles', () => {
    expect(selectDueRecurringSection).toContain(
      'getClientContractLinesForBillingPeriod',
    );
    expect(selectDueRecurringSection).not.toContain(
      'getClientContractLinesAndCycle',
    );
    expect(selectDueRecurringSection).not.toContain(
      'buildRecurringTimingSelections',
    );
    expect(selectDueRecurringSection).toContain(
      'Recurring service periods have not been materialized',
    );
  });

  it('allows persisted recurring execution selections for all runtime contract lines instead of filtering back to legacy fixed-only cadence assumptions', () => {
    expect(persistedSelectionSection).toContain(
      'clientContractLines.map((line) => line.client_contract_line_id)',
    );
    expect(persistedSelectionSection).not.toContain(
      '.filter((line) => this.isRecurringTimingEligibleContractLine(line))',
    );
  });

  it('T051: persisted recurring execution bypasses billing-cycle validation and loaders', () => {
    expect(preparedBillingSection).toContain(
      'options.recurringTimingSelectionSource !== "persisted"',
    );
    expect(preparedBillingSection).toContain(
      'clientContractLines = await this.getClientContractLinesForBillingPeriod',
    );
    expect(preparedBillingSection).toContain(
      'const plansResult = await this.getClientContractLinesAndCycle',
    );
  });
});
