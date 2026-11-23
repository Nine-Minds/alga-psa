/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// alga-2026-0003226: a default portal User (client:read, no user:read) saw "You do not have permission
// to access client settings" on Client Details, because the component re-checked client:read by
// reading the user's roles through getUserRolesWithPermissions (which itself requires user:read).
// The tab is gated by resolveClientPortalSettingsSurfaces and getClientById enforces client:read,
// so the component must load the client without any role lookup.

const getCurrentUser = vi.hoisted(() => vi.fn());
const getUserClientId = vi.hoisted(() => vi.fn());
const getUserRolesWithPermissions = vi.hoisted(() => vi.fn());
const getClientById = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('react-hot-toast', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (k: string, fallback?: string) => fallback ?? k }),
}));
vi.mock('@alga-psa/user-composition/actions/userQueryActions', () => ({
  getCurrentUser: (...a: unknown[]) => getCurrentUser(...a),
  getUserClientId: (...a: unknown[]) => getUserClientId(...a),
  getUserRolesWithPermissions: (...a: unknown[]) => getUserRolesWithPermissions(...a),
}));
vi.mock('@alga-psa/clients/actions/queryActions', () => ({
  getClientById: (...a: unknown[]) => getClientById(...a),
}));
vi.mock('@alga-psa/clients/actions/clientActions', () => ({
  updateClient: vi.fn(), uploadClientLogo: vi.fn(), deleteClientLogo: vi.fn(), recropClientLogo: vi.fn(),
}));
vi.mock('@alga-psa/clients/lib/clientWebsiteUpdate', () => ({ clientWebsiteFieldsForSave: () => ({}) }));
vi.mock('@alga-psa/ui/components/EntityImageUpload', () => ({ default: () => null }));
vi.mock('@alga-psa/clients/components/clients/ClientLocations', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/Dialog', () => ({ Dialog: () => null, DialogContent: () => null }));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: ({ children }: any) => <button>{children}</button> }));
vi.mock('@alga-psa/ui/components/Input', () => ({ Input: (p: any) => <input {...p} /> }));
vi.mock('@alga-psa/ui/ui-reflection/useAutomationIdAndRegister', () => ({
  useAutomationIdAndRegister: () => ({ automationIdProps: {} }),
}));
vi.mock('@radix-ui/themes', () => ({
  Text: ({ children }: any) => <span>{children}</span>,
  Flex: ({ children }: any) => <div>{children}</div>,
}));

import { ClientDetailsSettings } from './ClientDetailsSettings';

describe('ClientDetailsSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUser.mockResolvedValue({ user_id: 'u1', user_type: 'client' });
    getUserClientId.mockResolvedValue('c1');
    // What the real action returns for a user without user:read.
    getUserRolesWithPermissions.mockResolvedValue([]);
    getClientById.mockResolvedValue({ client_id: 'c1', client_name: 'PBNJ Review Co' });
  });
  afterEach(cleanup);

  it('loads the client for a user without user:read and renders no permission error', async () => {
    render(<ClientDetailsSettings />);
    await waitFor(() => expect(getClientById).toHaveBeenCalledWith('c1'));
    await waitFor(() => expect(screen.queryByText(/permission/i)).toBeNull());
    expect(screen.queryByText('You do not have permission to access client settings')).toBeNull();
    expect(getUserRolesWithPermissions).not.toHaveBeenCalled();
  });
});
