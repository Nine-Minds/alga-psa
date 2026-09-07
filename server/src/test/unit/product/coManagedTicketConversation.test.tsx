/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CoManagedTicketConversation from '../../../components/co-managed/CoManagedTicketConversation';
import { CoManagedFeatureBoundary } from '../../../components/co-managed/CoManagedFeatureBoundary';
const mocks = vi.hoisted(() => ({ flag: vi.fn(), load: vi.fn(), create: vi.fn(), mutate: vi.fn(), private: vi.fn(), prepare: vi.fn(), submitDraft: vi.fn(), abandon: vi.fn(), preview: vi.fn(), disclose: vi.fn(),
  session: { user: { tenant: 'msp', id: 'technician' } } }));
vi.mock('../../../lib/actions/coManagedThreadDisclosureActions', () => ({ previewCoManagedThreadDisclosureAction: mocks.preview, discloseCoManagedThreadAction: mocks.disclose }));
vi.mock('../../../components/co-managed/CoManagedCommentAttachments', () => ({ default: () => null }));
vi.mock('../../../components/co-managed/conversationDraftSubmission', () => ({ prepareConversationDraft: mocks.prepare, submitConversationDraft: mocks.submitDraft }));
vi.mock('../../../lib/actions/coManagedConversationDraftActions', () => ({ abandonCoManagedConversationDraftAction: mocks.abandon }));
vi.mock('next/dynamic', () => ({ default: () => ({ id, label, document, editable, onChange }: any) => label
  ? <label>{label}<textarea id={id} disabled={!editable} value={document.map((block: any) => block.content?.map((part: any) => part.text ?? '').join('') ?? '').join('\n')}
      onChange={event => onChange([{ type: 'paragraph', content: [{ type: 'text', text: event.target.value, styles: {} }] }])} /></label>
  : <div id={id}>{document.map((block: any) => block.content?.map((part: any) => part.text ?? '').join('') ?? '').join('\n')}</div> }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: mocks.session }) }));
vi.mock('@alga-psa/ui/hooks', () => ({ useFeatureFlag: mocks.flag }));
vi.mock('../../../lib/actions/coManagedAcceptanceActions', () => ({}));
vi.mock('../../../lib/actions/coManagedTicketConversationActions', () => ({ getCoManagedTicketConversationScreenAction: mocks.load }));
vi.mock('../../../lib/actions/coManagedTicketCommentActions', () => ({ createCoManagedTicketCommentAction: mocks.create }));
vi.mock('../../../lib/actions/coManagedTicketCommentMutationActions', () => ({ mutateCoManagedTicketCommentAction: mocks.mutate }));
vi.mock('../../../lib/actions/coManagedPrivateTicketCommentActions', () => ({ saveCoManagedPrivateTicketCommentAction: mocks.private }));
vi.mock('@alga-psa/ui/ui-reflection/useAutomationIdAndRegister', () => ({ useAutomationIdAndRegister: ({ id }: any) => ({ automationIdProps: { id }, updateMetadata: () => {}, updateActions: () => {} }) }));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: ({ id, label, value, disabled, options, onValueChange }: any) =>
  <label>{label}<select id={id} value={value} disabled={disabled} onChange={event => onValueChange(event.target.value)}>{options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label> }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string) => key }), useFormatters: () => ({ formatDate: (date: Date) => date.toISOString(), formatNumber: (value: number) => String(value) }), useOptionalI18n: () => null }));
const resource = { tenant: 'customer', relationshipId: 'relationship', kind: 'ticket' as const, id: 'ticket' };
const note = (text: string) => JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text, styles: {} }] }]);
const item = () => ({ storeTenant: 'customer', commentId: 'comment', threadId: 'thread', parentCommentId: null, audience: 'shared_it',
  createdAt: '2026-01-01T00:00:00.123456Z', updatedAt: '2026-01-01T00:00:00.654321Z', deleted: false, revision: null, note: note('Shared content'), markdown: 'Shared content',
  author: { tenant: 'msp', kind: 'user', id: 'technician', displayName: 'Morgan', organizationName: 'Provider IT', referenceId: 'reference' } });
const data = () => ({ resource, actor: { tenant: 'msp', userId: 'technician' }, writeAudiences: ['requester', 'shared_it', 'organization_private'], draftAttachments: { audiences: ['requester', 'shared_it', 'organization_private'], maxBytes: 100, maxFiles: 2 }, items: [item()], nextBefore: null });
const mount = () => render(<CoManagedFeatureBoundary><CoManagedTicketConversation resource={resource} /></CoManagedFeatureBoundary>);
const button = (name: string) => screen.getByRole('button', { name: `coManaged.conversation.${name}` });
const message = () => screen.getByLabelText('coManaged.conversation.message');
const deferred = () => { let resolve!: (value: any) => void; const promise = new Promise<any>(done => { resolve = done; }); return { promise, resolve }; };
beforeEach(() => {
  vi.resetAllMocks(); mocks.session = { user: { tenant: 'msp', id: 'technician' } };
  mocks.flag.mockReturnValue({ enabled: true, loading: false, error: null }); mocks.load.mockResolvedValue(data());
  mocks.prepare.mockImplementation(async input => ({ resource: input.resource, storeTenant: input.resource.tenant, request: { operationId: input.operationId }, files: input.files }));
  mocks.submitDraft.mockResolvedValue({ ok: true, receipt: {} });
  mocks.preview.mockResolvedValue({ actor: data().actor, preview: { storeTenant: 'customer', threadId: 'thread', audience: 'shared_it', snapshot: 'a'.repeat(64), comments: 2, attachments: 1, pendingAttachments: 0 } });
  mocks.disclose.mockImplementation(async (_resource, request) => ({ ok: true, receipt: { storeTenant: request.storeTenant, threadId: request.threadId, operationId: request.operationId, audience: request.audience, appliedAt: '2026-09-07T00:00:00.000Z' } }));
  mocks.abandon.mockResolvedValue({ ok: true, result: { status: 'abandoned' } });
  for (const action of [mocks.create, mocks.mutate, mocks.private]) action.mockResolvedValue({ ok: true, receipt: {} });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('keeps conversation reads and controls behind the UI release flag', () => {
  mocks.flag.mockReturnValue({ enabled: false, loading: false, error: null }); mount();
  expect(mocks.load).not.toHaveBeenCalled(); expect(screen.queryByRole('button')).toBeNull();
});
it('shows qualified authors and routes a new MSP-private note to the home store', async () => {
  mount(); await screen.findByText('Shared content'); expect(screen.getByText('Morgan')).toBeInTheDocument(); expect(screen.getByText(/Provider IT/)).toBeInTheDocument();
  fireEvent.click(button('new')); fireEvent.change(screen.getByLabelText('coManaged.conversation.audience'), { target: { value: 'organization_private' } });
  fireEvent.change(message(), { target: { value: 'MSP private note' } }); fireEvent.click(button('send'));
  await waitFor(() => expect(mocks.private).toHaveBeenCalledOnce());
  expect(mocks.private).toHaveBeenCalledWith(resource, { kind: 'create', document: expect.any(Array), operationId: expect.any(String) }); expect(mocks.create).not.toHaveBeenCalled();
});
it('inherits reply audience and sends the exact original version for an own-author edit', async () => {
  mount(); await screen.findByText('Shared content'); fireEvent.click(button('reply'));
  expect(screen.queryByRole('combobox')).toBeNull(); fireEvent.change(message(), { target: { value: 'Inherited reply' } }); fireEvent.click(button('send'));
  await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
  expect(mocks.create).toHaveBeenCalledWith(resource, { operationId: expect.any(String), document: expect.any(Array), parent: { storeTenant: 'customer', threadId: 'thread', commentId: 'comment' }, expectedAudience: 'shared_it' });
  await waitFor(() => expect(button('edit')).toBeInTheDocument()); fireEvent.click(button('edit')); fireEvent.change(message(), { target: { value: 'Edited' } }); fireEvent.click(button('send'));
  await waitFor(() => expect(mocks.mutate).toHaveBeenCalledOnce()); expect(mocks.mutate.mock.calls[0][1]).toMatchObject({ kind: 'edit', document: expect.any(Array), expectedUpdatedAt: item().updatedAt });
});
it('confirms private deletion with its revision', async () => {
  const row = { ...item(), storeTenant: 'msp', audience: 'organization_private', revision: 3 };
  mocks.load.mockResolvedValue({ ...data(), items: [row] }); mount(); await screen.findByText('Shared content');
  fireEvent.click(button('delete')); expect(mocks.private).not.toHaveBeenCalled(); expect(screen.getByText('coManaged.conversation.deleteHelp')).toBeInTheDocument();
  fireEvent.click(button('delete')); await waitFor(() => expect(mocks.private).toHaveBeenCalledOnce());
  expect(mocks.private.mock.calls[0][1]).toMatchObject({ kind: 'delete', expectedRevision: 3, comment: { storeTenant: 'msp', threadId: 'thread', commentId: 'comment' } });
});
it('freezes an uncertain submission and retries the identical operation', async () => {
  mocks.create.mockRejectedValueOnce(new Error('Response lost'));
  mount(); await screen.findByText('Shared content'); fireEvent.click(button('new')); fireEvent.change(message(), { target: { value: 'One message' } }); fireEvent.click(button('send'));
  await screen.findByText('coManaged.conversation.unknownOutcome'); const first = mocks.create.mock.calls[0];
  expect(message()).toBeDisabled(); expect(screen.getByRole('button', { name: 'coManaged.ticket.cancel' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.ticket.retry' })); await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
  expect(mocks.create.mock.calls[1]).toEqual(first);
});
it('pages with qualified cursors and removes old content on access-refresh failure', async () => {
  const cursor = { createdAt: item().createdAt, storeTenant: 'customer', commentId: 'comment' };
  mocks.load.mockResolvedValueOnce({ ...data(), nextBefore: cursor }); mount(); await screen.findByText('Shared content');
  mocks.load.mockResolvedValue({ ...data(), items: [{ ...item(), commentId: 'older', note: note('Older content') }] }); fireEvent.click(button('older'));
  await screen.findByText('Older content'); expect(screen.queryByText('Shared content')).toBeNull(); expect(mocks.load.mock.calls.at(-1)).toEqual([resource, cursor]);
  mocks.load.mockRejectedValue(new Error('Revoked')); fireEvent.click(screen.getByRole('button', { name: 'coManaged.ticket.reload' }));
  await screen.findByText('coManaged.conversation.loadError'); expect(screen.queryByText('Older content')).toBeNull();
});
it('ignores late content from a previous home identity', async () => {
  const pending = deferred(); mocks.load.mockReturnValueOnce(pending.promise); const view = mount();
  mocks.session = { user: { tenant: 'msp', id: 'other' } }; mocks.load.mockResolvedValue({ ...data(), actor: { tenant: 'msp', userId: 'other' }, items: [] });
  view.rerender(<CoManagedFeatureBoundary><CoManagedTicketConversation resource={resource} /></CoManagedFeatureBoundary>);
  await screen.findByText('coManaged.conversation.empty'); await act(async () => pending.resolve(data())); expect(screen.queryByText('Shared content')).toBeNull();
});

it('retains reads without write controls', async () => {
  mocks.load.mockResolvedValue({ ...data(), writeAudiences: [], items: [{ ...item(), author: { ...item().author, tenant: 'customer' } }] });
  mount(); await screen.findByText('Shared content');
  expect(screen.queryByRole('button', { name: 'coManaged.conversation.new' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'coManaged.conversation.edit' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'coManaged.conversation.delete' })).toBeNull();
});
it('loads after development StrictMode remounts effects', async () => {
  render(<React.StrictMode><CoManagedTicketConversation resource={resource} /></React.StrictMode>);
  await screen.findByText('Shared content');
});

it('does not claim another organization’s author with the same user ID and keeps customer-private creation local', async () => {
  mocks.load.mockResolvedValue({ ...data(), items: [{ ...item(), author: { ...item().author, tenant: 'customer' } }] });
  const view = mount(); await screen.findByText('Shared content');
  expect(screen.queryByRole('button', { name: 'coManaged.conversation.edit' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'coManaged.conversation.delete' })).toBeNull();
  mocks.session = { user: { tenant: 'customer', id: 'technician' } };
  mocks.load.mockResolvedValue({ ...data(), actor: { tenant: 'customer', userId: 'technician' }, items: [] });
  view.rerender(<CoManagedFeatureBoundary><CoManagedTicketConversation resource={resource} /></CoManagedFeatureBoundary>);
  await screen.findByText('coManaged.conversation.empty'); fireEvent.click(button('new'));
  fireEvent.change(screen.getByLabelText('coManaged.conversation.audience'), { target: { value: 'organization_private' } });
  fireEvent.change(message(), { target: { value: 'Customer-private note' } }); fireEvent.click(button('send'));
  await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
  expect(mocks.create.mock.calls[0][1]).toMatchObject({ document: expect.any(Array), audience: 'organization_private' });
  expect(mocks.private).not.toHaveBeenCalled();
});

it('removes an open editor when periodic revalidation removes its content audience', async () => {
  vi.useFakeTimers();
  await act(async () => { mount(); });
  fireEvent.click(button('edit')); expect(message()).toHaveValue('Shared content');
  mocks.load.mockResolvedValue({ ...data(), writeAudiences: [], items: [] });
  await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
  expect(screen.queryByLabelText('coManaged.conversation.message')).toBeNull();
  expect(screen.queryByText('Shared content')).toBeNull();
});

it('retains formatted own-author blocks when editing and does not offer destructive attachment edits', async () => {
  const formatted = [{ type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'Formatted title', styles: { bold: true } }] }];
  mocks.load.mockResolvedValue({ ...data(), items: [{ ...item(), note: JSON.stringify(formatted) }] });
  const view = mount(); await screen.findByText('Formatted title'); fireEvent.click(button('edit')); fireEvent.click(button('send'));
  await waitFor(() => expect(mocks.mutate).toHaveBeenCalledOnce());
  expect(mocks.mutate.mock.calls[0][1].document[0]).toMatchObject(formatted[0]);
  view.unmount(); mocks.load.mockResolvedValue({ ...data(), items: [{ ...item(), note: JSON.stringify([{ type: 'image', props: { url: '/api/files/foreign' } }]) }] });
  mount(); await screen.findByText('Morgan'); expect(screen.queryByRole('button', { name: 'coManaged.conversation.edit' })).toBeNull();
  expect(document.querySelector('img')).toBeNull();
});

const chooseFiles = (...files: File[]) => fireEvent.change(screen.getByLabelText('coManaged.conversation.files.choose'), { target: { files } });
it('keeps selected files local until save and freezes the same prepared message for interrupted retries', async () => {
  mocks.submitDraft.mockRejectedValueOnce(new Error('Lost upload acknowledgement'));
  mount(); await screen.findByText('Shared content'); fireEvent.click(button('reply'));
  fireEvent.change(message(), { target: { value: 'Reply with files' } });
  const file = new File(['evidence'], 'evidence.txt'); chooseFiles(file);
  expect(screen.getByText('evidence.txt')).toBeInTheDocument(); expect(mocks.prepare).not.toHaveBeenCalled();
  fireEvent.click(button('send')); await screen.findByText('coManaged.conversation.unknownOutcome');
  expect(mocks.prepare.mock.calls[0][0]).toMatchObject({ resource, actorTenant: 'msp', audience: 'shared_it', files: [file], parent: { storeTenant: 'customer', threadId: 'thread', commentId: 'comment' } });
  expect(screen.getByLabelText('coManaged.conversation.files.choose')).toBeDisabled(); expect(message()).toBeDisabled();
  expect(screen.getByRole('button', { name: 'coManaged.ticket.cancel' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.ticket.retry' }));
  await waitFor(() => expect(mocks.submitDraft).toHaveBeenCalledTimes(2));
  expect(mocks.prepare).toHaveBeenCalledOnce(); expect(mocks.submitDraft.mock.calls[1][0]).toBe(mocks.submitDraft.mock.calls[0][0]);
  expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.private).not.toHaveBeenCalled();
});
it('allows correcting unreadable files before dispatch and prevents oversized or excessive selections', async () => {
  mocks.prepare.mockRejectedValueOnce(new Error('File no longer readable'));
  mount(); await screen.findByText('Shared content'); fireEvent.click(button('new')); fireEvent.change(message(), { target: { value: 'Message' } });
  chooseFiles(new File(['x'.repeat(101)], 'large.txt')); expect(button('send')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.conversation.files.removeNamed' }));
  chooseFiles(new File(['a'], 'a'), new File(['b'], 'b'), new File(['c'], 'c')); expect(button('send')).toBeDisabled();
  fireEvent.click(screen.getAllByRole('button', { name: 'coManaged.conversation.files.removeNamed' })[2]); fireEvent.click(button('send'));
  await screen.findByText('coManaged.conversation.files.preparationFailed');
  expect(mocks.submitDraft).not.toHaveBeenCalled(); expect(message()).not.toBeDisabled();
  expect(screen.getByRole('button', { name: 'coManaged.ticket.cancel' })).not.toBeDisabled();
  fireEvent.click(button('send')); await waitFor(() => expect(mocks.submitDraft).toHaveBeenCalledOnce());
});
it('retries an incomplete publication without changing its prepared draft and permits cancellation', async () => {
  mocks.submitDraft.mockResolvedValueOnce({ ok: false, code: 'notReady' });
  mount(); await screen.findByText('Shared content'); fireEvent.click(button('new')); fireEvent.change(message(), { target: { value: 'Message' } });
  chooseFiles(new File(['a'], 'a')); fireEvent.click(button('send')); await screen.findByText('coManaged.conversation.files.notReady');
  expect(message()).toBeDisabled(); expect(screen.getByRole('button', { name: 'coManaged.ticket.cancel' })).not.toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.ticket.retry' })); await waitFor(() => expect(mocks.submitDraft).toHaveBeenCalledTimes(2));
  expect(mocks.prepare).toHaveBeenCalledOnce();
});
it.each(['preparing', 'uploading'])('clears selected filenames and stops further work after attachment policy loss while %s', async phase => {
  vi.useFakeTimers(); const pending = deferred();
  if (phase === 'preparing') mocks.prepare.mockReturnValue(pending.promise);
  else mocks.submitDraft.mockReturnValue(pending.promise);
  await act(async () => { mount(); }); fireEvent.click(button('new')); fireEvent.change(message(), { target: { value: 'Message' } });
  chooseFiles(new File(['secret'], 'secret.txt')); await act(async () => { fireEvent.click(button('send')); });
  mocks.load.mockResolvedValue({ ...data(), draftAttachments: { audiences: [], maxBytes: 100, maxFiles: 2 } });
  await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
  expect(screen.queryByText('secret.txt')).toBeNull(); expect(screen.queryByLabelText('coManaged.conversation.message')).toBeNull();
  if (phase === 'uploading') expect(mocks.submitDraft.mock.calls[0][1]()).toBe(false);
  await act(async () => { pending.resolve(phase === 'preparing' ? {} : { ok: false, code: 'unknownOutcome' }); });
  if (phase === 'preparing') expect(mocks.submitDraft).not.toHaveBeenCalled();
  expect(screen.queryByText('coManaged.conversation.unknownOutcome')).toBeNull();
});
it('hides file controls on edits and leaves canceled selections entirely local', async () => {
  mount(); await screen.findByText('Shared content'); fireEvent.click(button('edit'));
  expect(screen.queryByLabelText('coManaged.conversation.files.choose')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.ticket.cancel' })); await waitFor(() => expect(button('new')).toBeInTheDocument());
  fireEvent.click(button('new')); chooseFiles(new File(['local'], 'local.txt'));
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.ticket.cancel' }));
  expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.submitDraft).not.toHaveBeenCalled(); expect(screen.queryByText('local.txt')).toBeNull();
});
it.each(['forbidden', 'readOnly'])('clears an attachment draft immediately when a command reports %s', async code => {
  mocks.submitDraft.mockResolvedValueOnce({ ok: false, code });
  mount(); await screen.findByText('Shared content'); fireEvent.click(button('new')); fireEvent.change(message(), { target: { value: 'Message' } });
  chooseFiles(new File(['secret'], 'secret.txt')); fireEvent.click(button('send'));
  await waitFor(() => expect(screen.queryByText('secret.txt')).toBeNull());
  expect(screen.queryByLabelText('coManaged.conversation.message')).toBeNull();
});

it('retries an uncertain cancellation with the same draft identity without publishing it', async () => {
  mocks.submitDraft.mockResolvedValueOnce({ ok: false, code: 'notReady' }); mocks.abandon.mockRejectedValueOnce(new Error('Lost cancellation acknowledgement'));
  mount(); await screen.findByText('Shared content'); fireEvent.click(button('new')); fireEvent.change(message(), { target: { value: 'Cancel this message' } });
  chooseFiles(new File(['a'], 'a')); fireEvent.click(button('send')); await screen.findByText('coManaged.conversation.files.notReady');
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.ticket.cancel' })); await screen.findByText('coManaged.conversation.files.cancelUnknownOutcome');
  expect(message()).toBeDisabled(); expect(screen.getByRole('button', { name: 'coManaged.ticket.cancel' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.ticket.retry' })); await waitFor(() => expect(mocks.abandon).toHaveBeenCalledTimes(2));
  expect(mocks.abandon.mock.calls[1]).toEqual(mocks.abandon.mock.calls[0]); expect(mocks.submitDraft).toHaveBeenCalledOnce();
  await waitFor(() => expect(screen.queryByLabelText('coManaged.conversation.message')).toBeNull());
});
it('retains local content after expiration and starts a new draft only on explicit resubmission', async () => {
  mocks.submitDraft.mockResolvedValueOnce({ ok: false, code: 'abandoned' });
  mount(); await screen.findByText('Shared content'); fireEvent.click(button('new')); fireEvent.change(message(), { target: { value: 'Still wanted' } });
  chooseFiles(new File(['a'], 'a')); fireEvent.click(button('send')); await screen.findByText('coManaged.conversation.files.abandoned');
  expect(message()).toHaveValue('Still wanted'); expect(message()).not.toBeDisabled(); expect(mocks.prepare).toHaveBeenCalledOnce();
  fireEvent.click(button('send')); await waitFor(() => expect(mocks.prepare).toHaveBeenCalledTimes(2));
  expect(mocks.prepare.mock.calls[1][0].operationId).not.toBe(mocks.prepare.mock.calls[0][0].operationId);
});


it('confirms the complete canonical thread audience with the qualified snapshot and hides private-store transitions', async () => {
  mount(); await screen.findByText('Shared content');
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.disclosure.title' }));
  await screen.findByText('coManaged.disclosure.scope'); expect(mocks.disclose).not.toHaveBeenCalled();
  const select = screen.getByLabelText('coManaged.conversation.audience');
  expect(select.querySelector('option[value="organization_private"]')).toBeNull();
  fireEvent.change(select, { target: { value: 'requester' } });
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.disclosure.confirm' }));
  await waitFor(() => expect(mocks.disclose).toHaveBeenCalledOnce());
  expect(mocks.disclose.mock.calls[0]).toEqual([resource, { storeTenant: 'customer', threadId: 'thread', operationId: expect.any(String), expectedSnapshot: 'a'.repeat(64), audience: 'requester', confirmed: true }]);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
it('freezes an uncertain audience change and retries the same confirmation without a new snapshot', async () => {
  mocks.disclose.mockRejectedValueOnce(new Error('Acknowledgement lost'));
  mount(); await screen.findByText('Shared content'); fireEvent.click(screen.getByRole('button', { name: 'coManaged.disclosure.title' }));
  await screen.findByText('coManaged.disclosure.scope');
  fireEvent.change(screen.getByLabelText('coManaged.conversation.audience'), { target: { value: 'requester' } });
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.disclosure.confirm' }));
  await screen.findByText('coManaged.disclosure.unknownOutcome');
  expect(screen.getByLabelText('coManaged.conversation.audience')).toBeDisabled(); expect(screen.getByRole('button', { name: 'coManaged.ticket.cancel' })).toBeDisabled();
  const original = mocks.disclose.mock.calls[0]; fireEvent.click(screen.getByRole('button', { name: 'coManaged.ticket.retry' }));
  await waitFor(() => expect(mocks.disclose).toHaveBeenCalledTimes(2)); expect(mocks.disclose.mock.calls[1]).toEqual(original);
});
it('requires another review after a stale audience confirmation and clears the dialog on session replacement', async () => {
  mocks.disclose.mockResolvedValueOnce({ ok: false, code: 'conflict' });
  const view = mount(); await screen.findByText('Shared content'); fireEvent.click(screen.getByRole('button', { name: 'coManaged.disclosure.title' }));
  await screen.findByText('coManaged.disclosure.scope'); fireEvent.change(screen.getByLabelText('coManaged.conversation.audience'), { target: { value: 'requester' } });
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.disclosure.confirm' })); await screen.findByText('coManaged.editor.errors.conflict');
  mocks.preview.mockResolvedValue({ actor: data().actor, preview: { storeTenant: 'customer', threadId: 'thread', audience: 'shared_it', snapshot: 'b'.repeat(64), comments: 3, attachments: 1, pendingAttachments: 0 } });
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.disclosure.review' })); await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(screen.getByRole('button', { name: 'coManaged.disclosure.confirm' })).toBeDisabled();
  (mocks.session as any).session_id = 'replacement'; view.rerender(<CoManagedTicketConversation resource={resource} />);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); expect(mocks.disclose).toHaveBeenCalledOnce();
});
it('blocks audience confirmation while files are pending and clears its review when current access fails', async () => {
  vi.useFakeTimers(); mocks.preview.mockResolvedValue({ actor: data().actor, preview: { storeTenant: 'customer', threadId: 'thread', audience: 'shared_it', snapshot: 'a'.repeat(64), comments: 2, attachments: 0, pendingAttachments: 1 } });
  await act(async () => { mount(); }); await act(async () => fireEvent.click(screen.getByRole('button', { name: 'coManaged.disclosure.title' })));
  expect(screen.getByText('coManaged.disclosure.pending')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('coManaged.conversation.audience'), { target: { value: 'requester' } });
  expect(screen.getByRole('button', { name: 'coManaged.disclosure.confirm' })).toBeDisabled();
  mocks.preview.mockRejectedValue(new Error('Scope lost')); await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
  expect(screen.queryByRole('dialog')).toBeNull(); expect(mocks.disclose).not.toHaveBeenCalled();
});

it('explains private-thread ownership transfer and accepts only a receipt qualified by both source and destination', async () => {
  mocks.load.mockResolvedValue({ ...data(), items: [{ ...item(), storeTenant: 'msp', audience: 'organization_private', revision: 1 }] });
  mocks.preview.mockResolvedValue({ actor: data().actor, preview: { storeTenant: 'msp', threadId: 'thread', audience: 'organization_private', snapshot: 'a'.repeat(64), comments: 2, attachments: 1, pendingAttachments: 0 } });
  mocks.disclose.mockImplementation(async (_resource, request) => ({ ok: true, receipt: { storeTenant: 'customer', threadId: request.operationId, operationId: request.operationId,
    audience: request.audience, sourceStoreTenant: 'msp', sourceThreadId: 'thread', appliedAt: '2026-09-07T00:00:00.000Z' } }));
  mount(); await screen.findByText('Shared content'); fireEvent.click(screen.getByRole('button', { name: 'coManaged.disclosure.title' }));
  await screen.findByText('coManaged.disclosure.transferHelp');
  fireEvent.change(screen.getByLabelText('coManaged.conversation.audience'), { target: { value: 'shared_it' } });
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.disclosure.confirm' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); expect(mocks.disclose.mock.calls[0][1]).toMatchObject({ storeTenant: 'msp', threadId: 'thread', audience: 'shared_it', confirmed: true });
});
it('keeps an incorrectly qualified transfer receipt uncertain for an exact retry', async () => {
  mocks.load.mockResolvedValue({ ...data(), items: [{ ...item(), storeTenant: 'msp', audience: 'organization_private', revision: 1 }] });
  mocks.preview.mockResolvedValue({ actor: data().actor, preview: { storeTenant: 'msp', threadId: 'thread', audience: 'organization_private', snapshot: 'a'.repeat(64), comments: 2, attachments: 0, pendingAttachments: 0 } });
  mocks.disclose.mockImplementation(async (_resource, request) => ({ ok: true, receipt: { storeTenant: 'customer', threadId: request.operationId, operationId: request.operationId,
    audience: request.audience, sourceStoreTenant: 'msp', sourceThreadId: 'wrong-thread', appliedAt: '2026-09-07T00:00:00.000Z' } }));
  mount(); await screen.findByText('Shared content'); fireEvent.click(screen.getByRole('button', { name: 'coManaged.disclosure.title' }));
  await screen.findByText('coManaged.disclosure.transferHelp'); fireEvent.change(screen.getByLabelText('coManaged.conversation.audience'), { target: { value: 'requester' } });
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.disclosure.confirm' })); await screen.findByText('coManaged.disclosure.unknownOutcome');
  expect(screen.getByRole('button', { name: 'coManaged.ticket.cancel' })).toBeDisabled();
});
