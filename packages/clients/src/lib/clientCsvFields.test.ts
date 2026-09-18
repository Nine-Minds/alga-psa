import { describe, expect, it } from 'vitest';
import { parseClientCsvBoolean } from './clientCsvFields';

/**
 * Drives is_inactive, is_tax_exempt and auto_invoice on the client CSV import.
 * A misread here is silent: the row imports successfully with the wrong flag.
 */
describe('parseClientCsvBoolean', () => {
  it('accepts the spellings spreadsheets actually produce', () => {
    for (const value of ['true', 'TRUE', 'True', 'yes', 'YES', 'Yes', 'y', 'Y', '1', 't', 'T']) {
      expect(parseClientCsvBoolean(value), `value: ${value}`).toBe(true);
    }
  });

  it('ignores padding around the value', () => {
    for (const value of ['  true  ', '\tYes', 'y\n']) {
      expect(parseClientCsvBoolean(value), `value: ${JSON.stringify(value)}`).toBe(true);
    }
  });

  it('reads a real boolean directly', () => {
    expect(parseClientCsvBoolean(true)).toBe(true);
    expect(parseClientCsvBoolean(false)).toBe(false);
  });

  it('treats numeric 1 as true and 0 as false', () => {
    expect(parseClientCsvBoolean(1)).toBe(true);
    expect(parseClientCsvBoolean(0)).toBe(false);
  });

  it('treats the negative spellings as false', () => {
    for (const value of ['false', 'FALSE', 'no', 'N', '0', 'f']) {
      expect(parseClientCsvBoolean(value), `value: ${value}`).toBe(false);
    }
  });

  it('treats a blank or absent cell as false', () => {
    for (const value of ['', '   ', null, undefined]) {
      expect(parseClientCsvBoolean(value), `value: ${JSON.stringify(value)}`).toBe(false);
    }
  });

  it('treats unrecognised text as false rather than guessing', () => {
    for (const value of ['maybe', 'exempt', 'x', '2']) {
      expect(parseClientCsvBoolean(value), `value: ${value}`).toBe(false);
    }
  });
});
