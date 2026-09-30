/**
 * @vitest-environment jsdom
 */
/**
 * Regression for the calendar share picker: a Technician (user_schedule:read
 * only, no user:read) must see colleagues fed by getShareableUsers, and the
 * "Not assigned" clear option must not be offered in an add-recipient picker.
 * The server-side filtering is covered by the sharedCalendars integration test.
 */
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const {
  getMyCalendarShares,
  getShareableTeams,
  getShareableUsers,
  setMyCalendarShares,
  getUserAvatarUrlsBatchAction,
} = vi.hoisted(() => ({
  getMyCalendarShares: vi.fn(),
  getShareableTeams: vi.fn(),
  getShareableUsers: vi.fn(),
  setMyCalendarShares: vi.fn(),
  getUserAvatarUrlsBatchAction: vi.fn(),
}));

vi.mock('@alga-psa/scheduling/actions', () => ({
  getMyCalendarShares,
  getShareableTeams,
  getShareableUsers,
  setMyCalendarShares,
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getUserAvatarUrlsBatchAction,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  // Stable references: ShareCalendarDialog lists `t` in its load-effect deps, so
  // a fresh `t` per render would re-run the fetch in an infinite loop.
  const translation = {
    t: (_key: string, options?: Record<string, unknown> & { defaultValue?: string }) => {
      const template = (options?.defaultValue as string) ?? _key;
      return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
        options && name in options ? String(options[name]) : match);
    },
  };
  return { useTranslation: () => translation };
});

import ShareCalendarDialog from '../src/components/schedule/sharing/ShareCalendarDialog';

const sharedUser = {
  user_id: 'user-scarecrow',
  first_name: 'Scarecrow',
  last_name: 'Cornfield',
  email: 'scarecrow@cornfield.oz',
  user_type: 'internal' as const,
  is_inactive: false,
};

describe('Calendar share picker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMyCalendarShares.mockResolvedValue({ success: true, data: [] });
    getShareableTeams.mockResolvedValue({ success: true, data: [] });
    getShareableUsers.mockResolvedValue({ success: true, data: [sharedUser] });
    getUserAvatarUrlsBatchAction.mockResolvedValue(new Map());
  });

  it('lists users from getShareableUsers and hides the Not assigned option', async () => {
    render(
      <ShareCalendarDialog isOpen onClose={() => {}} currentUserId="owner-tinman" />,
    );

    // Users come from getShareableUsers (not getAllUsers/user:read).
    expect(await screen.findByText('Add a person or team')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Add a person or team'));

    expect(await screen.findByText('Scarecrow Cornfield')).toBeInTheDocument();
    expect(screen.queryByText('Not assigned')).toBeNull();
    expect(getShareableUsers).toHaveBeenCalledTimes(1);
  });
});
