/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CoManagedDelegatedAdministration from '../../../components/co-managed/CoManagedDelegatedAdministration';
import CoManagedAdministration from '../../../components/co-managed/CoManagedAdministration';

const mocks = vi.hoisted(() => ({ screen: vi.fn(), revoke: vi.fn(), save: vi.fn(), search: vi.fn(), exec: vi.fn(), list: vi.fn() }));
vi.mock('@/lib/actions/coManagedDelegatedActions', () => ({ getCoManagedDelegatedScreenAction: mocks.screen, revokeCoManagedDelegatedGrantAction: mocks.revoke,
  saveCoManagedDelegatedGrantAction: mocks.save, searchCoManagedDelegatedOptionsAction: mocks.search, executeCoManagedDelegatedCommandAction: mocks.exec,
  listCoManagedAdministrationWorkspacesAction: mocks.list }));
vi.mock('../../../components/co-managed/CoManagedPolicyPanel', () => ({ default: ({ relationshipId }: any) => <div id="stub-policy">{relationshipId}</div> }));
vi.mock('@alga-psa/ui/components/DataTable', () => ({ DataTable: ({ data, columns }: any) => <table><tbody>{data.map((row: any, i: number) =>
  <tr key={i}>{columns.map((c: any, j: number) => <td key={j}>{c.render ? c.render(row[c.dataIndex], row, i) : row[c.dataIndex]}</td>)}</tr>)}</tbody></table> }));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: ({ id, label, value, options, onValueChange }: any) =>
  <select id={id} aria-label={label} value={value} onChange={e => onValueChange(e.target.value)}>{options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}</select> }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string, o?: any) => o?.defaultValue ?? key }) }));

const grant = (over: object = {}) => ({ grantId: 'g1', operation: 'board_settings', targetId: 't', principalName: 'Quinn', label: 'Service Desk', available: true, canEdit: true, ...over });
const sponsorScreen = (grants = [grant()]) => ({ ok: true, screen: { side: 'sponsor', revision: 1, canWrite: true, workspaceName: 'Oz', grants } });
const customerScreen = () => ({ ok: true, screen: { side: 'customer', revision: 1, canWrite: true, sponsorName: 'MSP', grants: [grant()] } });
beforeEach(() => { vi.resetAllMocks(); mocks.search.mockResolvedValue({ ok: true, options: [] }); });
afterEach(cleanup);

describe('delegated administration refusals', () => {
  it.each([['CO_MANAGED_DELEGATION_REVOKED', 'The customer revoked this approval.'], ['NOT_AVAILABLE', 'This is no longer available.']])(
    'keeps the %s refusal visible after the reload that follows a failed revoke', async (code, text) => {
      mocks.screen.mockResolvedValue(customerScreen()); mocks.revoke.mockResolvedValue({ ok: false, errorCode: code });
      render(<CoManagedDelegatedAdministration relationshipId="r1" />);
      fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
      // The refusal shows, and once the post-revoke reload lands the grant (and its Revoke button) is back beside it.
      expect(await screen.findByText(text)).toBeTruthy();
      await waitFor(() => expect(mocks.screen).toHaveBeenCalledTimes(2));
      expect(await screen.findByRole('button', { name: 'Revoke' })).toBeTruthy();
      // Let any further renders settle: the translation mock hands out a fresh `t` on every render, so a fetch
      // that depended on `t` would keep reloading here. Exactly the initial load plus the post-revoke reload.
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
      expect(mocks.screen).toHaveBeenCalledTimes(2);
      expect(screen.getByText(text)).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Revoke' })).toBeTruthy();
    });

  it('clears the refusal once a later revoke succeeds', async () => {
    mocks.screen.mockResolvedValue(customerScreen());
    mocks.revoke.mockResolvedValueOnce({ ok: false, errorCode: 'NOT_AVAILABLE' }).mockResolvedValueOnce({ ok: true });
    render(<CoManagedDelegatedAdministration relationshipId="r1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
    await screen.findByText('This is no longer available.');
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(screen.queryByText('This is no longer available.')).toBeNull());
  });

  it('disables Edit and says why when the server reports the delegate lacks the home permission', async () => {
    mocks.screen.mockResolvedValue(sponsorScreen([grant({ canEdit: false })]));
    render(<CoManagedDelegatedAdministration relationshipId="r1" />);
    const edit = await screen.findByRole('button', { name: 'Edit' });
    expect(edit).toBeDisabled();
    expect(document.getElementById('co-managed-delegation-edit-unavailable-g1')).toBeTruthy();
  });

  it('enables Edit when the server reports the delegate may update', async () => {
    mocks.screen.mockResolvedValue(sponsorScreen());
    render(<CoManagedDelegatedAdministration relationshipId="r1" />);
    expect(await screen.findByRole('button', { name: 'Edit' })).toBeEnabled();
  });
});

describe('administration sections', () => {
  it('shows only the Effective access section for a workspace that is effective but not delegated', async () => {
    mocks.list.mockResolvedValue([{ relationshipId: 'r1', name: 'Emerald', effective: true, delegated: false }]);
    render(<CoManagedAdministration />);
    await screen.findByText('Effective access');
    expect(screen.queryByText('Delegated administration')).toBeNull();
  });

  it('shows only the delegated section for a workspace that is delegated but not effective', async () => {
    mocks.list.mockResolvedValue([{ relationshipId: 'r2', name: 'Kansas', effective: false, delegated: true }]);
    mocks.screen.mockResolvedValue(sponsorScreen());
    render(<CoManagedAdministration initialRelationshipId="r2" />);
    await screen.findByText('Delegated administration');
    expect(screen.queryByText('Effective access')).toBeNull();
  });
});
