/**
 * T054 / T116 (F035 / F078) — the timeline's wording for assignment and group
 * entries. The generic "Updated: Contact name id" told nobody anything, so each
 * source gets its own phrasing.
 */
import { describe, expect, it, vi } from 'vitest';

// AssetTimeline is a client component; the helper under test is pure, so the
// server actions it imports are stubbed rather than loaded (they pull next-auth).
vi.mock('../actions/assetActions', () => ({
  getAssetHistory: vi.fn(),
  getAssetLinkedTickets: vi.fn(),
  getAssetMaintenanceReport: vi.fn(),
}));
vi.mock('../actions/assetActionErrors', () => ({
  unwrapAssetActionResult: (value: unknown) => value,
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const { describeAssetHistoryEntry } = await import('./AssetTimeline');

const t = (key: string, options?: Record<string, unknown>) => {
  let result = String(options?.defaultValue ?? key);
  for (const [name, value] of Object.entries(options ?? {})) {
    if (name !== 'defaultValue') result = result.replace(`{{${name}}}`, String(value));
  }
  return result;
};

const entry = (change_type: string, changes: Record<string, unknown>) => ({ change_type, changes });

describe('describeAssetHistoryEntry', () => {
  it('words a manual assignment with the contact name', () => {
    const described = describeAssetHistoryEntry(
      entry('assignee_changed', { source: 'manual', contact_name_id: 'c1', contact_name: 'Jane Doe' }),
      t
    );
    expect(described?.title).toBe('Assigned to Jane Doe');
  });

  it('words an unassignment without a contact', () => {
    const described = describeAssetHistoryEntry(
      entry('assignee_changed', { source: 'manual', contact_name_id: null, previous_contact_name: 'Jane Doe' }),
      t
    );
    expect(described?.title).toBe('Unassigned');
  });

  it('words an RMM auto-assignment and keeps the raw user as the detail', () => {
    const described = describeAssetHistoryEntry(
      entry('assignee_changed', {
        source: 'rmm',
        contact_name_id: 'c1',
        contact_name: 'Jane Doe',
        note: 'CORP\\jdoe',
      }),
      t
    );
    expect(described?.title).toBe('Auto-assigned to Jane Doe from the signed-in user');
    expect(described?.detail).toBe('CORP\\jdoe');
  });

  it('words a bundle propagation with the group name', () => {
    const described = describeAssetHistoryEntry(
      entry('assignee_changed', {
        source: 'bundle',
        contact_name_id: 'c1',
        contact_name: 'Jane Doe',
        note: 'Front desk 1',
      }),
      t
    );
    expect(described?.title).toBe('Assigned to Jane Doe via bundle Front desk 1');
  });

  it('falls back to a generic person when the name was not captured', () => {
    const described = describeAssetHistoryEntry(
      entry('assignee_changed', { source: 'manual', contact_name_id: 'c1' }),
      t
    );
    expect(described?.title).toBe('Assigned to a contact');
  });

  it('words group membership changes', () => {
    expect(describeAssetHistoryEntry(entry('group_added', { group_name: 'Front desk 1' }), t)?.title)
      .toBe('Added to Front desk 1');
    expect(describeAssetHistoryEntry(entry('group_removed', { group_name: 'Front desk 1' }), t)?.title)
      .toBe('Removed from Front desk 1');
  });

  it('leaves every other change type to the generic renderer', () => {
    expect(describeAssetHistoryEntry(entry('updated', { name: 'x' }), t)).toBeNull();
    expect(describeAssetHistoryEntry(entry('created', {}), t)).toBeNull();
  });
});
