import { describe, expect, it } from 'vitest';


import { fingerprintPublicQuoteView } from './publicQuoteView';

const mk = (over: Record<string, unknown> = {}, loc = '1 Main St') => ({
  quote: { quote_id: 'q', title: 'T', valid_until: new Date('2030-01-01T00:00:00Z'), quote_date: new Date('2026-01-01T00:00:00Z'), status: 'sent', ...over },
  items: [{ quote_item_id: 'a', description: 'A', display_order: 0 }, { quote_item_id: 'b', description: 'B', display_order: 1 }],
  locations: [{ location_id: 'l1', address_line1: loc }, { location_id: 'l2', address_line1: 'x' }],
}) as any;

describe('fingerprintPublicQuoteView', () => {
  it('differs when only a Date field differs', () => {
    expect(fingerprintPublicQuoteView(mk())).not.toBe(
      fingerprintPublicQuoteView(mk({ valid_until: new Date('2030-01-02T00:00:00Z') })),
    );
    expect(fingerprintPublicQuoteView(mk())).not.toBe(
      fingerprintPublicQuoteView(mk({ quote_date: new Date('2026-01-03T00:00:00Z') })),
    );
  });

  it('is equal for equal Dates in different instances and different key order', () => {
    const a = mk();
    const b = {
      locations: [...a.locations].reverse().map((l: any) => ({ address_line1: l.address_line1, location_id: l.location_id })),
      items: [...a.items].reverse().map((i: any) => ({ display_order: i.display_order, description: i.description, quote_item_id: i.quote_item_id })),
      quote: Object.fromEntries(Object.entries({ ...a.quote, valid_until: new Date('2030-01-01T00:00:00Z') }).reverse()),
    };
    expect(fingerprintPublicQuoteView(b as any)).toBe(fingerprintPublicQuoteView(a));
  });

  it('differs when only a location address differs', () => {
    expect(fingerprintPublicQuoteView(mk())).not.toBe(fingerprintPublicQuoteView(mk({}, '2 Other St')));
  });

  it('refuses non-plain objects instead of hashing them as {}', () => {
    expect(() => fingerprintPublicQuoteView(mk({ weird: new Map([[1, 2]]) }))).toThrow(/non-plain/);
  });
});
