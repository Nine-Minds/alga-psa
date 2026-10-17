import { describe, expect, it } from 'vitest';
import { serializeAccountingCsv } from '../../src/services/accountingCsv';
import { parseCSV } from '@alga-psa/core';

describe('accounting CSV signed amounts', () => {
  it('preserves negative decimals while escaping formula-like customer text', () => {
    const csv = serializeAccountingCsv([{ name: '=HYPERLINK("bad")', amount: '-405.00', qty: '1' }], ['name', 'amount', 'qty'], ['amount', 'qty']);
    const rows = parseCSV(csv, { header: true }) as Record<string, string>[];
    expect(rows[0].amount).toBe('-405.00');
    expect(Number(rows[0].amount) * Number(rows[0].qty)).toBe(-405);
    expect(rows[0].name).toBe('\'=HYPERLINK("bad")');
  });
  it('rejects formulas and non-finite values even in a declared numeric field', () => {
    for (const value of ['=1+2', 'Infinity', 'NaN', '-1+cmd']) expect(() => serializeAccountingCsv([{ amount: value }], ['amount'], ['amount'])).toThrow('Invalid accounting decimal');
  });
});
