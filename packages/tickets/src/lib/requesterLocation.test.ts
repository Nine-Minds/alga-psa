import { describe, expect, it } from 'vitest';
import { contactLocationSuggestion, requesterLocationLine } from './requesterLocation';

/**
 * The requester-location line and the "Use contact's location" offer, as both ticket layouts read
 * them. Pinned here because the contact tile only tells the truth when the loader attaches
 * `locations` — a tile fed a bare contact row silently showed nothing at all.
 */

const location = (id: string, name: string | null, isPrimary = false) => ({
  location_id: id,
  location_name: name,
  is_primary: isPrimary,
  is_active: true,
  address_line1: null,
  address_line2: null,
  address_line3: null,
  city: null,
  state_province: null,
  postal_code: null,
  country_code: null,
  country_name: null,
});

describe('requesterLocationLine', () => {
  it('shows the primary site and counts the rest', () => {
    expect(requesterLocationLine(
      { locations: [location('warehouse', 'Warehouse', true), location('head', 'Head office')] },
      'Remote',
    )).toEqual({ locationId: 'warehouse', name: 'Warehouse +1' });
  });

  it('shows the only site without a count', () => {
    expect(requesterLocationLine({ locations: [location('head', 'Head office')] }, 'Remote'))
      .toEqual({ locationId: 'head', name: 'Head office' });
  });

  it('falls back to the attached primaryLocation when the links were not loaded', () => {
    expect(requesterLocationLine(
      { primaryLocation: { location_id: 'head', location_name: 'Head office' } },
      'Remote',
    )).toEqual({ locationId: 'head', name: 'Head office' });
  });

  it('reads a remote worker with no links as Remote', () => {
    expect(requesterLocationLine({ work_arrangement: 'remote', locations: [] }, 'Remote'))
      .toEqual({ locationId: null, name: 'Remote' });
  });

  it('shows nothing for an unlinked on-site contact, and nothing without a contact', () => {
    expect(requesterLocationLine({ work_arrangement: 'on_site', locations: [] }, 'Remote')).toBeNull();
    expect(requesterLocationLine(null, 'Remote')).toBeNull();
  });
});

describe('contactLocationSuggestion', () => {
  it('offers the primary site when the ticket has no location', () => {
    expect(contactLocationSuggestion(
      { locations: [location('head', 'Head office'), location('warehouse', 'Warehouse', true)] },
      null,
    )).toBe('warehouse');
  });

  it('offers nothing when the ticket already sits where the requester works', () => {
    expect(contactLocationSuggestion(
      { locations: [location('warehouse', 'Warehouse', true)] },
      'warehouse',
    )).toBeNull();
  });

  it('offers the requester site when the ticket sits somewhere else', () => {
    expect(contactLocationSuggestion(
      { locations: [location('warehouse', 'Warehouse', true)] },
      'depot',
    )).toBe('warehouse');
  });

  it('offers nothing for an unlinked contact', () => {
    expect(contactLocationSuggestion({ work_arrangement: 'remote', locations: [] }, null)).toBeNull();
    expect(contactLocationSuggestion(null, null)).toBeNull();
  });
});
