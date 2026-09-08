/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CoManagedTimeEntry from '../../../components/co-managed/CoManagedTimeEntry';
const mocks = vi.hoisted(() => ({ flag: vi.fn(), register: vi.fn(), prepare: vi.fn(), save: vi.fn(), dialog: vi.fn() }));
vi.mock('@alga-psa/ui/hooks', () => ({ useFeatureFlag: mocks.flag }));
vi.mock('../../../lib/actions/coManagedAcceptanceActions', () => ({}));
vi.mock('../../../lib/actions/coManagedTimeActions', () => ({ registerSharedTimeWorkAction: mocks.register }));
vi.mock('@alga-psa/scheduling/lib/timeEntryLauncher', () => ({ prepareTimeEntryForWorkItem: mocks.prepare,
  TimeEntryDialog: (props: any) => { mocks.dialog(props); return <div role="dialog">{props.workItem.name}<button onClick={props.onClose}>Close time</button></div>; } }));
vi.mock('@alga-psa/scheduling/actions/timeEntryActions', () => ({ saveTimeEntry: mocks.save }));
vi.mock('@alga-psa/ui/ui-reflection/useAutomationIdAndRegister', () => ({ useAutomationIdAndRegister: ({ id }: any) => ({ automationIdProps: { id }, updateMetadata: () => {}, updateActions: () => {} }) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string) => key }), useOptionalI18n: () => null }));
const resource = { tenant: 'customer-a', relationshipId: 'relationship-a', kind: 'ticket' as const, id: 'ticket-a' };
const prepared = { workItem: { type: 'co_managed', work_item_id: 'local-reference', name: 'Customer A issue' }, timeSheetId: 'home-sheet', timePeriod: { period_id: 'home-period' }, date: new Date() };
const mount = () => render(<CoManagedTimeEntry resource={resource} canWrite />);
const open = () => fireEvent.click(screen.getByRole('button', { name: 'coManaged.time.log' }));
beforeEach(() => {
  vi.resetAllMocks(); mocks.flag.mockReturnValue({ enabled: true, loading: false, error: null });
  mocks.register.mockResolvedValue({ referenceId: 'local-reference', resource, title: 'Customer A issue' });
  mocks.prepare.mockResolvedValue(prepared); mocks.save.mockResolvedValue({ entry_id: 'saved' });
});
afterEach(cleanup);
it.each([{ enabled: false }, { enabled: undefined }, { enabled: true, loading: true }, { enabled: true, error: new Error('flag failed') }])('hides shared time UI and avoids preparation when the flag is unavailable: %j', flag => {
  mocks.flag.mockReturnValue(flag); mount(); expect(screen.queryByRole('button')).toBeNull(); expect(mocks.register).not.toHaveBeenCalled();
});
it('opens the normal form using the qualified resource and its local time identity', async () => {
  mount(); open(); await screen.findByRole('dialog');
  expect(mocks.register).toHaveBeenCalledWith(resource);
  expect(mocks.prepare).toHaveBeenCalledWith({ workItemType: 'co_managed', workItemId: 'local-reference', workItemName: 'Customer A issue' });
  expect(mocks.dialog.mock.lastCall?.[0]).toMatchObject({ timeSheetId: 'home-sheet', isEditable: true });
  expect(mocks.dialog.mock.lastCall?.[0].inDrawer).toBeUndefined();
  fireEvent.click(screen.getByText('Close time')); expect(screen.queryByRole('dialog')).toBeNull();
});
it('preserves save failures for the native form instead of reporting success', async () => {
  mount(); open(); await screen.findByRole('dialog');
  const input = { work_item_type: 'co_managed', work_item_id: 'local-reference', service_id: 'home-service' };
  const onSave = mocks.dialog.mock.lastCall![0].onSave;
  mocks.save.mockRejectedValueOnce(new Error('Access changed'));
  await expect(onSave(input)).rejects.toThrow('Access changed'); expect(screen.getByRole('dialog')).toBeInTheDocument();
  await onSave(input); expect(mocks.save).toHaveBeenLastCalledWith(input);
});
it('reports denied registration without opening or preparing a time form', async () => {
  mocks.register.mockRejectedValue(new Error('revoked')); mount(); open();
  await screen.findByRole('alert'); expect(mocks.prepare).not.toHaveBeenCalled(); expect(screen.queryByRole('dialog')).toBeNull();
});
it('discards late preparation after qualified navigation and clears an open form on access loss', async () => {
  let resolve!: (value: any) => void; mocks.prepare.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const view = mount(); open(); await waitFor(() => expect(mocks.prepare).toHaveBeenCalledTimes(1));
  view.rerender(<CoManagedTimeEntry resource={{ ...resource, tenant: 'customer-b', id: 'ticket-b' }} canWrite />);
  await act(async () => resolve(prepared)); expect(screen.queryByRole('dialog')).toBeNull();
  open(); await screen.findByRole('dialog');
  view.rerender(<CoManagedTimeEntry resource={{ ...resource, tenant: 'customer-b', id: 'ticket-b' }} canWrite={false} />);
  expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.queryByRole('button')).toBeNull();
});
it('unmounts an open form when the release flag is disabled', async () => {
  const view = mount(); open(); await screen.findByRole('dialog'); mocks.flag.mockReturnValue({ enabled: false });
  view.rerender(<CoManagedTimeEntry resource={resource} canWrite />); expect(screen.queryByRole('dialog')).toBeNull();
});
