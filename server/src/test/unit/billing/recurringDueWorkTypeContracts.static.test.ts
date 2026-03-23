import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const recurringTimingSource = fs.readFileSync(
  path.resolve(process.cwd(), '../packages/types/src/interfaces/recurringTiming.interfaces.ts'),
  'utf8',
);

const billingAndTaxSource = fs.readFileSync(
  path.resolve(process.cwd(), '../packages/billing/src/actions/billingAndTax.ts'),
  'utf8',
);

const automaticInvoicesSource = fs.readFileSync(
  path.resolve(process.cwd(), '../packages/billing/src/components/billing-dashboard/AutomaticInvoices.tsx'),
  'utf8',
);

describe('recurring due-work type contracts', () => {
  it('T115: paginated recurring due-work response and materialization-gap interfaces are centralized in @alga-psa/types and consumed by billing action/UI layers', () => {
    expect(recurringTimingSource).toContain('export interface IRecurringDueWorkMaterializationGap');
    expect(recurringTimingSource).toContain('export interface IRecurringDueWorkPaginatedResponse');

    expect(billingAndTaxSource).toContain('type PaginatedRecurringDueWorkResult = IRecurringDueWorkPaginatedResponse');
    expect(billingAndTaxSource).toContain('type RecurringDueWorkMaterializationGap = IRecurringDueWorkMaterializationGap');
    expect(billingAndTaxSource).not.toContain('export interface PaginatedRecurringDueWorkResult');
    expect(billingAndTaxSource).not.toContain('export interface RecurringDueWorkMaterializationGap');

    expect(automaticInvoicesSource).toContain('IRecurringDueWorkMaterializationGap');
    expect(automaticInvoicesSource).toContain("from '@alga-psa/types'");
    expect(automaticInvoicesSource).not.toContain('type RecurringDueWorkMaterializationGap,');
  });

  it('T116: recurring due-work billingCycleId metadata is explicitly tagged as legacy display-only bridge metadata', () => {
    const dueWorkRowSource = recurringTimingSource.slice(
      recurringTimingSource.indexOf('export interface IRecurringDueWorkRow'),
      recurringTimingSource.indexOf('export interface IRecurringDueWorkInvoiceCandidate'),
    );
    const materializationGapSource = recurringTimingSource.slice(
      recurringTimingSource.indexOf('export interface IRecurringDueWorkMaterializationGap'),
      recurringTimingSource.indexOf('export interface IRecurringDueWorkPaginatedResponse'),
    );

    expect(dueWorkRowSource).toContain('@deprecated Legacy bridge metadata for compatibility display only.');
    expect(dueWorkRowSource).toContain('billingCycleId?: string | null;');

    expect(materializationGapSource).toContain('@deprecated Legacy bridge metadata for compatibility display only.');
    expect(materializationGapSource).toContain('billingCycleId?: string | null;');
  });
});
