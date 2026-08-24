import { describe, expect, it } from 'vitest';
import { parseCSV, unparseCSV, validateCSVHeaders } from './csvParser';

/**
 * Every CSV importer and exporter in the product sits on these three functions:
 * clients, contacts, tickets, project phases/tasks, and the QuickBooks/Xero
 * accounting adapters. A defect here is a defect in all of them at once.
 */

describe('parseCSV', () => {
  it('splits a plain grid into rows of cells', () => {
    expect(parseCSV('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('reads the final row when the file has no trailing newline', () => {
    expect(parseCSV('a,b\n1,2')).toHaveLength(2);
  });

  it('tolerates Windows line endings', () => {
    expect(parseCSV('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps a comma inside a quoted field', () => {
    expect(parseCSV('name,city\n"Acme, Inc.",Berlin')).toEqual([
      ['name', 'city'],
      ['Acme, Inc.', 'Berlin'],
    ]);
  });

  it('keeps a newline inside a quoted field', () => {
    const [, row] = parseCSV('note\n"line one\nline two"') as string[][];
    expect(row[0]).toBe('line one\nline two');
  });

  it('unescapes a doubled quote inside a quoted field', () => {
    const [, row] = parseCSV('note\n"He said ""hello"""') as string[][];
    expect(row[0]).toBe('He said "hello"');
  });

  it('preserves an empty trailing cell', () => {
    expect(parseCSV('a,b,c\n1,2,')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', ''],
    ]);
  });

  it('skips rows that carry no content at all', () => {
    expect(parseCSV('a,b\n\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('returns nothing for empty input', () => {
    expect(parseCSV('')).toEqual([]);
    expect(parseCSV('\n\n')).toEqual([]);
  });

  describe('header mode', () => {
    it('maps each row onto the header names', () => {
      expect(parseCSV('name,email\nAlice,alice@acme.test', { header: true })).toEqual([
        { name: 'Alice', email: 'alice@acme.test' },
      ]);
    });

    it('fills missing trailing columns with an empty string', () => {
      expect(parseCSV('name,email,phone\nAlice,alice@acme.test', { header: true })).toEqual([
        { name: 'Alice', email: 'alice@acme.test', phone: '' },
      ]);
    });

    it('returns no rows when the file is only a header', () => {
      expect(parseCSV('name,email', { header: true })).toEqual([]);
    });
  });

  it('preserves spacing inside a quoted field', () => {
    // Quoting is how a CSV author says "this is the literal value". A leading or
    // trailing space inside quotes is part of the data — trimming it silently
    // rewrites what the operator uploaded.
    const [, row] = parseCSV('code\n"  A1  "') as string[][];
    expect(row[0]).toBe('  A1  ');
  });

  it('does not drop a row whose only content is a quoted space', () => {
    const rows = parseCSV('code\n" "') as string[][];
    expect(rows).toHaveLength(2);
  });
});

describe('unparseCSV', () => {
  it('writes a header row followed by the data rows', () => {
    const csv = unparseCSV([{ name: 'Alice', city: 'Berlin' }], ['name', 'city']);
    expect(csv).toBe('name,city\nAlice,Berlin');
  });

  it('quotes fields containing a comma, quote or newline', () => {
    const csv = unparseCSV(
      [{ a: 'x,y', b: 'say "hi"', c: 'line1\nline2' }],
      ['a', 'b', 'c'],
    );
    expect(csv.split('\n')[1]).toBe('"x,y","say ""hi""","line1');
  });

  it('emits an empty cell for an absent field', () => {
    expect(unparseCSV([{ a: 'x' }], ['a', 'b'])).toBe('a,b\nx,');
  });

  it('writes a numeric zero rather than blanking it', () => {
    // Quantities, balances and counts are legitimately zero. Exporting zero as an
    // empty cell loses the difference between "none" and "not recorded", and the
    // importer reading it back cannot tell either.
    expect(unparseCSV([{ qty: 0 }], ['qty'])).toBe('qty\n0');
  });

  it('writes a boolean false rather than blanking it', () => {
    expect(unparseCSV([{ active: false }], ['active'])).toBe('active\nfalse');
  });

  it('neutralises values a spreadsheet would treat as a formula', () => {
    // A ticket title or client name beginning with =, +, - or @ is executed by
    // Excel and Google Sheets when the exported file is opened. The ticket and
    // project exporters already guard this; the shared writer feeds the client
    // and contact exports, which carry the same operator-supplied text.
    const csv = unparseCSV(
      [{ name: '=CMD|\'/C calc\'!A0' }, { name: '+1', }, { name: '-2' }, { name: '@x' }],
      ['name'],
    );
    const cells = csv.split('\n').slice(1);
    for (const cell of cells) {
      expect(cell.replace(/^"/, '').startsWith("'"), `cell: ${cell}`).toBe(true);
    }
  });

  it('leaves ordinary values untouched', () => {
    const csv = unparseCSV([{ name: 'Acme Corp' }, { name: 'a-b' }], ['name']);
    expect(csv).toBe('name\nAcme Corp\na-b');
  });
});

describe('validateCSVHeaders', () => {
  it('accepts headers that match regardless of casing', () => {
    expect(validateCSVHeaders(['Name', 'EMAIL'], ['name', 'email'])).toEqual([]);
  });

  it('names every missing required field in one message', () => {
    const errors = validateCSVHeaders(['name'], ['name', 'email', 'phone']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('email');
    expect(errors[0]).toContain('phone');
  });

  it('ignores extra headers the caller did not require', () => {
    expect(validateCSVHeaders(['name', 'extra'], ['name'])).toEqual([]);
  });
});

describe('round trip', () => {
  it('reads back what it wrote for values needing escapes', () => {
    const original = [
      { name: 'Acme, Inc.', note: 'He said "hi"', city: 'Berlin' },
    ];
    const fields = ['name', 'note', 'city'];

    const rows = parseCSV(unparseCSV(original, fields), { header: true }) as Record<string, string>[];

    expect(rows).toEqual(original);
  });
});
