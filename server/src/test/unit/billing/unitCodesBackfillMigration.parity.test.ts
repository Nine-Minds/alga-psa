import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { UNIT_LABEL_VARIANTS, knownUnitCodeForLabel } from '@alga-psa/core/unitOfMeasure';

const require = createRequire(import.meta.url);
const backfill = require('../../../../migrations/20260927110000_add_unit_codes_and_backfill.cjs');

describe('unit codes backfill migration', () => {
  it('normalizes exactly the label variants the app recognizes', () => {
    const appMap = Object.fromEntries(Object.keys(UNIT_LABEL_VARIANTS).map((label) => [label, knownUnitCodeForLabel(label)]));
    expect(backfill.KNOWN_UNIT_LABELS).toEqual(appMap);
  });
});
