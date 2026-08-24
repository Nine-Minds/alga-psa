import { describe, expect, it } from 'vitest';
import { parseCsv, shapeOpeningBalanceRows } from './openingBalanceCsv';

/**
 * Opening-balance import is how a tenant's physical stock first enters the
 * system, so a row silently mis-shaped here becomes a permanent inventory
 * discrepancy rather than a visible error.
 */

const HEADER = 'sku,product,location,quantity,serial_number,mac_address,unit_cost';

/** Build a CSV with the canonical header and the given data lines. */
function csv(...lines: string[]): string {
  return [HEADER, ...lines].join('\n');
}

function shape(...lines: string[]) {
  return shapeOpeningBalanceRows(parseCsv(csv(...lines)));
}

describe('parseCsv', () => {
  it('splits the header from the data rows', () => {
    const result = parseCsv('a,b\n1,2\n3,4');
    expect(result.header).toEqual(['a', 'b']);
    expect(result.rows).toEqual([['1', '2'], ['3', '4']]);
  });

  it('returns an empty header for empty input', () => {
    expect(parseCsv('')).toEqual({ header: [], rows: [] });
  });

  it('reads the last row when the file has no trailing newline', () => {
    expect(parseCsv('a,b\n1,2').rows).toEqual([['1', '2']]);
  });

  it('handles both LF and CRLF line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n3,4').rows).toEqual([['1', '2'], ['3', '4']]);
  });

  it('keeps commas, quotes and newlines inside a quoted field', () => {
    const { rows } = parseCsv('a,b\n"x,y","say ""hi"""\n"line1\nline2",z');
    expect(rows[0]).toEqual(['x,y', 'say "hi"']);
    expect(rows[1][0]).toBe('line1\nline2');
  });

  it('preserves spacing inside a quoted field', () => {
    expect(parseCsv('a\n"  padded  "').rows[0][0]).toBe('  padded  ');
  });

  it('treats a quote after the field start as literal text', () => {
    expect(parseCsv('a\nab"cd').rows[0][0]).toBe('ab"cd');
  });

  it('preserves empty cells rather than collapsing them', () => {
    expect(parseCsv('a,b,c\n1,,3').rows[0]).toEqual(['1', '', '3']);
  });

  it('skips a completely blank line', () => {
    expect(parseCsv('a,b\n1,2\n\n3,4').rows).toEqual([['1', '2'], ['3', '4']]);
  });
});

describe('shapeOpeningBalanceRows — header handling', () => {
  it('rejects a file with no header row', () => {
    const result = shapeOpeningBalanceRows({ header: [], rows: [] });
    expect(result.errors).toEqual([{ row: 0, message: 'header row is required' }]);
  });

  it('names every missing required header', () => {
    const result = shapeOpeningBalanceRows({ header: ['sku', 'location'], rows: [] });
    const missing = result.errors.map(e => e.message);

    expect(missing).toEqual(expect.arrayContaining([
      'missing required header: product',
      'missing required header: quantity',
      'missing required header: unit_cost',
    ]));
    expect(result.rows).toEqual([]);
  });

  it('accepts headers in any case and any column order', () => {
    const reordered = 'UNIT_COST,Mac_Address,Serial_Number,Quantity,Location,Product,SKU';
    const result = shapeOpeningBalanceRows(
      parseCsv(`${reordered}\n1.50,,,2,Warehouse,Widget,W-1`),
    );

    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({ sku: 'W-1', product: 'Widget', location: 'Warehouse', quantity: 2 });
  });

  it('tolerates a UTF-8 BOM on the first header', () => {
    // Excel writes one on export; without stripping it the sku column goes missing.
    const result = shapeOpeningBalanceRows(parseCsv(`﻿${HEADER}\nW-1,,Warehouse,1,,,`));
    expect(result.errors).toEqual([]);
  });

  it('refuses a file above the 5000-row cap', () => {
    const rows = Array.from({ length: 5001 }, () => ['W-1', '', 'Warehouse', '1', '', '', '']);
    const result = shapeOpeningBalanceRows({ header: HEADER.split(','), rows });

    expect(result.rows).toEqual([]);
    expect(result.errors[0].message).toMatch(/5000/);
  });
});

describe('shapeOpeningBalanceRows — row validation', () => {
  it('accepts a bulk row identified by sku', () => {
    const { rows, errors } = shape('W-1,,Warehouse,5,,,');

    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({
      row: 1, sku: 'W-1', product: null, location: 'Warehouse', quantity: 5, serial_number: null,
    });
  });

  it('accepts a bulk row identified by product name alone', () => {
    const { errors } = shape(',Widget,Warehouse,5,,,');
    expect(errors).toEqual([]);
  });

  it('requires either a sku or a product', () => {
    const { errors } = shape(',,Warehouse,5,,,');
    expect(errors).toEqual([{ row: 1, message: 'sku or product is required' }]);
  });

  it('requires a location', () => {
    const { errors } = shape('W-1,,,5,,,');
    expect(errors.map(e => e.message)).toContain('location is required');
  });

  it('numbers errors by data row, not by file line', () => {
    const { errors } = shape('W-1,,Warehouse,5,,,', ',,Warehouse,5,,,');
    expect(errors[0].row).toBe(2);
  });

  describe('quantity', () => {
    it('requires a quantity on bulk rows', () => {
      const { errors } = shape('W-1,,Warehouse,,,,');
      expect(errors.map(e => e.message)).toContain('quantity is required for bulk rows');
    });

    it('rejects zero, negatives, decimals and non-numeric text', () => {
      for (const q of ['0', '-1', '1.5', 'many', '1e3']) {
        const { errors } = shape(`W-1,,Warehouse,${q},,,`);
        expect(errors.map(e => e.message), `quantity: ${q}`)
          .toContain('quantity must be a positive integer');
      }
    });

    it('accepts a plain positive integer', () => {
      const { rows, errors } = shape('W-1,,Warehouse,42,,,');
      expect(errors).toEqual([]);
      expect(rows[0].quantity).toBe(42);
    });

    it('tolerates padding around the number', () => {
      // Spreadsheet exports pad numeric columns; the value is still unambiguous.
      const { rows, errors } = shape('W-1,,Warehouse,  2  ,,,');
      expect(errors).toEqual([]);
      expect(rows[0].quantity).toBe(2);
    });
  });

  describe('serialized rows', () => {
    it('allows a serialized row with no quantity', () => {
      const { rows, errors } = shape('W-1,,Warehouse,,SN-1,,');
      expect(errors).toEqual([]);
      expect(rows[0]).toMatchObject({ serial_number: 'SN-1', quantity: null });
    });

    it('allows a serialized row with quantity 1', () => {
      const { errors } = shape('W-1,,Warehouse,1,SN-1,,');
      expect(errors).toEqual([]);
    });

    it('rejects a serialized row claiming more than one unit', () => {
      // A serial number identifies exactly one physical unit.
      const { errors } = shape('W-1,,Warehouse,2,SN-1,,');
      expect(errors.map(e => e.message)).toContain('serialized rows must have quantity empty or 1');
    });

    it('keeps the MAC address only on serialized rows', () => {
      const serialized = shape('W-1,,Warehouse,1,SN-1,AA:BB:CC:DD:EE:FF,');
      const bulk = shape('W-1,,Warehouse,5,,AA:BB:CC:DD:EE:FF,');

      expect(serialized.rows[0].mac_address).toBe('AA:BB:CC:DD:EE:FF');
      // A MAC belongs to one device; on a bulk row it cannot identify anything.
      expect(bulk.rows[0].mac_address).toBeNull();
    });
  });

  describe('unit cost', () => {
    it('converts a decimal amount to minor units', () => {
      const { rows, errors } = shape('W-1,,Warehouse,1,,,12.34');
      expect(errors).toEqual([]);
      expect(rows[0].unit_cost_cents).toBe(1234);
    });

    it('accepts a whole number and zero', () => {
      expect(shape('W-1,,Warehouse,1,,,15').rows[0].unit_cost_cents).toBe(1500);
      expect(shape('W-1,,Warehouse,1,,,0').rows[0].unit_cost_cents).toBe(0);
    });

    it('leaves the cost null when the column is blank', () => {
      const { rows, errors } = shape('W-1,,Warehouse,1,,,');
      expect(errors).toEqual([]);
      expect(rows[0].unit_cost_cents).toBeNull();
    });

    it('rejects negative and non-numeric costs', () => {
      // 1,234 is quoted so it stays one field — unquoted it would simply be two
      // CSV columns, which is a different (and harmless) thing.
      for (const cost of ['-1', '-0.01', 'free', '"1,234"', '$5']) {
        const { errors } = shape(`W-1,,Warehouse,1,,,${cost}`);
        expect(errors.map(e => e.message), `cost: ${cost}`)
          .toContain('unit_cost must be a non-negative amount');
      }
    });
  });

  it('reports every problem in a file rather than stopping at the first', () => {
    const { errors } = shape(
      ',,Warehouse,5,,,',
      'W-1,,,0,,,',
      'W-2,,Warehouse,1,,,-3',
    );

    expect(new Set(errors.map(e => e.row))).toEqual(new Set([1, 2, 3]));
  });

  it('still returns shaped rows alongside the errors so the preview can render', () => {
    const { rows, errors } = shape('W-1,,Warehouse,5,,,', 'W-2,,Warehouse,0,,,');

    expect(errors).not.toEqual([]);
    expect(rows).toHaveLength(2);
  });
});
