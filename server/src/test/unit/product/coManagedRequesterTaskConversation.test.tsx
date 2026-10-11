/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), flag: vi.fn(), session: { session_id: 'session', user: { tenant: 'customer', id: 'requester', user_type: 'client' } } }));
vi.mock('@alga-psa/client-portal/components', async () => import('../../../../../packages/client-portal/src/components/projects/RequesterTaskConversation'));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: mocks.session }) }));
vi.mock('@alga-psa/ui/hooks', () => ({ useFeatureFlag: mocks.flag }));
vi.mock('../../../lib/actions/coManagedAcceptanceActions', () => ({}));
vi.mock('../../../lib/actions/coManagedRequesterTaskActions', () => ({ getRequesterTaskConversationAction: mocks.load, createRequesterTaskCommentAction: mocks.save }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string) => key }), useFormatters: () => ({ formatDate: () => 'date' }), useOptionalI18n: () => null }));
vi.mock('@alga-psa/ui/components/Dialog', () => ({ Dialog: ({ isOpen, children, onClose }: any) => isOpen ? <div role="dialog"><button onClick={onClose}>Close</button>{children}</div> : null }));
import { CoManagedRequesterTaskProvider } from '../../../components/co-managed/CoManagedRequesterTaskConversation';
import { RequesterTaskConversation } from '../../../../../packages/client-portal/src/components/projects/RequesterTaskConversation';
const target = { projectId: 'project', taskId: 'task' };
const data = () => ({ target, actor: { tenant: 'customer', userId: 'requester' }, canWrite: true, nextBefore: null, items: [{ commentId: 'comment', threadId: 'thread', parentCommentId: null,
  createdAt: '2026-09-08T12:00:00Z', deleted: false, canReply: true, note: 'Visible request', markdown: null, authorName: 'Morgan', organizationName: 'MSP',
  attachments: [{ attachmentId: 'file', fileName: '<report>.txt' }] }] });
const view = () => <CoManagedRequesterTaskProvider><RequesterTaskConversation {...target} /></CoManagedRequesterTaskProvider>;
const open = () => fireEvent.click(screen.getByRole('button', { name: 'coManaged.conversation.title' }));
beforeEach(() => { window.history.replaceState({}, '', '/'); vi.resetAllMocks(); mocks.flag.mockReturnValue({ enabled: true }); mocks.session = { session_id: 'session', user: { tenant: 'customer', id: 'requester', user_type: 'client' } }; mocks.load.mockResolvedValue(data()); mocks.save.mockResolvedValue({}); });
afterEach(cleanup);
it.each([{ enabled: false }, { enabled: true, loading: true }, { enabled: true, error: true }])('gates requester task UI before action calls: %j', flag => {
  mocks.flag.mockReturnValue(flag); render(view()); expect(screen.queryByRole('button')).toBeNull(); expect(mocks.load).not.toHaveBeenCalled();
});
it('loads on demand and uses actual project/task identity for requester downloads and replies', async () => {
  render(view()); expect(mocks.load).not.toHaveBeenCalled(); open(); await screen.findByText('Visible request');
  expect(mocks.load).toHaveBeenCalledWith(target, undefined);
  const link = screen.getByRole('link', { name: '<report>.txt' });
  expect(Object.fromEntries(new URL(link.getAttribute('href')!, 'https://alga.test').searchParams)).toEqual({ ...target, threadId: 'thread', commentId: 'comment' });
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.conversation.reply' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Thanks' } });
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.conversation.send' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  expect(mocks.save.mock.calls[0]).toEqual([target, { operationId: expect.any(String), text: 'Thanks', parent: { threadId: 'thread', commentId: 'comment' } }]);
});
it('freezes the original operation and text after an uncertain save and retries it exactly', async () => {
  mocks.save.mockRejectedValueOnce(new Error('Lost response')); render(view()); open(); await screen.findByText('Visible request');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Once' } }); fireEvent.click(screen.getByRole('button', { name: 'coManaged.conversation.send' }));
  await screen.findByText('coManaged.conversation.unknownOutcome'); await waitFor(() => expect(screen.getByRole('button', { name: 'coManaged.conversation.send' })).not.toBeDisabled());
  expect(screen.getByRole('textbox')).toBeDisabled();
  const original = structuredClone(mocks.save.mock.calls[0]); fireEvent.click(screen.getByRole('button', { name: 'coManaged.conversation.send' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2)); expect(mocks.save.mock.calls[1]).toEqual(original);
});
it('clears content on an access failure and never exposes a read-only composer', async () => {
  mocks.load.mockResolvedValue({ ...data(), canWrite: false, items: [{ ...data().items[0], canReply: false }] }); render(view()); open(); await screen.findByText('Visible request');
  expect(screen.queryByRole('textbox')).toBeNull(); expect(screen.queryByRole('button', { name: 'coManaged.conversation.reply' })).toBeNull();
  mocks.load.mockRejectedValue(new Error('Revoked')); fireEvent.click(screen.getByRole('button', { name: 'coManaged.ticket.reload' }));
  await screen.findByRole('alert'); expect(screen.queryByText('Visible request')).toBeNull(); expect(screen.queryByRole('link')).toBeNull();
});
it('ignores late responses when the tracked requester session changes', async () => {
  let finish!: (value: any) => void; mocks.load.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); const rendered = render(view()); open();
  await waitFor(() => expect(mocks.load).toHaveBeenCalledOnce());
  mocks.session = { ...mocks.session, session_id: 'new-session' }; mocks.load.mockResolvedValue({ ...data(), items: [] });
  rendered.rerender(view()); await screen.findByText('coManaged.conversation.empty'); await act(async () => finish(data()));
  expect(screen.queryByText('Visible request')).toBeNull();
});
it('opens only the email-linked task and respects closing its dialog', async () => {
  window.history.replaceState({}, '', '/client-portal/projects/project?taskId=task');
  const content = () => <CoManagedRequesterTaskProvider><RequesterTaskConversation {...target} /><RequesterTaskConversation projectId="project" taskId="other" /></CoManagedRequesterTaskProvider>;
  const rendered = render(content()); await screen.findByText('Visible request');
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(mocks.load).toHaveBeenCalledExactlyOnceWith(target, undefined);
  fireEvent.click(screen.getByRole('button', { name: 'Close' })); rendered.rerender(content());
  expect(screen.queryByRole('dialog')).toBeNull(); expect(mocks.load).toHaveBeenCalledOnce();
});
it('does not open an email-linked conversation while the feature is hidden', () => {
  window.history.replaceState({}, '', '/client-portal/projects/project?taskId=task');
  mocks.flag.mockReturnValue({ enabled: false }); render(view());
  expect(screen.queryByRole('dialog')).toBeNull(); expect(mocks.load).not.toHaveBeenCalled();
});
