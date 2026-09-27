import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  UNIT_LABEL_VARIANTS,
  defaultUnitCodeForKind,
  knownUnitCodeForLabel,
  resolveUnitOfMeasure,
  withUnitCode,
} from '../../billingClients/unitOfMeasure';

const require = createRequire(import.meta.url);
const backfill = require(path.resolve(__dirname, '../../../server/migrations/20260927110000_add_unit_codes_and_backfill.cjs'));

describe('unit of measure resolution', () => {
  it('prefers catalog over config and defaults to C62', () => {
    expect(resolveUnitOfMeasure({ catalog: { code: 'HUR', label: 'Hour' }, config: { code: 'DAY', label: 'Day' } }).code).toBe('HUR');
    expect(resolveUnitOfMeasure({ config: { code: 'DAY', label: 'Day' } }).code).toBe('DAY');
    expect(resolveUnitOfMeasure({}).code).toBe('C62');
    expect(resolveUnitOfMeasure({ fallback: 'HUR' }).shortLabel).toBe('hrs');
  });

  it('derives the code from a legacy label-only source and keeps custom labels', () => {
    expect(resolveUnitOfMeasure({ catalog: { label: 'GB' } })).toMatchObject({ code: 'E34', shortLabel: 'GB' });
    expect(resolveUnitOfMeasure({ catalog: { code: null, label: 'hours' } })).toMatchObject({ code: 'HUR', label: 'Hour' });
    // Custom tenant label (D5): coded C62 but never rendered as "units".
    expect(resolveUnitOfMeasure({ config: { code: 'C62', label: 'API call' } })).toMatchObject({
      code: 'C62', label: 'API call', shortLabel: 'API call',
    });
    // Business labels sharing C62 keep their own wording.
    expect(resolveUnitOfMeasure({ catalog: { code: 'C62', label: 'Seat' } })).toMatchObject({ label: 'Seat', pluralLabel: 'seats' });
  });

  it('provides product, fixed, hourly, and usage defaults', () => {
    expect(defaultUnitCodeForKind('product')).toBe('C62');
    expect(defaultUnitCodeForKind('fixed')).toBe('C62');
    expect(defaultUnitCodeForKind('hourly')).toBe('HUR');
    expect(defaultUnitCodeForKind('usage')).toBeNull();
  });

  it('fills unit_code from the label on write without overriding an explicit code', () => {
    expect(withUnitCode({ unit_of_measure: ' EA ' })).toEqual({ unit_of_measure: ' EA ', unit_code: 'C62' });
    expect(withUnitCode({ unit_of_measure: 'Widgets', unit_code: null }).unit_code).toBe('C62');
    expect(withUnitCode({ unit_of_measure: 'GB', unit_code: '4L' }).unit_code).toBe('4L');
    expect(withUnitCode({ base_rate: 1 } as { base_rate: number; unit_of_measure?: string })).toEqual({ base_rate: 1 });
  });

  it('backfill migration normalizes exactly the variants the app recognizes', () => {
    const appMap = Object.fromEntries(Object.keys(UNIT_LABEL_VARIANTS).map((label) => [label, knownUnitCodeForLabel(label)]));
    expect(backfill.KNOWN_UNIT_LABELS).toEqual(appMap);
  });
});
