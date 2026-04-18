import { describe, expect, it } from 'vitest';
import {
  autoSelectStandardQuoteTemplateCode,
  getStandardQuoteTemplateAstByCode,
  STANDARD_QUOTE_BY_LOCATION_CODE,
  STANDARD_QUOTE_DEFAULT_CODE,
  STANDARD_QUOTE_TEMPLATE_ASTS,
} from './standardTemplates';

describe('standard quote template AST definitions', () => {
  it('exposes AST definitions for each standard quote template code', () => {
    expect(Object.keys(STANDARD_QUOTE_TEMPLATE_ASTS)).toEqual(
      expect.arrayContaining([
        'standard-quote-default',
        'standard-quote-detailed',
        'standard-quote-grouped',
        'standard-quote-by-location',
      ])
    );
  });

  it('auto-selects the by-location template when the view model has multiple locations', () => {
    expect(autoSelectStandardQuoteTemplateCode({ has_multiple_locations: true })).toBe(
      STANDARD_QUOTE_BY_LOCATION_CODE,
    );
    expect(autoSelectStandardQuoteTemplateCode({ has_multiple_locations: false })).toBe(
      STANDARD_QUOTE_DEFAULT_CODE,
    );
    expect(autoSelectStandardQuoteTemplateCode(null)).toBe(STANDARD_QUOTE_DEFAULT_CODE);
  });

  it('uses a repeating stack "location-bands" with a nested dynamic-table bound to group.items', () => {
    const ast = getStandardQuoteTemplateAstByCode(STANDARD_QUOTE_BY_LOCATION_CODE);
    expect(ast).toBeTruthy();
    const serializedLayout = JSON.stringify(ast?.layout);
    expect(serializedLayout).toContain('"id":"location-bands"');
    expect(serializedLayout).toContain('"id":"location-band-header"');
    expect(serializedLayout).toContain('"id":"location-band-items"');
    expect(serializedLayout).toContain('"id":"location-band-subtotal"');
    // Inner dynamic-table sources from the scope-named `group.items` binding.
    expect(serializedLayout).toContain('"bindingId":"group.items"');
    // The old flat line-items-by-location + location-summary are gone.
    expect(serializedLayout).not.toContain('"id":"line-items-by-location"');
    expect(serializedLayout).not.toContain('"id":"location-summary"');
  });

  it('returns cloned AST payloads to avoid mutation leaks', () => {
    const first = getStandardQuoteTemplateAstByCode(STANDARD_QUOTE_DEFAULT_CODE);
    const second = getStandardQuoteTemplateAstByCode(STANDARD_QUOTE_DEFAULT_CODE);
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
  });
});
