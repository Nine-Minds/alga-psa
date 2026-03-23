import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const recurringTimingSource = fs.readFileSync(
  path.resolve(
    process.cwd(),
    '../packages/types/src/interfaces/recurringTiming.interfaces.ts',
  ),
  'utf8',
);

describe('recurring identity shared types', () => {
  it('T009: shared recurring identity interfaces remove bridge-only billingCycleId and hasBillingCycleBridge fields', () => {
    const executionWindowSource = recurringTimingSource.slice(
      recurringTimingSource.indexOf('export interface IRecurringRunExecutionWindowIdentity'),
      recurringTimingSource.indexOf('export type RecurringDueWorkCadenceSource'),
    );
    const dueSelectionSource = recurringTimingSource.slice(
      recurringTimingSource.indexOf('export interface IRecurringDueSelectionInput'),
      recurringTimingSource.indexOf('export interface IRecurringDueWorkRow'),
    );
    const dueWorkRowSource = recurringTimingSource.slice(
      recurringTimingSource.indexOf('export interface IRecurringDueWorkRow'),
      recurringTimingSource.indexOf('export interface IRecurringServicePeriodDueSelectionQuery'),
    );
    const executionWindowKindsSource = recurringTimingSource.slice(
      recurringTimingSource.indexOf('export const RECURRING_RUN_EXECUTION_WINDOW_KINDS'),
      recurringTimingSource.indexOf('export const DUE_POSITIONS'),
    );

    expect(executionWindowSource).not.toContain('billingCycleId');
    expect(dueSelectionSource).not.toContain('billingCycleId');
    expect(dueWorkRowSource).not.toContain('hasBillingCycleBridge');
    expect(executionWindowKindsSource).not.toContain('billing_cycle_window');
  });
});
