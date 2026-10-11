// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IRole } from '@alga-psa/types';

const mocks = vi.hoisted(() => ({
  getRoles: vi.fn(),
  updateRole: vi.fn(),
}));

vi.mock('../../../actions/policyActions', () => ({
  getRoles: mocks.getRoles,
  updateRole: mocks.updateRole,
  createRole: vi.fn(),
  deleteRole: vi.fn(),
}));
vi.mock('@alga-psa/auth/lib/preCheckDeletion', () => ({ preCheckDeletion: vi.fn() }));
vi.mock('@alga-psa/ui', () => ({ DeleteEntityDialog: () => null }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

import RoleManagement from './RoleManagement';

const role = (role_id: string, role_name: string, description = ''): IRole => ({
  role_id,
  role_name,
  description,
  msp: true,
  client: false,
});

describe('RoleManagement row actions', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
    });
    mocks.getRoles.mockResolvedValue([
      role('r-admin', 'Admin', 'Full access'),
      role('r-tech', 'Technician'),
      role('r-custom', 'Night Shift', 'After-hours desk'),
    ]);
    mocks.updateRole.mockResolvedValue(role('r-custom', 'Night Desk'));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('renders a kebab menu in the actions column of every row, not the portal text', async () => {
    render(<RoleManagement />);
    await screen.findByText('Night Shift');
    for (const id of ['r-admin', 'r-tech', 'r-custom']) {
      expect(document.querySelector(`#role-actions-${id}`)).not.toBeNull();
    }
  });

  it('disables Delete for the Admin role', async () => {
    render(<RoleManagement />);
    await screen.findByText('Admin');
    await userEvent.click(document.querySelector('#role-actions-r-admin') as HTMLElement);
    const deleteItem = await screen.findByText('common:common.delete');
    expect(deleteItem.closest('[role="menuitem"]')?.getAttribute('data-disabled')).not.toBeNull();
  });

  it('renames a custom role and saves name and description', async () => {
    render(<RoleManagement />);
    await screen.findByText('Night Shift');
    await userEvent.click(document.querySelector('#role-actions-r-custom') as HTMLElement);
    await userEvent.click(await screen.findByText('common:common.edit'));

    const name = document.querySelector('#edit-role-name') as HTMLInputElement;
    expect(name.disabled).toBe(false);
    await userEvent.clear(name);
    await userEvent.type(name, 'Night Desk');
    await userEvent.click(document.querySelector('#confirm-edit-role-btn') as HTMLElement);

    await waitFor(() => expect(mocks.updateRole).toHaveBeenCalledWith('r-custom', {
      role_name: 'Night Desk',
      description: 'After-hours desk',
    }));
  });

  it('locks the name of a built-in role and only sends the description', async () => {
    render(<RoleManagement />);
    await screen.findByText('Technician');
    await userEvent.click(document.querySelector('#role-actions-r-tech') as HTMLElement);
    await userEvent.click(await screen.findByText('common:common.edit'));

    expect((document.querySelector('#edit-role-name') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText('roleManagement.editDialog.builtInNameLocked')).toBeTruthy();
    await userEvent.type(document.querySelector('#edit-role-description') as HTMLElement, 'Field techs');
    await userEvent.click(document.querySelector('#confirm-edit-role-btn') as HTMLElement);

    await waitFor(() => expect(mocks.updateRole).toHaveBeenCalledWith('r-tech', { description: 'Field techs' }));
  });
});
