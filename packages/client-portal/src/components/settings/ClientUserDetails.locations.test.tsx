/**
 * @vitest-environment jsdom
 *
 * T077: the portal shows a user where they work, read-only — the primary marked, a remote worker
 * badged, and nothing at all when there is nothing to show. No input, no save: the write path
 * refuses both fields (see clientUserActions.locations.test.ts).
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({ getClientUserById: vi.fn() }));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));
vi.mock('@alga-psa/ui', () => ({ useDrawer: () => ({ closeDrawer: vi.fn() }) }));
vi.mock('@alga-psa/user-composition/actions/userQueryActions', () => ({
  getCurrentUser: vi.fn(async () => null),
  getUserRolesWithPermissions: vi.fn(async () => []),
}));
vi.mock('../../actions/client-portal-actions/clientUserActions', () => ({
  getClientUserById: hoisted.getClientUserById,
  updateClientUser: vi.fn(),
  getClientUserManagerOptions: vi.fn(async () => []),
  resetClientUserPassword: vi.fn(),
  getClientPortalRoles: vi.fn(async () => []),
  getClientUserRoles: vi.fn(async () => []),
  assignClientUserRole: vi.fn(),
  removeClientUserRole: vi.fn(),
}));
vi.mock('./ClientPasswordChangeForm', () => ({ default: () => null }));

import ClientUserDetails from './ClientUserDetails';

const portalUser = {
  user_id: 'user-1',
  first_name: 'Dorothy',
  last_name: 'Gale',
  email: 'dorothy@acme.test',
  is_inactive: false,
  user_type: 'client',
  roles: [],
};

const renderDetails = async () => {
  const { container } = render(<ClientUserDetails userId="user-1" onUpdate={vi.fn()} />);
  await waitFor(() => expect(hoisted.getClientUserById).toHaveBeenCalledWith('user-1'));
  return container;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ClientUserDetails locations', () => {
  it('lists the locations read-only with the primary marked', async () => {
    hoisted.getClientUserById.mockResolvedValue({
      ...portalUser,
      work_arrangement: 'on_site',
      locations: [
        { location_id: 'loc-1', location_name: 'Warehouse', is_primary: true },
        { location_id: 'loc-2', location_name: 'Head office', is_primary: false },
      ],
    });

    await renderDetails();

    const block = await waitFor(() => {
      const found = document.querySelector('#user-user-1-locations') as HTMLElement | null;
      expect(found).toBeInTheDocument();
      return found!;
    });
    expect(block).toHaveTextContent('Warehouse • Primary');
    expect(block).toHaveTextContent('Head office');
    // Read-only: no field to type a location into.
    expect(block.querySelector('input')).toBeNull();
  });

  it('badges a remote worker', async () => {
    hoisted.getClientUserById.mockResolvedValue({ ...portalUser, work_arrangement: 'remote', locations: [] });
    await renderDetails();

    expect(await screen.findByText('Remote')).toBeInTheDocument();
  });

  it('shows no locations block for a contact with neither links nor an arrangement', async () => {
    hoisted.getClientUserById.mockResolvedValue({ ...portalUser, work_arrangement: null, locations: [] });
    const container = await renderDetails();

    await waitFor(() => expect(screen.getByDisplayValue('dorothy@acme.test')).toBeInTheDocument());
    expect(container.querySelector('#user-user-1-locations')).toBeNull();
  });
});
