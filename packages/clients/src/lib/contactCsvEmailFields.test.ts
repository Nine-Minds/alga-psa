import { describe, expect, it } from 'vitest';
import {
  formatContactCsvAdditionalEmailAddresses,
  formatContactCsvPrimaryEmailType,
  isValidContactCsvEmailValue,
  normalizeContactCsvEmailValue,
  parseContactCsvAdditionalEmailAddresses,
  parseContactCsvEmailType,
} from './contactCsvEmailFields';

describe('normalizeContactCsvEmailValue', () => {
  it('trims and lowercases so the same address matches however it was typed', () => {
    expect(normalizeContactCsvEmailValue('  Alice@Acme.TEST ')).toBe('alice@acme.test');
  });

  it('collapses absent and blank values to null', () => {
    for (const input of [null, undefined, '', '   ', '\t']) {
      expect(normalizeContactCsvEmailValue(input), `input: ${JSON.stringify(input)}`).toBeNull();
    }
  });
});

describe('isValidContactCsvEmailValue', () => {
  it('accepts ordinary addresses regardless of casing or padding', () => {
    for (const input of ['alice@acme.test', ' Bob@Globex.co.uk ', 'a.b+tag@sub.domain.io']) {
      expect(isValidContactCsvEmailValue(input), `input: ${input}`).toBe(true);
    }
  });

  it('rejects values that are not addresses', () => {
    for (const input of [null, undefined, '', '   ', 'alice', 'alice@', '@acme.test', 'alice@acme', 'a b@acme.test']) {
      expect(isValidContactCsvEmailValue(input), `input: ${JSON.stringify(input)}`).toBe(false);
    }
  });
});

describe('parseContactCsvEmailType', () => {
  it('recognises the canonical types case-insensitively', () => {
    for (const type of ['work', 'personal', 'billing', 'other']) {
      expect(parseContactCsvEmailType(type.toUpperCase())).toEqual({
        canonicalType: type,
        customType: null,
      });
    }
  });

  it('keeps an unrecognised label as a custom type in its original casing', () => {
    expect(parseContactCsvEmailType('  Site Contact ')).toEqual({
      canonicalType: null,
      customType: 'Site Contact',
    });
  });

  it('returns nothing for a blank label', () => {
    expect(parseContactCsvEmailType('   ')).toEqual({});
    expect(parseContactCsvEmailType(null)).toEqual({});
  });
});

describe('formatContactCsvPrimaryEmailType', () => {
  it('prefers a custom label, then the canonical type, then work', () => {
    expect(formatContactCsvPrimaryEmailType({
      primary_email_type: 'Site Contact',
      primary_email_canonical_type: 'other',
    } as any)).toBe('Site Contact');

    expect(formatContactCsvPrimaryEmailType({
      primary_email_type: '   ',
      primary_email_canonical_type: 'billing',
    } as any)).toBe('billing');

    expect(formatContactCsvPrimaryEmailType({
      primary_email_type: null,
      primary_email_canonical_type: null,
    } as any)).toBe('work');
  });
});

describe('parseContactCsvAdditionalEmailAddresses', () => {
  it('returns nothing for a blank cell', () => {
    for (const input of [null, undefined, '', '   ']) {
      expect(parseContactCsvAdditionalEmailAddresses(input)).toEqual({ rows: [], errors: [] });
    }
  });

  it('parses a pipe-separated list into ordered rows', () => {
    const { rows, errors } = parseContactCsvAdditionalEmailAddresses(
      'work: Alice@Acme.test | billing: ap@acme.test',
    );

    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { email_address: 'alice@acme.test', canonical_type: 'work', custom_type: null, display_order: 0 },
      { email_address: 'ap@acme.test', canonical_type: 'billing', custom_type: null, display_order: 1 },
    ]);
  });

  it('keeps a non-canonical label as a custom type', () => {
    const { rows } = parseContactCsvAdditionalEmailAddresses('Site Contact: site@acme.test');

    expect(rows[0]).toMatchObject({ canonical_type: null, custom_type: 'Site Contact' });
  });

  it('reports entries that are missing the label separator', () => {
    const { rows, errors } = parseContactCsvAdditionalEmailAddresses('alice@acme.test');

    expect(rows).toEqual([]);
    expect(errors[0]).toMatch(/format/i);
  });

  it('reports an entry whose label is empty', () => {
    const { rows, errors } = parseContactCsvAdditionalEmailAddresses(': alice@acme.test');

    expect(rows).toEqual([]);
    expect(errors[0]).toMatch(/label/i);
  });

  it('reports an invalid address rather than importing it', () => {
    const { rows, errors } = parseContactCsvAdditionalEmailAddresses('work: not-an-email');

    expect(rows).toEqual([]);
    expect(errors[0]).toMatch(/valid email/i);
  });

  it('rejects an additional address that duplicates the primary', () => {
    const { rows, errors } = parseContactCsvAdditionalEmailAddresses(
      'work: Alice@Acme.test',
      'alice@acme.test',
    );

    expect(rows).toEqual([]);
    expect(errors[0]).toMatch(/primary/i);
  });

  it('rejects a duplicate within the list, keeping the first occurrence', () => {
    const { rows, errors } = parseContactCsvAdditionalEmailAddresses(
      'work: dup@acme.test | billing: DUP@acme.test',
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].canonical_type).toBe('work');
    expect(errors[0]).toMatch(/duplicate/i);
  });

  it('numbers errors by the operator-visible entry position', () => {
    const { errors } = parseContactCsvAdditionalEmailAddresses(
      'work: ok@acme.test | broken-entry',
    );

    expect(errors[0]).toMatch(/^Additional email 2:/);
  });

  it('keeps display_order contiguous when an entry is rejected', () => {
    // display_order drives the order the addresses render in; a skipped bad row
    // must not leave a gap that reorders the survivors.
    const { rows } = parseContactCsvAdditionalEmailAddresses(
      'work: first@acme.test | bad-entry | billing: third@acme.test',
    );

    expect(rows.map(r => r.display_order)).toEqual([0, 1]);
  });

  it('tolerates surrounding whitespace and empty segments', () => {
    const { rows, errors } = parseContactCsvAdditionalEmailAddresses(
      '  work: a@acme.test  ||  billing: b@acme.test  ',
    );

    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
  });
});

describe('additional email round-trip', () => {
  it('survives export then re-import for canonical and custom labels', () => {
    const original = [
      { email_address: 'a@acme.test', canonical_type: 'work' as const, custom_type: null },
      { email_address: 'b@acme.test', canonical_type: null, custom_type: 'Site Contact' },
    ];

    const exported = formatContactCsvAdditionalEmailAddresses(original);
    const { rows, errors } = parseContactCsvAdditionalEmailAddresses(exported);

    expect(errors).toEqual([]);
    expect(rows.map(r => r.email_address)).toEqual(['a@acme.test', 'b@acme.test']);
    expect(rows[0].canonical_type).toBe('work');
    expect(rows[1].custom_type).toBe('Site Contact');
  });

  it('exports an empty cell when there are no additional addresses', () => {
    expect(formatContactCsvAdditionalEmailAddresses([])).toBe('');
    expect(formatContactCsvAdditionalEmailAddresses(undefined)).toBe('');
  });

  it('falls back to "other" when a row carries no label', () => {
    expect(formatContactCsvAdditionalEmailAddresses([
      { email_address: 'x@acme.test', canonical_type: null, custom_type: null },
    ])).toBe('other: x@acme.test');
  });

  it('keeps addresses importable when a custom label contains the field separators', () => {
    // "Billing | AP" and "Escalation: L2" are plausible operator labels, and the
    // cell format gives both characters structural meaning. The label degrades to
    // keep the cell parseable; losing the address instead would be far worse.
    const original = [
      { email_address: 'a@acme.test', canonical_type: null, custom_type: 'Billing | AP' },
      { email_address: 'b@acme.test', canonical_type: null, custom_type: 'Escalation: L2' },
    ];

    const exported = formatContactCsvAdditionalEmailAddresses(original);
    const { rows, errors } = parseContactCsvAdditionalEmailAddresses(exported);

    expect(errors).toEqual([]);
    expect(rows.map(r => r.email_address)).toEqual(['a@acme.test', 'b@acme.test']);
    expect(rows[0].custom_type).toBe('Billing AP');
    expect(rows[1].custom_type).toBe('Escalation L2');
  });

  it('falls back to "other" when sanitising leaves nothing of the label', () => {
    const exported = formatContactCsvAdditionalEmailAddresses([
      { email_address: 'x@acme.test', canonical_type: null, custom_type: ':|:' },
    ]);

    expect(exported).toBe('other: x@acme.test');
    expect(parseContactCsvAdditionalEmailAddresses(exported).errors).toEqual([]);
  });
});
