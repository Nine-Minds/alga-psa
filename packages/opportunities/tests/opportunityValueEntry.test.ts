import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  amountsToCents,
  centsToAmounts,
} from '../src/components/dialogs/OpportunityValueFields';

function source(relative: string) {
  return fs.readFileSync(path.resolve(__dirname, relative), 'utf8');
}

describe('shared opportunity value entry', () => {
  it('converts major units with the chosen currency, not a hardcoded factor', () => {
    expect(amountsToCents({ mrr: 1000, nrr: 600, hardware: 400 }, 'USD')).toEqual({
      mrr_cents: 100000,
      nrr_cents: 60000,
      hardware_cents: 40000,
    });
    // Yen has no minor unit: 1000 JPY is 1000, not 100000.
    expect(amountsToCents({ mrr: 1000 }, 'JPY').mrr_cents).toBe(1000);
  });

  it('round-trips cents back to the amounts the user typed', () => {
    const amounts = { mrr: 1234.5, nrr: 0, hardware: 99 };
    expect(centsToAmounts(amountsToCents(amounts, 'GBP') as never, 'GBP')).toEqual(amounts);
  });

  it('is the only money entry surface — create and edit both render it', () => {
    const create = source('../src/components/dialogs/CreateOpportunityDialog.tsx');
    const edit = source('../src/components/dialogs/EditValuesDialog.tsx');

    for (const dialog of [create, edit]) {
      expect(dialog).toContain('<OpportunityValueFields');
      expect(dialog).not.toContain('<CurrencyInput');
      expect(dialog).not.toContain('toMinorUnits');
    }
    expect(edit).toContain('currency_code: currency');
  });

  it('shows the currency on every money field', () => {
    const fields = source('../src/components/dialogs/OpportunityValueFields.tsx');

    expect(fields).toContain('const withSymbol = (label: string) => `${label} (${symbol} ${currencyCode})`;');
    expect(fields).toContain('CURRENCY_OPTIONS.map');
  });
});

describe('no aggregate mixes currencies', () => {
  it('buckets every total by currency_code', () => {
    const board = source('../src/components/board/OpportunityBoard.tsx');
    const snapshot = source('../../../server/src/components/dashboard/OpportunitySnapshotCard.tsx');
    const reports = source('../src/components/reports/OpportunityReportsView.tsx');
    const forecast = source('../../../ee/server/src/lib/opportunities/forecast.ts');
    const rollups = source('../../../ee/server/src/lib/opportunities/rollups.ts');

    expect(board).toContain('new Map<string, { mrr: number; oneTime: number }>()');
    expect(snapshot).toContain('key={`${row.stage}:${row.currency_code}`}');
    expect(snapshot).toContain('row.currency_code');
    expect(reports).toContain('report.by_currency.map');
    expect(forecast).toContain('by_currency');
    expect(rollups).toContain('currency_code');
  });
});
