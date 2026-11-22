import { describe, expect, it } from 'vitest';
import {
  isClientLocationFieldHidden,
  isClientLocationResourceHidden,
  isClientQuickViewFieldHidden,
} from './clientFieldRedaction';
import { isFieldHiddenByRedaction } from './redaction';

describe('client quick-view field redaction', () => {
  it('matches wildcard, fields-prefixed, parent, nested, and child source paths', () => {
    for (const redaction of ['*', 'fields', 'fields.location_address', 'address']) {
      expect(isClientQuickViewFieldHidden([redaction], 'location_address')).toBe(true);
    }
    expect(isClientQuickViewFieldHidden(['properties.website'], 'location_address')).toBe(false);
    expect(isClientQuickViewFieldHidden(['properties'], 'properties.industry')).toBe(true);
    expect(isClientQuickViewFieldHidden(['clients.properties.website'], 'url')).toBe(true);
    expect(isClientQuickViewFieldHidden(['tax_id_number'], 'client_name')).toBe(false);
  });

  it('applies location aliases to the corresponding location fields and resource identifiers', () => {
    expect(isClientLocationFieldHidden(['location_address'], 'address_line1')).toBe(true);
    expect(isClientLocationFieldHidden(['fields.client_locations.city'], 'city')).toBe(true);
    expect(isClientLocationFieldHidden(['location_phone'], 'fax_extension')).toBe(true);
    expect(isClientLocationFieldHidden(['location_email'], 'email')).toBe(true);
    expect(isClientLocationResourceHidden(['client_locations'])).toBe(true);
    expect(isClientLocationResourceHidden(['fields.client_locations.location_id'])).toBe(true);
    expect(isClientLocationResourceHidden(['fields.client_locations.city'])).toBe(false);
    expect(isClientLocationResourceHidden([])).toBe(false);
  });

  it('uses the same nested-path matcher for derived and source aliases', () => {
    expect(isFieldHiddenByRedaction(['fields.properties.website'], ['url', 'properties.website'])).toBe(true);
    expect(isFieldHiddenByRedaction(['properties'], ['properties.website'])).toBe(true);
    expect(isFieldHiddenByRedaction(['properties.website.extra'], ['properties.website'])).toBe(true);
  });
});
