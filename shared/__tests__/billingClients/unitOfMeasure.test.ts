import { describe, expect, it } from 'vitest';
import { defaultUnitCodeForKind, resolveUnitOfMeasure } from '../../billingClients/unitOfMeasure';

describe('unit of measure resolution', () => {
  it('prefers catalog over config and defaults to C62', () => {
    expect(resolveUnitOfMeasure({ catalogUnitCode: 'HUR', configUnitCode: 'DAY' }).code).toBe('HUR');
    expect(resolveUnitOfMeasure({ configUnitCode: 'DAY' }).code).toBe('DAY');
    expect(resolveUnitOfMeasure({}).code).toBe('C62');
  });

  it('provides product, fixed, hourly, and usage defaults', () => {
    expect(defaultUnitCodeForKind('product')).toBe('C62');
    expect(defaultUnitCodeForKind('fixed')).toBe('C62');
    expect(defaultUnitCodeForKind('hourly')).toBe('HUR');
    expect(defaultUnitCodeForKind('usage')).toBeNull();
  });
});
