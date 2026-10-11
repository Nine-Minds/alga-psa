/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CoManagedEffort from '../../../components/co-managed/CoManagedEffort';

const mocks = vi.hoisted(() => ({ flag: vi.fn(), load: vi.fn(), session: vi.fn() }));
vi.mock('next-auth/react', () => ({ useSession: mocks.session }));
vi.mock('@alga-psa/ui/hooks', () => ({ useFeatureFlag: mocks.flag }));
vi.mock('../../../lib/actions/coManagedAcceptanceActions', () => ({}));
vi.mock('../../../lib/actions/coManagedTimeActions', () => ({ getSharedEffortTotalsAction: mocks.load }));
vi.mock('@alga-psa/ui/ui-reflection/useAutomationIdAndRegister', () => ({ useAutomationIdAndRegister: ({ id }: any) => ({ automationIdProps: { id }, updateMetadata: () => {}, updateActions: () => {} }) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string, values?: any) => values ? `${values.value} hours` : key }),
  useOptionalI18n: () => null, useFormatters: () => ({ formatNumber: (value: number) => String(value) }) }));
const resource = { tenant: 'customer-a', relationshipId: 'relationship-a', kind: 'ticket' as const, id: 'ticket-a' };
const target = { kind: 'shared' as const, resource };
const totals = { resource, customerMinutes: 30, mspMinutes: 60, combinedMinutes: 90 };
beforeEach(() => { vi.resetAllMocks(); mocks.session.mockReturnValue({ status: 'authenticated', data: { user: { id: 'user-a', tenant: 'home-a' } } }); mocks.flag.mockReturnValue({ enabled: true }); mocks.load.mockResolvedValue(totals); });
afterEach(cleanup);

it.each([{ enabled: false }, { enabled: true, loading: true }, { enabled: true, error: new Error('flag') }])('does not fetch effort while the UI flag is unavailable: %j', flag => {
  mocks.flag.mockReturnValue(flag); render(<CoManagedEffort target={target} />);
  expect(screen.queryByRole('region')).toBeNull(); expect(mocks.load).not.toHaveBeenCalled();
});
it('renders organization totals and refreshes after a successful save signal', async () => {
  const view = render(<CoManagedEffort target={target} refreshKey={0} />);
  await screen.findByText('1.5 hours'); expect(screen.getByText('0.5 hours')).toBeInTheDocument();
  expect(mocks.load).toHaveBeenCalledWith(target);
  mocks.load.mockResolvedValue({ ...totals, mspMinutes: 90, combinedMinutes: 120 });
  view.rerender(<CoManagedEffort target={target} refreshKey={1} />);
  await screen.findByText('2 hours'); expect(mocks.load).toHaveBeenCalledTimes(2);
});
it('distinguishes hidden values from zero and removes old totals on a denied refresh', async () => {
  mocks.load.mockResolvedValue({ ...totals, customerMinutes: 0, mspMinutes: null, combinedMinutes: null });
  render(<CoManagedEffort target={target} />); await screen.findByText('0 hours');
  expect(screen.getAllByText('coManaged.effort.unavailable')).toHaveLength(2);
  mocks.load.mockRejectedValue(new Error('revoked')); fireEvent.click(screen.getByRole('button'));
  await screen.findByRole('alert'); expect(screen.queryByText('0 hours')).toBeNull();
});
it('discards a previous customer response after navigation and unmounts when the flag turns off', async () => {
  let resolve!: (value: any) => void;
  mocks.load.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const view = render(<CoManagedEffort target={target} />);
  await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(1));
  mocks.load.mockResolvedValue({ ...totals, customerMinutes: 0, mspMinutes: 0, combinedMinutes: 0 });
  const next = { ...target, resource: { ...resource, tenant: 'customer-b' } };
  view.rerender(<CoManagedEffort target={next} />); await screen.findAllByText('0 hours');
  await act(async () => resolve(totals)); expect(screen.queryByText('1.5 hours')).toBeNull();
  mocks.flag.mockReturnValue({ enabled: false }); view.rerender(<CoManagedEffort target={next} />);
  expect(screen.queryByRole('region')).toBeNull();
});
it('keeps project and task refresh controls distinct without submitting an enclosing task form', async () => {
  const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
  render(<form onSubmit={submit}>
    <CoManagedEffort target={{ kind: 'local_project', projectId: 'project-a' }} />
    <CoManagedEffort target={{ kind: 'local_task', taskId: 'task-a' }} />
  </form>);
  await screen.findAllByText('1.5 hours');
  const buttons = screen.getAllByRole('button'); expect(new Set(buttons.map(button => button.id)).size).toBe(2);
  fireEvent.click(buttons[1]); expect(submit).not.toHaveBeenCalled();
  await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(3));
});

it('clears previous local effort on a home-session change even when task IDs collide', async () => {
  const local = { kind: 'local_task' as const, taskId: 'same-task-id' };
  const view = render(<CoManagedEffort target={local} />); await screen.findByText('1.5 hours');
  mocks.session.mockReturnValue({ status: 'authenticated', data: { user: { id: 'user-b', tenant: 'home-b' } } });
  mocks.load.mockResolvedValue({ ...totals, customerMinutes: 0, mspMinutes: 0, combinedMinutes: 0 });
  view.rerender(<CoManagedEffort target={local} />);
  expect(screen.queryByText('1.5 hours')).toBeNull(); await screen.findAllByText('0 hours');
  mocks.session.mockReturnValue({ status: 'loading', data: null });
  view.rerender(<CoManagedEffort target={local} />); expect(screen.queryByRole('region')).toBeNull();
});
