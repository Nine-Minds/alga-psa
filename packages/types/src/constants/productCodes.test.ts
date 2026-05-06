import { describe, expect, it } from 'vitest';
import {
  PRODUCT_CODES,
  isValidProductCode,
  resolveProductCode,
} from './productCodes';
import { resolveTier } from './tenantTiers';
import { tenantHasAddOn } from './addOns';

describe('productCodes', () => {
  it('exports supported product codes', () => {
    expect(PRODUCT_CODES).toEqual(['psa', 'algadesk']);
  });

  it('validates product codes', () => {
    expect(isValidProductCode('psa')).toBe(true);
    expect(isValidProductCode('algadesk')).toBe(true);
    expect(isValidProductCode('invalid')).toBe(false);
    expect(isValidProductCode(null)).toBe(false);
  });

  it('resolves null/undefined to psa for backward compatibility', () => {
    expect(resolveProductCode(null)).toEqual({ productCode: 'psa', isMisconfigured: false });
    expect(resolveProductCode(undefined)).toEqual({ productCode: 'psa', isMisconfigured: false });
  });

  it('returns valid configured values', () => {
    expect(resolveProductCode('psa')).toEqual({ productCode: 'psa', isMisconfigured: false });
    expect(resolveProductCode('algadesk')).toEqual({ productCode: 'algadesk', isMisconfigured: false });
  });

  it('fails closed for unknown non-null values', () => {
    expect(resolveProductCode('desk')).toEqual({ productCode: 'psa', isMisconfigured: true });
  });

  it('does not alter existing tier or add-on resolution behavior', () => {
    expect(resolveTier('premium')).toEqual({ tier: 'premium', isMisconfigured: false });
    expect(resolveTier('invalid')).toEqual({ tier: 'pro', isMisconfigured: true });
    expect(tenantHasAddOn(['ai_assistant'], 'ai_assistant')).toBe(true);
    expect(tenantHasAddOn([], 'ai_assistant')).toBe(false);
  });
});
