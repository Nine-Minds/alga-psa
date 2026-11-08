/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), session: { session_id: 'session', user: { tenant: 'customer', id: 'requester', user_type: 'client' } } as any }));
vi.mock('@alga-psa/ui/hooks', async () => ({ useCapability: (await import('../../../../../packages/ui/src/hooks/useCapability')).useCapability }));
vi.mock('@alga-psa/client-portal/components', async () => import('../../../../../packages/client-portal/src/components/projects/RequesterTaskConversation'));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: mocks.session }) }));
vi.mock('@/lib/actions/coManagedRequesterTaskActions', () => ({ getRequesterTaskConversationAction: mocks.load, createRequesterTaskCommentAction: mocks.save, getRequesterSharedTaskIdsAction: vi.fn() }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string, o?: { defaultValue?: string }) => o?.defaultValue ?? key }), useFormatters: () => ({ formatDate: () => 'date' }), useOptionalI18n: () => null }));
vi.mock('@alga-psa/ui/components/Dialog', () => ({ Dialog: ({ isOpen, children, onClose }: any) => isOpen ? <div role="dialog"><button onClick={onClose}>Close</button>{children}</div> : null }));
import { FeatureFlagBootstrapProvider } from '../../../../../packages/ui/src/capability/bootstrapContext';
import { CoManagedRequesterTaskProvider } from '../../../components/co-managed/CoManagedRequesterTaskConversation';
import { RequesterTaskConversation, RequesterSharedTasksProvider } from '../../../../../packages/client-portal/src/components/projects/RequesterTaskConversation';

const target = { projectId: 'project', taskId: 'task' };
// A customer requester is SERVED, never admitted: admission belongs to sponsors.
const served = { 'capability:co-managed': true, 'capability:co-managed:admit': false };
const data = () => ({ target, actor: { tenant: 'customer', userId: 'requester' }, canWrite: true, nextBefore: null, items: [{ commentId: 'comment', threadId: 'thread', parentCommentId: null,
  createdAt: '2026-09-08T12:00:00Z', deleted: false, canReply: true, note: 'Visible request', markdown: null, authorName: 'Morgan', organizationName: 'MSP', authorKind: 'user', isOwn: false }] });
const view = (flags: Record<string, boolean> = served, shared: string[] = ['task']) => <FeatureFlagBootstrapProvider initialFeatureFlags={flags}><CoManagedRequesterTaskProvider><RequesterSharedTasksProvider ids={new Set(shared)}><RequesterTaskConversation {...target} /></RequesterSharedTasksProvider></CoManagedRequesterTaskProvider></FeatureFlagBootstrapProvider>;
const open = () => fireEvent.click(screen.getByRole('button', { name: 'Conversation' }));
beforeEach(() => { window.history.replaceState({}, '', '/'); vi.resetAllMocks(); mocks.session = { session_id: 'session', user: { tenant: 'customer', id: 'requester', user_type: 'client' } }; mocks.load.mockResolvedValue(data()); mocks.save.mockResolvedValue({}); });
afterEach(cleanup);

it('renders nothing and calls no action when the capability does not serve', () => {
  render(view({ 'capability:co-managed': false }));
  expect(screen.queryByRole('button')).toBeNull();
  expect(mocks.load).not.toHaveBeenCalled();
});
it('renders nothing for a non-client session', () => {
  mocks.session = { session_id: 'session', user: { tenant: 'customer', id: 'u', user_type: 'internal' } };
  render(view());
  expect(screen.queryByRole('button')).toBeNull();
});
it('loads on demand, shows requester-visible comments and replies into the same thread', async () => {
  render(view()); expect(mocks.load).not.toHaveBeenCalled(); open(); await screen.findByText('Visible request');
  expect(mocks.load).toHaveBeenCalledWith(target, undefined);
  fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Thanks' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  expect(mocks.save.mock.calls[0]).toEqual([target, { operationId: expect.any(String), text: 'Thanks', parent: { threadId: 'thread', commentId: 'comment' } }]);
});
it('freezes the original operation and text after an uncertain save and retries it exactly', async () => {
  mocks.save.mockRejectedValueOnce(new Error('Lost response')); render(view()); open(); await screen.findByText('Visible request');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Once' } }); fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await screen.findByText(/could not confirm the save/); await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).not.toBeDisabled());
  expect(screen.getByRole('textbox')).toBeDisabled();
  const original = structuredClone(mocks.save.mock.calls[0]); fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2)); expect(mocks.save.mock.calls[1]).toEqual(original);
});
it('clears content on an access failure and never exposes a read-only composer', async () => {
  mocks.load.mockResolvedValue({ ...data(), canWrite: false, items: [{ ...data().items[0], canReply: false }] }); render(view()); open(); await screen.findByText('Visible request');
  expect(screen.queryByRole('textbox')).toBeNull(); expect(screen.queryByRole('button', { name: 'Reply' })).toBeNull();
  mocks.load.mockRejectedValue(new Error('Revoked')); fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
  await screen.findByRole('alert'); expect(screen.queryByText('Visible request')).toBeNull();
});
it('ignores late responses when the tracked requester session changes', async () => {
  let finish!: (value: any) => void; mocks.load.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); const rendered = render(view()); open();
  await waitFor(() => expect(mocks.load).toHaveBeenCalledOnce());
  mocks.session = { ...mocks.session, session_id: 'new-session' }; mocks.load.mockResolvedValue({ ...data(), items: [] });
  rendered.rerender(view()); await screen.findByText('No comments yet.'); await act(async () => finish(data()));
  expect(screen.queryByText('Visible request')).toBeNull();
});
it('opens only the email-linked task and respects closing its dialog', async () => {
  window.history.replaceState({}, '', '/client-portal/projects/project?taskId=task');
  const content = () => <FeatureFlagBootstrapProvider initialFeatureFlags={served}><CoManagedRequesterTaskProvider><RequesterSharedTasksProvider ids={new Set(['task', 'other'])}><RequesterTaskConversation {...target} /><RequesterTaskConversation projectId="project" taskId="other" /></RequesterSharedTasksProvider></CoManagedRequesterTaskProvider></FeatureFlagBootstrapProvider>;
  const rendered = render(content()); await screen.findByText('Visible request');
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(mocks.load).toHaveBeenCalledExactlyOnceWith(target, undefined);
  fireEvent.click(screen.getByRole('button', { name: 'Close' })); rendered.rerender(content());
  expect(screen.queryByRole('dialog')).toBeNull(); expect(mocks.load).toHaveBeenCalledOnce();
});
it('does not open an email-linked conversation while the capability does not serve', () => {
  window.history.replaceState({}, '', '/client-portal/projects/project?taskId=task');
  render(view({ 'capability:co-managed': false, 'capability:co-managed:admit': false }));
  expect(screen.queryByRole('dialog')).toBeNull(); expect(mocks.load).not.toHaveBeenCalled();
});
it('does not open an email-linked conversation for a task that is not shared work (a sponsor native project)', () => {
  window.history.replaceState({}, '', '/client-portal/projects/project?taskId=task');
  render(view(served, []));
  expect(screen.queryByRole('button')).toBeNull(); expect(screen.queryByRole('dialog')).toBeNull(); expect(mocks.load).not.toHaveBeenCalled();
});
