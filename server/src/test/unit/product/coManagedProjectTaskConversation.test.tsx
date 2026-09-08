/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CoManagedProjectTaskConversation from '../../../components/co-managed/CoManagedProjectTaskConversation';
import { CoManagedFeatureBoundary } from '../../../components/co-managed/CoManagedFeatureBoundary';
const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), flag: vi.fn(), unavailable: vi.fn(), session: { user: { tenant: 'msp', id: 'technician' } } }));
vi.mock('../../../lib/actions/coManagedProjectTaskConversationActions', () => ({ getSharedProjectTaskConversationAction: mocks.load, saveSharedProjectTaskCommentAction: mocks.save }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: mocks.session }) }));
vi.mock('../../../components/co-managed/CoManagedCommentAttachments', () => ({ default: ({ resource, comment }: any) =>
  <div data-testid="task-attachments" data-kind={resource.kind} data-comment={comment.commentId} /> }));
vi.mock('@alga-psa/ui/hooks', () => ({ useFeatureFlag: mocks.flag }));
vi.mock('../../../lib/actions/coManagedAcceptanceActions', () => ({}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string) => key }), useFormatters: () => ({ formatDate: () => 'date' }), useOptionalI18n: () => null }));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: ({ id, label, value, options, disabled, onValueChange }: any) => <label>{label}<select id={id} value={value} disabled={disabled} onChange={event => onValueChange(event.target.value)}>{options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label> }));
vi.mock('next/dynamic', () => ({ default: () => ({ id, label, document, editable, onChange }: any) => label
  ? <label>{label}<textarea id={id} disabled={!editable} value={document.map((block: any) => block.content?.map((part: any) => part.text ?? '').join('') ?? '').join('\n')}
      onChange={event => onChange([{ type: 'paragraph', content: [{ type: 'text', text: event.target.value, styles: {} }] }])} /></label>
  : <div id={id}>{document.map((block: any) => block.content?.map((part: any) => part.text ?? '').join('') ?? '').join('\n')}</div> }));
const resource = { tenant: 'customer', relationshipId: 'relationship', kind: 'project_task' as const, id: 'task' };
const item = () => ({ storeTenant: 'customer', commentId: 'comment', threadId: 'thread', parentCommentId: null, audience: 'shared_it', createdAt: '2026-09-07T12:00:00Z', updatedAt: '2026-09-07T12:00:00Z', deleted: false, revision: 2, canReply: true, note: 'Shared diagnosis', markdown: 'Shared diagnosis', author: { tenant: 'msp', kind: 'user', id: 'technician', displayName: 'Morgan', organizationName: 'Provider IT', referenceId: 'reference' } });
const data = () => ({ resource, actor: { tenant: 'msp', userId: 'technician' }, writeAudiences: ['requester', 'shared_it', 'organization_private'], items: [item()], nextBefore: null });
const mount = () => render(<CoManagedFeatureBoundary><CoManagedProjectTaskConversation resource={resource} onUnavailable={mocks.unavailable} /></CoManagedFeatureBoundary>);
const button = (name: string) => screen.getByRole('button', { name: `coManaged.conversation.${name}` });
const message = () => screen.getByLabelText('coManaged.conversation.message');
beforeEach(() => { vi.resetAllMocks(); mocks.flag.mockReturnValue({ enabled: true, loading: false, error: null }); mocks.session = { user: { tenant: 'msp', id: 'technician' } }; mocks.load.mockResolvedValue(data()); mocks.save.mockResolvedValue({ ok: true, receipt: {} }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

it.each([{ enabled: false }, { enabled: true, loading: true }, { enabled: true, error: new Error('flag unavailable') }])('guards task conversation UI with the release flag: %j', flag => {
  mocks.flag.mockReturnValue(flag); mount(); expect(mocks.load).not.toHaveBeenCalled(); expect(screen.queryByRole('button')).toBeNull();
});
it('shows durable foreign authorship and sends an explicit private audience with a qualified task', async () => {
  mount(); await screen.findByText('Shared diagnosis'); expect(screen.getByText(/Provider IT/)).toBeInTheDocument();
  expect(screen.getByTestId('task-attachments')).toHaveAttribute('data-kind', 'project_task');
  expect(screen.getByTestId('task-attachments')).toHaveAttribute('data-comment', 'comment');
  fireEvent.click(button('new')); fireEvent.change(screen.getByLabelText('coManaged.conversation.audience'), { target: { value: 'organization_private' } });
  fireEvent.change(message(), { target: { value: 'MSP private diagnosis' } }); fireEvent.click(button('send'));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce()); expect(mocks.save.mock.calls[0]).toEqual([resource, { kind: 'create', operationId: expect.any(String), audience: 'organization_private', document: expect.any(Array) }]);
});
it('inherits reply audience and sends the displayed revision for edits and confirmed deletes', async () => {
  mount(); await screen.findByText('Shared diagnosis'); fireEvent.click(button('reply')); expect(screen.queryByRole('combobox')).toBeNull();
  fireEvent.change(message(), { target: { value: 'Reply' } }); fireEvent.click(button('send'));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1)); expect(mocks.save.mock.calls[0][1]).toMatchObject({ kind: 'create', expectedAudience: 'shared_it', parent: { storeTenant: 'customer', threadId: 'thread', commentId: 'comment' } });
  await waitFor(() => expect(button('edit')).toBeInTheDocument()); fireEvent.click(button('edit')); fireEvent.change(message(), { target: { value: 'Edited' } }); fireEvent.click(button('send'));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2)); expect(mocks.save.mock.calls[1][1]).toMatchObject({ kind: 'edit', expectedRevision: 2 });
  await waitFor(() => expect(button('delete')).toBeInTheDocument()); fireEvent.click(button('delete')); expect(mocks.save).toHaveBeenCalledTimes(2); expect(screen.getByText('coManaged.conversation.deleteHelp')).toBeInTheDocument();
  fireEvent.click(button('delete')); await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(3)); expect(mocks.save.mock.calls[2][1]).toMatchObject({ kind: 'delete', expectedRevision: 2 });
});
it('retries a lost response with the same operation and frozen document', async () => {
  mocks.save.mockRejectedValueOnce(new Error('Response lost')); mount(); await screen.findByText('Shared diagnosis'); fireEvent.click(button('new'));
  fireEvent.change(message(), { target: { value: 'Only once' } }); fireEvent.click(button('send')); await screen.findByRole('alert');
  expect(message()).toBeDisabled(); expect(screen.getByRole('combobox')).toBeDisabled(); const request = structuredClone(mocks.save.mock.calls[0]);
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.policy.retry' })); await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2)); expect(mocks.save.mock.calls[1]).toEqual(request);
});
it('requires a reload after a revision conflict and clears the task on access denial', async () => {
  mocks.save.mockResolvedValueOnce({ ok: false, code: 'conflict' }); mount(); await screen.findByText('Shared diagnosis'); fireEvent.click(button('edit'));
  fireEvent.change(message(), { target: { value: 'Concurrent edit' } }); fireEvent.click(button('send')); await screen.findByRole('alert'); expect(button('send')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.ticket.cancel' })); await waitFor(() => expect(button('new')).toBeInTheDocument());
  mocks.save.mockResolvedValueOnce({ ok: false, code: 'forbidden' }); fireEvent.click(button('new')); fireEvent.change(message(), { target: { value: 'Denied' } }); fireEvent.click(button('send'));
  await waitFor(() => expect(mocks.unavailable).toHaveBeenCalledOnce()); expect(screen.queryByText('Shared diagnosis')).toBeNull(); expect(screen.queryByLabelText('coManaged.conversation.message')).toBeNull();
});
it('hides author controls, deleted-root replies, and all read-only composers', async () => {
  mocks.load.mockResolvedValue({ ...data(), items: [{ ...item(), author: undefined, canReply: false }] }); mount(); await screen.findByText('Shared diagnosis');
  for (const name of ['reply', 'edit', 'delete']) expect(screen.queryByRole('button', { name: `coManaged.conversation.${name}` })).toBeNull();
  mocks.load.mockResolvedValue({ ...data(), writeAudiences: [] }); fireEvent.click(screen.getByRole('button', { name: 'coManaged.ticket.reload' }));
  await screen.findByText('coManaged.ticket.readOnly'); expect(screen.queryByRole('button', { name: 'coManaged.conversation.new' })).toBeNull();
});
it('does not restore another customer’s data from a late response', async () => {
  let finish!: (value: any) => void; mocks.load.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); const view = mount();
  const next = { ...resource, tenant: 'second', id: 'other' }; mocks.load.mockResolvedValue({ ...data(), resource: next, items: [{ ...item(), note: 'Second customer' }] });
  view.rerender(<CoManagedFeatureBoundary><CoManagedProjectTaskConversation resource={next} onUnavailable={mocks.unavailable} /></CoManagedFeatureBoundary>);
  await screen.findByText('Second customer'); await act(async () => finish(data())); expect(screen.queryByText('Shared diagnosis')).toBeNull();
});
it('passes exact cursors, clears a failed page and retains no stale composer', async () => {
  const cursor = { createdAt: '2026-09-07T12:00:00.123456Z', storeTenant: 'customer', commentId: 'older' };
  mocks.load.mockResolvedValueOnce({ ...data(), nextBefore: cursor }).mockRejectedValueOnce(new Error('Scope revoked'));
  mount(); await screen.findByText('Shared diagnosis'); fireEvent.click(button('older')); await screen.findByRole('alert');
  expect(mocks.load.mock.calls[1]).toEqual([resource, cursor]); expect(screen.queryByText('Shared diagnosis')).toBeNull(); expect(mocks.unavailable).toHaveBeenCalledOnce();
});
it('rejects a screen returned for a different authenticated identity', async () => {
  mocks.load.mockResolvedValue({ ...data(), actor: { tenant: 'msp', userId: 'another' } }); mount(); await screen.findByRole('alert'); expect(screen.queryByText('Shared diagnosis')).toBeNull();
});

it('clears the active draft and visible messages when periodic access revalidation fails', async () => {
  mount(); await screen.findByText('Shared diagnosis'); fireEvent.click(button('new')); fireEvent.change(message(), { target: { value: 'Unsent private work' } });
  // Re-mount under controlled timers so the effect's interval is deterministic.
  cleanup(); vi.useFakeTimers();
  await act(async () => { mount(); });
  await act(async () => { fireEvent.click(button('new')); });
  await act(async () => { fireEvent.change(message(), { target: { value: 'Unsent private work' } }); });
  mocks.load.mockRejectedValueOnce(new Error('Access revoked'));
  await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
  expect(screen.getByRole('alert')).toBeInTheDocument(); expect(screen.queryByText('Shared diagnosis')).toBeNull(); expect(screen.queryByLabelText('coManaged.conversation.message')).toBeNull(); expect(mocks.unavailable).toHaveBeenCalledOnce();
});
