import { describe, expect, it } from 'vitest';
import { contactLocationCell, contactLocationSortKey } from './contactLocationDisplay';

const location = (id: string, name: string, isPrimary = false, isActive = true) => ({
  location_id: id, location_name: name, is_primary: isPrimary, is_active: isActive,
});

describe('contactLocationCell', () => {
  it('reads as the primary name plus a count of the rest', () => {
    const cell = contactLocationCell({
      work_arrangement: 'on_site',
      locations: [location('w', 'Warehouse', true), location('h', 'Head office')],
    });
    expect(cell).toEqual({ label: 'Warehouse', extraCount: 1, isRemote: false });
  });

  it('treats a lone unflagged link as the primary', () => {
    expect(contactLocationCell({ work_arrangement: null, locations: [location('w', 'Warehouse')] }))
      .toEqual({ label: 'Warehouse', extraCount: 0, isRemote: false });
  });

  it('reads as Remote for a remote contact with no links', () => {
    expect(contactLocationCell({ work_arrangement: 'remote', locations: [] }))
      .toEqual({ label: 'Remote', extraCount: 0, isRemote: true });
  });

  it('shows the link, not Remote, when a remote contact does have one', () => {
    expect(contactLocationCell({ work_arrangement: 'remote', locations: [location('w', 'Warehouse', true)] }))
      .toEqual({ label: 'Warehouse', extraCount: 0, isRemote: true });
  });

  it('is empty for a contact with neither — never the client default', () => {
    expect(contactLocationCell({ work_arrangement: null, locations: [] }))
      .toEqual({ label: null, extraCount: 0, isRemote: false });
    expect(contactLocationCell({ work_arrangement: 'hybrid' }))
      .toEqual({ label: null, extraCount: 0, isRemote: false });
  });

  it('falls back to primaryLocation when only the picker shape was loaded', () => {
    expect(contactLocationCell({
      work_arrangement: null,
      primaryLocation: { location_id: 'w', location_name: 'Warehouse' },
    })).toEqual({ label: 'Warehouse', extraCount: 0, isRemote: false });
  });

  it('sorts by the primary name, with the unlinked last', () => {
    const rows = [
      { work_arrangement: null, locations: [] },
      { work_arrangement: 'on_site' as const, locations: [location('w', 'Warehouse', true)] },
      { work_arrangement: 'on_site' as const, locations: [location('h', 'Head office', true)] },
    ];
    expect([...rows].sort((left, right) => contactLocationSortKey(left).localeCompare(contactLocationSortKey(right)))
      .map((row) => contactLocationSortKey(row))).toEqual(['', 'Head office', 'Warehouse']);
  });
});
