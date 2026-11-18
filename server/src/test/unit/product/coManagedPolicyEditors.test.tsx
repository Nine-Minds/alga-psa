/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CoManagedPolicyPanel from '../../../components/co-managed/CoManagedPolicyPanel';

const mocks = vi.hoisted(() => ({ load: vi.fn(), options: vi.fn(), scope: vi.fn(), assign: vi.fn(), users: vi.fn(), explain: vi.fn() }));
vi.mock('../../../lib/actions/coManagedPolicyActions', () => ({ getCoManagedPolicyAction: mocks.load, listCoManagedPolicyOptionsAction: mocks.options,
  replaceCoManagedCustomerScopeAction: mocks.scope, replaceCoManagedStaffAssignmentsAction: mocks.assign,
  listCoManagedExplanationUsersAction: mocks.users, explainCoManagedAccessAction: mocks.explain }));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: ({ id, label, value, disabled, options, onValueChange }: any) =>
  <label>{label}<select id={id} aria-label={label ?? id} value={value} disabled={disabled} onChange={event => onValueChange(event.target.value)}>
    <option value="">Choose</option>{options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label> }));
vi.mock('@alga-psa/ui/components/DataTable', () => ({ DataTable: ({ data, columns }: any) => <table><tbody>{data.map((row: any, i: number) =>
  <tr key={i}>{columns.map((c: any, j: number) => <td key={j}>{c.render ? c.render(row[c.dataIndex], row, i) : row[c.dataIndex]}</td>)}</tr>)}</tbody></table> }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string, o?: any) => (o?.defaultValue ?? key).replace('{{name}}', o?.name ?? '') }) }));

const policy = (revision = 4) => ({ revision, visibilityMode: 'board_scope', boards: [{ id: 'b1', canCollaborate: false }], projects: [],
  assignments: [{ kind: 'user', principalId: 'u1', role: 'viewer' }] });
const screenFor = (side: 'customer' | 'sponsor', canManage = true, revision = 4) => ({ ok: true, side, canManage, policy: policy(revision),
  names: { boards: { b1: 'Service Desk' }, projects: {}, users: { u1: 'Quinn Tech' }, teams: {} } });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.users.mockResolvedValue([]); mocks.options.mockImplementation(async (_r: string, kind: string) => ({ ok: true, hasMore: false,
    options: kind === 'board' ? [{ id: 'b2', name: 'Projects Board' }] : kind === 'user' ? [{ id: 'u2', name: 'Xander' }] : [] }));
  mocks.scope.mockResolvedValue({ ok: true, revision: 5 }); mocks.assign.mockResolvedValue({ ok: true, revision: 5 });
});
afterEach(cleanup);

describe('co-managed policy editors', () => {
  it('lets a customer add a board, switch it to Collaborate and save at the loaded revision', async () => {
    mocks.load.mockResolvedValue(screenFor('customer'));
    render(<CoManagedPolicyPanel relationshipId="r1" />);
    await screen.findByText('Service Desk');
    await waitFor(() => expect(mocks.options).toHaveBeenCalledWith('r1', 'board', '', 0));
    await screen.findByRole('option', { name: 'Projects Board' });
    fireEvent.change(document.getElementById('co-managed-scope-boards-select')!, { target: { value: 'b2' } });
    fireEvent.click(document.getElementById('co-managed-scope-boards-add')!);
    fireEvent.change(document.getElementById('co-managed-scope-boards-access-b2')!, { target: { value: 'collaborate' } });
    fireEvent.click(document.getElementById('co-managed-scope-boards-remove-b1')!);
    fireEvent.click(document.getElementById('co-managed-scope-save')!);
    await waitFor(() => expect(mocks.scope).toHaveBeenCalledWith('r1', 4,
      { visibilityMode: 'board_scope', boards: [{ id: 'b2', canCollaborate: true }], projects: [] }));
  });

  it('keeps shared boards when switching to escalated-only', async () => {
    mocks.load.mockResolvedValue(screenFor('customer'));
    render(<CoManagedPolicyPanel relationshipId="r1" />);
    await screen.findByText('Service Desk');
    fireEvent.change(document.getElementById('co-managed-scope-mode')!, { target: { value: 'escalation_only' } });
    fireEvent.click(document.getElementById('co-managed-scope-save')!);
    await waitFor(() => expect(mocks.scope).toHaveBeenCalledWith('r1', 4,
      { visibilityMode: 'escalation_only', boards: [{ id: 'b1', canCollaborate: false }], projects: [] }));
  });

  it('locks the form on a revision conflict until Reload fetches the new revision', async () => {
    mocks.load.mockResolvedValue(screenFor('customer'));
    mocks.scope.mockResolvedValueOnce({ ok: false, errorCode: 'POLICY_CHANGED' });
    render(<CoManagedPolicyPanel relationshipId="r1" />);
    await screen.findByText('Service Desk');
    fireEvent.click(document.getElementById('co-managed-scope-save')!);
    await screen.findByText(/changed since you opened it/);
    expect(document.getElementById('co-managed-scope-save')).toBeDisabled();
    expect(document.getElementById('co-managed-scope-mode')).toBeDisabled();
    mocks.load.mockResolvedValue(screenFor('customer', true, 6));
    fireEvent.click(document.getElementById('co-managed-scope-reload')!);
    await waitFor(() => expect(document.getElementById('co-managed-scope-save')).toBeEnabled());
    fireEvent.click(document.getElementById('co-managed-scope-save')!);
    await waitFor(() => expect(mocks.scope).toHaveBeenLastCalledWith('r1', 6, expect.anything()));
  });

  it('lets the sponsor assign a user as Technician and shows display names, not ids', async () => {
    mocks.load.mockResolvedValue(screenFor('sponsor'));
    render(<CoManagedPolicyPanel relationshipId="r1" />);
    await screen.findByText('Quinn Tech');
    expect(screen.queryByText('u1')).toBeNull();
    await screen.findByRole('option', { name: 'Xander' });
    fireEvent.change(document.getElementById('co-managed-assign-users-select')!, { target: { value: 'u2' } });
    fireEvent.click(document.getElementById('co-managed-assign-users-add')!);
    fireEvent.change(document.getElementById('co-managed-assign-users-access-u2')!, { target: { value: 'technician' } });
    fireEvent.click(document.getElementById('co-managed-assign-save')!);
    await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith('r1', 4,
      [{ kind: 'user', principalId: 'u1', role: 'viewer' }, { kind: 'user', principalId: 'u2', role: 'technician' }]));
  });

  it('shows a read-only view without editors for a reader who cannot manage', async () => {
    mocks.load.mockResolvedValue(screenFor('sponsor', false));
    render(<CoManagedPolicyPanel relationshipId="r1" />);
    await screen.findByText('Quinn Tech (user)');
    expect(document.getElementById('co-managed-assign-save')).toBeNull();
  });

  it('says honestly that permission is missing instead of a load failure', async () => {
    mocks.load.mockResolvedValue({ ok: false, errorCode: 'PERMISSION_DENIED' });
    render(<CoManagedPolicyPanel relationshipId="r1" />);
    expect(await screen.findByText(/does not include permission to view co-managed access/)).toBeTruthy();
    expect(screen.queryByText(/Could not load the effective access/)).toBeNull();
  });
});
