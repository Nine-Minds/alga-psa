/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CoManagedTimeEntry from '../../../components/co-managed/CoManagedTimeEntry';
vi.mock('../../../components/co-managed/CoManagedTimeBillingProfile', () => ({ default: () => null }));
const mocks = vi.hoisted(() => ({ cap: vi.fn(), resolve: vi.fn(), launch: vi.fn(), openDrawer: vi.fn(), closeDrawer: vi.fn() }));
vi.mock('@alga-psa/ui/hooks', () => ({ useCapability: mocks.cap }));
vi.mock('next-auth/react', () => ({ useSession: vi.fn(), signOut: vi.fn() }));
vi.mock('../../../lib/actions/coManagedAcceptanceActions', () => ({}));
vi.mock('../../../lib/actions/coManagedTimeActions', () => ({ resolveTimeWorkItemAction: mocks.resolve }));
// The standard time-entry launcher owns the form and saving; this screen only resolves the work item and hosts the button.
vi.mock('@alga-psa/scheduling/lib/timeEntryLauncher', () => ({ launchTimeEntryForWorkItem: mocks.launch }));
vi.mock('@alga-psa/ui', () => ({ useDrawer: () => ({ openDrawer: mocks.openDrawer, closeDrawer: mocks.closeDrawer }) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string) => key }), useOptionalI18n: () => null }));
const resource = { tenant: 'customer-a', relationshipId: 'relationship-a', kind: 'ticket' as const, id: 'ticket-a' };
const mount = () => render(<CoManagedTimeEntry resource={resource} canWrite />);
const open = () => fireEvent.click(screen.getByRole('button', { name: 'time.log' }));
beforeEach(() => {
  vi.resetAllMocks(); mocks.cap.mockReturnValue({ enabled: true, admitted: true, resolved: true });
  mocks.resolve.mockResolvedValue({ workItemType: 'co_managed', workItemId: 'local-reference', workItemName: 'Customer A issue' });
  mocks.launch.mockResolvedValue(undefined);
});
afterEach(cleanup);
it.each([{ enabled: false, admitted: false, resolved: true }, { enabled: false, admitted: false, resolved: false }])('hides shared time UI and resolves nothing when the workspace does not serve co-managed: %j', cap => {
  mocks.cap.mockReturnValue(cap); mount(); expect(screen.queryByRole('button')).toBeNull(); expect(mocks.resolve).not.toHaveBeenCalled();
});
it('launches the standard form with the qualified resource and its co_managed work item', async () => {
  mount(); open(); await waitFor(() => expect(mocks.launch).toHaveBeenCalledTimes(1));
  expect(mocks.resolve).toHaveBeenCalledWith(resource);
  expect(mocks.launch.mock.calls[0][0].context).toMatchObject({ workItemType: 'co_managed', workItemId: 'local-reference', workItemName: 'Customer A issue' });
});
it('reports a denied resolution without launching a time form', async () => {
  mocks.resolve.mockRejectedValue(new Error('revoked')); mount(); open();
  await screen.findByRole('alert'); expect(mocks.launch).not.toHaveBeenCalled();
});
it.each(['ticket', 'project_task'])('launches customer-owned %s with the server-admitted native identity (the provider records it as operational)', async workItemType => {
  mocks.resolve.mockResolvedValue({ workItemType, workItemId: 'owned-work', workItemName: 'Customer operational work' });
  mount(); open(); await waitFor(() => expect(mocks.launch).toHaveBeenCalled());
  expect(mocks.launch.mock.calls[0][0].context).toMatchObject({ workItemType, workItemId: 'owned-work' });
});
it('does not launch a late resolution after qualified navigation, and renders nothing without write authority', async () => {
  let resolve!: (value: any) => void; mocks.resolve.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const view = mount(); open(); await waitFor(() => expect(mocks.resolve).toHaveBeenCalledTimes(1));
  view.rerender(<CoManagedTimeEntry resource={{ ...resource, tenant: 'customer-b', id: 'ticket-b' }} canWrite />);
  await act(async () => resolve({ workItemType: 'co_managed', workItemId: 'late', workItemName: 'late' }));
  expect(mocks.launch).not.toHaveBeenCalled();
  view.rerender(<CoManagedTimeEntry resource={resource} canWrite={false} />); expect(screen.queryByRole('button')).toBeNull();
});
it('reports a completed save to the mounted work screen, and not after unmount', async () => {
  const onSaved = vi.fn(), view = render(<CoManagedTimeEntry resource={resource} canWrite onSaved={onSaved} />);
  open(); await waitFor(() => expect(mocks.launch).toHaveBeenCalled()); const complete = mocks.launch.mock.calls[0][0].onComplete;
  expect(onSaved).not.toHaveBeenCalled(); act(() => complete()); expect(onSaved).toHaveBeenCalledTimes(1);
  view.unmount(); complete(); expect(onSaved).toHaveBeenCalledTimes(1);
});
