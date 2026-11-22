import { describe, expect, it } from 'vitest';
import { isClientQuickViewFieldHidden, isClientLocationFieldHidden, isClientLocationResourceHidden } from '../clientFieldRedaction';

describe('client field projections', () => {
  it('hides joined location values and component fields for every address alias', () => {
    for (const field of ['location_address', 'address_line1', 'clients.city', 'fields.postal_code', 'fields.client_locations.city']) {
      expect(isClientQuickViewFieldHidden([field], 'location_address')).toBe(true);
      expect(isClientLocationFieldHidden([field], 'address_line1')).toBe(true);
      expect(isClientLocationFieldHidden([field], 'city')).toBe(true);
      expect(isClientLocationFieldHidden([field], 'location_name')).toBe(false);
    }
  });
  it('hides all fields for resource redactions and prevents an identifying location list', () => {
    for (const field of ['client', 'clients', 'fields.clients', '*', 'fields']) {
      expect(isClientQuickViewFieldHidden([field], 'tax_id_number')).toBe(true);
      expect(isClientLocationResourceHidden([field])).toBe(true);
    }
    expect(isClientLocationResourceHidden(['fields.client_locations.location_id'])).toBe(true);
    expect(isClientLocationResourceHidden(['fields.client_locations.city'])).toBe(false);
  });
  it('hides identifying images and nested objects when their source is protected', () => {
    expect(isClientQuickViewFieldHidden(['client_name'], 'logoUrl')).toBe(true);
    expect(isClientQuickViewFieldHidden(['properties.website'], 'url')).toBe(true);
    expect(isClientQuickViewFieldHidden(['properties.notes'], 'properties')).toBe(true);
    expect(isClientQuickViewFieldHidden(['tax_id_number'], 'client_name')).toBe(false);
  });
});
