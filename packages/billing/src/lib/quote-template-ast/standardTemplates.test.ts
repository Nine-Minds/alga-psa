import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  autoSelectStandardQuoteTemplateCode,
  getStandardQuoteTemplateAstByCode,
  STANDARD_QUOTE_BY_LOCATION_CODE,
  STANDARD_QUOTE_DEFAULT_CODE,
  STANDARD_QUOTE_TEMPLATE_ASTS,
} from './standardTemplates';

const collectNodesById = (node: unknown, id: string, out: any[] = []): any[] => {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const item of node) collectNodesById(item, id, out);
    return out;
  }
  if ((node as any).id === id) out.push(node);
  for (const key of Object.keys(node)) collectNodesById((node as any)[key], id, out);
  return out;
};

describe('standard quote template AST definitions', () => {
  // Regression: alga0002161 — the issuer-logo image must letterbox (object-fit:
  // contain) instead of stretching non-wide logos to the 180x72 box.
  it('sets object-fit on every issuer-logo node so logos are not squashed', () => {
    const logos = Object.values(STANDARD_QUOTE_TEMPLATE_ASTS).flatMap((ast) =>
      collectNodesById(ast, 'issuer-logo'),
    );
    expect(logos.length).toBeGreaterThan(0);
    for (const logo of logos) {
      expect(logo.style?.inline?.objectFit).toBe('contain');
      expect(logo.style?.inline?.objectPosition).toBe('left');
    }
  });

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

  it('renders grouped cadences as a repeating cadence-bands stack with an optional sub-stack', () => {
    const ast = getStandardQuoteTemplateAstByCode('standard-quote-grouped');
    expect(ast).toBeTruthy();
    const serialized = JSON.stringify(ast?.layout);

    // Required bands: repeating stack over groupsByCadence, per-band table on
    // the scope-named `group.items`, renderer-computed subtotal/tax/total.
    expect(serialized).toContain('"id":"cadence-bands"');
    expect(serialized).toContain('"bindingId":"groupsByCadence"');
    expect(serialized).toContain('"id":"cadence-band-items"');
    expect(serialized).toContain('"bindingId":"group.items"');
    expect(serialized).toContain('"id":"cadence-band-subtotal"');
    expect(serialized).toContain('"id":"cadence-band-total"');

    // Optional (if selected) bands: separate repeat so an empty section is
    // never emitted, bound to the optional-only groups.
    expect(serialized).toContain('"id":"cadence-optional-bands"');
    expect(serialized).toContain('"bindingId":"groupsByCadenceWithOptionals"');
    expect(serialized).toContain('"bindingId":"group.optional_items"');
    expect(serialized).toContain('"id":"cadence-optional-subtotal"');

    // The old hard-coded monthly table and total are gone from the grouped AST.
    expect(serialized).not.toContain('Monthly Items');
    expect(serialized).not.toContain('Monthly Total');
  });

  it('ships a catalog migration whose grouped AST literal matches the code AST', async () => {
    const migration = await import(
      /* @vite-ignore */ path.resolve(
        __dirname,
        '../../../../../server/migrations/20260920120000_update_grouped_quote_template_cadence_bands.cjs'
      )
    );
    const literal =
      (migration as any).__GROUPED_QUOTE_AST ?? (migration as any).default?.__GROUPED_QUOTE_AST;
    expect(literal).toBeTruthy();
    // Guards R4: editing buildStandardQuoteGroupedAst without regenerating the
    // migration literal would leave existing environments on the old layout.
    expect(literal).toEqual(getStandardQuoteTemplateAstByCode('standard-quote-grouped'));
  });
});
