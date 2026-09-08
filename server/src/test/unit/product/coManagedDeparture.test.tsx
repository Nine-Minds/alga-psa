/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CoManagedDeparture from '../../../components/co-managed/CoManagedDeparture';
import { CoManagedFeatureBoundary } from '../../../components/co-managed/CoManagedFeatureBoundary';
const mocks = vi.hoisted(() => ({ load: vi.fn(), end: vi.fn(), flag: true, tenant: 'customer', sessionId: 'session' }));
vi.mock('../../../lib/actions/coManagedDepartureActions', () => ({ getCoManagedDepartureScreenAction: mocks.load, departCoManagedRelationshipAction: mocks.end }));
vi.mock('@alga-psa/ui/hooks', () => ({ useFeatureFlag: () => ({ enabled: mocks.flag }) }));
vi.mock('../../../lib/actions/coManagedAcceptanceActions', () => ({}));
vi.mock('@/context/ProductContext', () => ({ useProduct: () => ({ productCode: 'co_managed' }) }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { session_id: mocks.sessionId, user: { id: 'admin', tenant: mocks.tenant } } }) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string) => key }), useOptionalI18n: () => null }));
vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({ ConfirmationDialog: ({ isOpen, onConfirm, onClose, message, isConfirming }: any) => isOpen
  ? <div role="dialog"><p>{message}</p><button disabled={isConfirming} onClick={onConfirm}>Confirm departure</button><button disabled={isConfirming} onClick={onClose}>Cancel departure</button></div> : null }));
const active = { side: 'customer', relationshipId: 'relationship', revision: 4, counterpartName: 'MSP', departed: false, closedAt: null };
const mount = (operationId?: string) => render(<CoManagedFeatureBoundary><CoManagedDeparture operationId={operationId} /></CoManagedFeatureBoundary>);
beforeEach(() => { vi.clearAllMocks(); mocks.flag = true; mocks.tenant = 'customer'; mocks.sessionId = 'session'; mocks.load.mockResolvedValue(active);
  mocks.end.mockResolvedValue({ appliedRevision: 5, closedAt: '2026-09-08T16:00:00.000Z' }); });
afterEach(cleanup);

it('hides departure controls and does not load the action while the release flag is off', () => {
  mocks.flag = false; mount(); expect(mocks.load).not.toHaveBeenCalled(); expect(screen.queryByRole('button')).toBeNull();
});
it('reviews consequences, requires confirmation, and retries an uncertain closure with the original operation', async () => {
  mount(); fireEvent.click(await screen.findByRole('button', { name: 'coManaged.departure.review' }));
  expect(mocks.end).not.toHaveBeenCalled(); expect(screen.getByText('coManaged.departure.immediate')).toBeVisible();
  expect(screen.getByText('coManaged.departure.preserved')).toBeVisible();
  mocks.end.mockRejectedValueOnce(new Error('Lost acknowledgement'));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm departure' }));
  await screen.findByText('coManaged.departure.endError');
  fireEvent.click(screen.getByRole('button', { name: 'Confirm departure' }));
  await screen.findByText('coManaged.departure.completed');
  expect(mocks.end).toHaveBeenCalledTimes(2); expect(mocks.end.mock.calls[1]).toEqual(mocks.end.mock.calls[0]);
  expect(mocks.end.mock.calls[0][0]).toMatchObject({ expectedRevision: 4, relationshipId: 'relationship', operationId: expect.any(String) });
  expect(screen.queryByRole('button', { name: 'coManaged.departure.review' })).toBeNull();
  expect(screen.getByRole('link', { name: 'coManaged.upgrade.title' })).toHaveAttribute('href', '/msp/co-management/upgrade');
});
it('uses the sponsor-owned operation selector and refreshes stale review before a new confirmation', async () => {
  mocks.load.mockResolvedValue({ ...active, side: 'sponsor' }); mount('owned-provisioning');
  fireEvent.click(await screen.findByRole('button', { name: 'coManaged.departure.review' }));
  mocks.end.mockRejectedValueOnce(new Error('CLOSURE_CHANGED'));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm departure' }));
  await screen.findByText('coManaged.departure.endError');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel departure' }));
  mocks.load.mockResolvedValue({ ...active, side: 'sponsor', revision: 6 });
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.upgrade.refresh' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'coManaged.departure.review' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.departure.review' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm departure' }));
  await screen.findByText('coManaged.departure.completed');
  expect(mocks.load).toHaveBeenCalledWith('owned-provisioning');
  expect(mocks.end.mock.calls[1][0]).toMatchObject({ provisioningOperationId: 'owned-provisioning', expectedRevision: 6 });
  expect(mocks.end.mock.calls[1][0].operationId).not.toBe(mocks.end.mock.calls[0][0].operationId);
  expect(screen.queryByRole('link', { name: 'coManaged.upgrade.title' })).toBeNull();
});
it('discards stale reads when the tracked session changes', async () => {
  let resolve!: (value: unknown) => void;
  mocks.load.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const view = mount(); mocks.sessionId = 'replacement-session'; mocks.load.mockResolvedValue({ ...active, departed: true });
  view.rerender(<CoManagedFeatureBoundary><CoManagedDeparture /></CoManagedFeatureBoundary>);
  await screen.findByText('coManaged.departure.completed');
  await act(async () => { resolve(active); });
  expect(screen.queryByRole('button', { name: 'coManaged.departure.review' })).toBeNull();
});
it('clears prior review when current authority can no longer be loaded', async () => {
  mount(); await screen.findByRole('button', { name: 'coManaged.departure.review' });
  mocks.load.mockRejectedValue(new Error('Permission denied'));
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.upgrade.refresh' }));
  await screen.findByText('coManaged.departure.loadError');
  expect(screen.queryByRole('button', { name: 'coManaged.departure.review' })).toBeNull();
  expect(screen.queryByText('MSP')).toBeNull();
});
