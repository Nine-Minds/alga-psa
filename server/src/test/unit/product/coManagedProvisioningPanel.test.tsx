/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CoManagedProvisioningPanel from '../../../components/co-managed/CoManagedProvisioningPanel';
import { CoManagedFeatureBoundary } from '../../../components/co-managed/CoManagedFeatureBoundary';
const mocks = vi.hoisted(() => ({ flag: vi.fn(), status: vi.fn(), options: vi.fn(), provision: vi.fn(), retry: vi.fn(), cancel: vi.fn(), resize: vi.fn(), changed: vi.fn() }));
vi.mock('@alga-psa/ui/hooks', () => ({ useFeatureFlag: mocks.flag }));
vi.mock('../../../lib/actions/coManagedAcceptanceActions', () => ({}));
vi.mock('../../../lib/actions/coManagedActions', () => ({ getCoManagedProvisioningStatus: mocks.status, getCoManagedProvisioningOptions: mocks.options, changeCoManagedWorkspaceSeats: mocks.resize }));
vi.mock('@enterprise/lib/actions/coManagedProvisioningActions', () => ({ provisionCoManagedWorkspaceAction: mocks.provision, retryCoManagedProvisioningAction: mocks.retry, cancelCoManagedProvisioningAction: mocks.cancel }));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: ({ id, label, value, disabled, options, onValueChange }: any) =>
  <label>{label}<select id={id} value={value} disabled={disabled} onChange={event => onValueChange(event.target.value)}>
    <option value="">Choose</option>{options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select></label> }));
const translate = (key: string) => key;
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: translate }), useOptionalI18n: () => null }));
beforeEach(() => { vi.resetAllMocks(); mocks.flag.mockReturnValue({ enabled: true, loading: false, error: null });
  mocks.status.mockResolvedValue({ items: [], hasMore: false, canManage: true, canCreate: true });
  mocks.options.mockResolvedValue({ clients: [{ id: 'client', name: 'Customer' }], boards: [{ id: 'board', name: 'MSP escalations' }] });
  mocks.provision.mockResolvedValue({ operationId: 'operation', enqueued: true }); mocks.retry.mockResolvedValue({ enqueued: true }); mocks.cancel.mockResolvedValue({ enqueued: true }); });
afterEach(cleanup);
const panel = (canGrow = true) => render(<CoManagedFeatureBoundary><CoManagedProvisioningPanel available={2} canGrow={canGrow} onChanged={mocks.changed} /></CoManagedFeatureBoundary>);
async function fillForm() {
  fireEvent.click(await screen.findByRole('button', { name: 'coManaged.provisioning.create' }));
  await screen.findByRole('option', { name: 'Customer' });
  fireEvent.change(screen.getByLabelText('coManaged.provisioning.client'), { target: { value: 'client' } });
  for (const field of ['firstName', 'lastName', 'email']) fireEvent.change(screen.getByLabelText(`coManaged.provisioning.${field}`),
    { target: { value: field === 'email' ? 'admin@example.test' : 'Customer' } });
  fireEvent.change(screen.getByLabelText('coManaged.provisioning.destination'), { target: { value: 'board' } });
}
describe('co-managed provisioning UI', () => {
  it('resends an expired administrator invitation through the existing operation even when pool growth is paused', async () => {
    mocks.status.mockResolvedValue({ canManage: true, canCreate: false, hasMore: false, items: [
      { operationId: 'existing-operation', workspaceName: 'Customer', administratorEmail: 'admin@example.test', seats: 1,
        state: 'pending_acceptance', canRetry: true, invitationSent: true, invitationExpired: true },
    ] });
    panel(false);
    expect(await screen.findByText('coManaged.provisioning.invitationExpired')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'coManaged.provisioning.resendInvitation' }));
    await waitFor(() => expect(mocks.retry).toHaveBeenCalledWith('existing-operation'));
    expect(mocks.provision).not.toHaveBeenCalled(); expect(mocks.resize).not.toHaveBeenCalled();
  });
  it('keeps expired-invitation recovery hidden from a relationship reader without management rights', async () => {
    mocks.status.mockResolvedValue({ canManage: false, canCreate: false, hasMore: false, items: [
      { operationId: 'operation', workspaceName: 'Customer', administratorEmail: 'admin@example.test', seats: 1,
        state: 'pending_acceptance', canRetry: true, invitationSent: true, invitationExpired: true },
    ] });
    panel(); await screen.findByText('Customer');
    expect(screen.queryByRole('button', { name: 'coManaged.provisioning.resendInvitation' })).toBeNull();
  });
  it('does not fetch or mount provisioning controls with the release flag off', () => {
    mocks.flag.mockReturnValue({ enabled: false, loading: false, error: null }); panel();
    expect(mocks.status).not.toHaveBeenCalled(); expect(mocks.options).not.toHaveBeenCalled();
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('requires available capacity and explicit submission of the customer details', async () => {
    panel(); await fillForm(); expect(mocks.provision).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'coManaged.provisioning.submit' }));
    await waitFor(() => expect(mocks.provision).toHaveBeenCalledWith(expect.objectContaining({
      clientId: 'client', workspaceName: 'Customer', seats: 1, visibilityMode: 'board_scope', escalationBoardId: 'board',
      administrator: { firstName: 'Customer', lastName: 'Customer', email: 'admin@example.test' }, operationId: expect.any(String),
    })));
    await waitFor(() => expect(mocks.changed).toHaveBeenCalledOnce());
  });
  it('reuses an unchanged operation after an ambiguous failed response', async () => {
    mocks.provision.mockRejectedValueOnce(new Error('Connection lost')); panel(); await fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'coManaged.provisioning.submit' }));
    const retry = await screen.findByRole('button', { name: 'coManaged.provisioning.retry' });
    expect(screen.getByLabelText('coManaged.provisioning.email')).toBeDisabled();
    const first = mocks.provision.mock.calls[0][0]; fireEvent.click(retry);
    await waitFor(() => expect(mocks.provision).toHaveBeenCalledTimes(2));
    expect(mocks.provision.mock.calls[1][0]).toEqual(first);
  });
  it('lets an acknowledged rejected request be corrected without changing its operation identity', async () => {
    mocks.provision.mockResolvedValueOnce({ operationId: 'operation', rejected: true, errorCode: 'INVALID_REQUEST' }); panel(); await fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'coManaged.provisioning.submit' }));
    await waitFor(() => expect(screen.getByLabelText('coManaged.provisioning.email')).not.toBeDisabled());
    const first = mocks.provision.mock.calls[0][0];
    fireEvent.change(screen.getByLabelText('coManaged.provisioning.email'), { target: { value: 'corrected@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'coManaged.provisioning.submit' }));
    await waitFor(() => expect(mocks.provision).toHaveBeenCalledTimes(2));
    expect(mocks.provision.mock.calls[1][0].operationId).toBe(first.operationId);
  });
  it('disables new provisioning during lapse while keeping the progress list available', async () => {
    panel(false); expect(await screen.findByRole('button', { name: 'coManaged.provisioning.create' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'coManaged.provisioning.refresh' })).toBeEnabled();
  });
  it('retries the existing operation from its progress row', async () => {
    mocks.status.mockResolvedValue({ canManage: true, canCreate: false, hasMore: false,
      items: [{ operationId: 'operation', workspaceName: 'Customer', administratorEmail: 'admin@example.test', seats: 1, state: 'failed', canRetry: true }] });
    panel(); fireEvent.click(await screen.findByRole('button', { name: 'coManaged.provisioning.retry' }));
    await waitFor(() => expect(mocks.retry).toHaveBeenCalledWith('operation')); expect(mocks.provision).not.toHaveBeenCalled();
  });
});

it('resizes the existing customer allocation with its expected previous seat count', async () => {
  mocks.status.mockResolvedValue({ canManage: true, canCreate: true, hasMore: false, items: [
    { operationId: 'existing-operation', workspaceName: 'Customer', administratorEmail: 'admin@example.test', seats: 1,
      state: 'active', canRetry: false, canChangeSeats: true },
  ] });
  panel(); fireEvent.click(await screen.findByRole('button', { name: 'coManaged.provisioning.resize' }));
  fireEvent.change(screen.getByLabelText('coManaged.provisioning.seats'), { target: { value: '2' } });
  expect(mocks.resize).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.provisioning.saveAllocation' }));
  await waitFor(() => expect(mocks.resize).toHaveBeenCalledWith({ operationId: 'existing-operation', seats: 2, expectedSeats: 1 }));
});


it.each([true, false])('exposes the active workspace access editor only to an MSP manager: %s', async (canManage) => {
  mocks.status.mockResolvedValue({ canManage, canCreate: false, hasMore: false, items: [
    { operationId: 'active-operation', workspaceName: 'Active customer', administratorEmail: 'admin@example.test', seats: 1, state: 'active', canRetry: false },
    { operationId: 'pending-operation', workspaceName: 'Pending customer', administratorEmail: 'admin@example.test', seats: 1, state: 'pending_acceptance', canRetry: false },
  ] });
  panel(); await screen.findByText('Active customer');
  const links = screen.queryAllByRole('link', { name: 'coManaged.policy.manage' });
  expect(links).toHaveLength(canManage ? 1 : 0);
  if (canManage) expect(links[0]).toHaveAttribute('href', '/msp/co-management?operationId=active-operation');
});

it('hides per-workspace management controls when home policy allows reading but denies managing that client', async () => {
  mocks.status.mockResolvedValue({ canManage: true, canCreate: true, hasMore: false, items: [
    { operationId: 'restricted-operation', workspaceName: null, administratorEmail: null, seats: 1, state: 'active',
      canManage: false, canRetry: false, canChangeSeats: false },
  ] });
  panel(); await screen.findByRole('cell', { name: 'coManaged.provisioning.workspace' });
  expect(screen.queryByRole('link', { name: 'coManaged.policy.manage' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'coManaged.provisioning.resize' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'coManaged.provisioning.retry' })).toBeNull();
});

it('requires confirmation before cancelling the exact unclaimed workspace and keeps cleanup retryable after scheduling failure', async () => {
  const operation = { operationId: 'unclaimed-operation', workspaceName: 'Unclaimed customer', administratorEmail: 'admin@example.test',
    seats: 1, state: 'failed', canCancel: true, canRetry: true };
  mocks.status.mockResolvedValue({ canManage: true, canCreate: true, hasMore: false, items: [operation] });
  panel(false); fireEvent.click(await screen.findByRole('button', { name: 'coManaged.provisioning.cancelSetup' }));
  expect(mocks.cancel).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.provisioning.keepSetup' }));
  expect(mocks.cancel).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.provisioning.cancelSetup' }));
  mocks.cancel.mockResolvedValue({ enqueued: false });
  mocks.status.mockResolvedValue({ canManage: true, canCreate: true, hasMore: false,
    items: [{ ...operation, state: 'cleanup_requested', canCancel: false, cleanupFailed: false }] });
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.provisioning.confirmCancel' }));
  await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith('unclaimed-operation'));
  await screen.findByText('coManaged.provisioning.cleanupPending');
  expect(screen.getByText('coManaged.provisioning.workerUnavailable')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.provisioning.retryCleanup' }));
  await waitFor(() => expect(mocks.retry).toHaveBeenCalledWith('unclaimed-operation'));
  expect(mocks.provision).not.toHaveBeenCalled(); expect(mocks.resize).not.toHaveBeenCalled();
});

it('hides cancellation after the customer claims the administrator account', async () => {
  mocks.status.mockResolvedValue({ canManage: true, canCreate: true, hasMore: false, items: [
    { operationId: 'claimed-operation', workspaceName: 'Claimed customer', administratorEmail: 'admin@example.test',
      seats: 1, state: 'pending_acceptance', canCancel: false, canRetry: false },
  ] });
  panel(); await screen.findByText('Claimed customer');
  expect(screen.queryByRole('button', { name: 'coManaged.provisioning.cancelSetup' })).toBeNull();
});
