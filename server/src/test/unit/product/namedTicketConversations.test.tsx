/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConversationAiDialog } from '../../../../../packages/tickets/src/components/ticket/conversations/ConversationAiDialog';
import { ConversationShareDialog } from '../../../../../packages/tickets/src/components/ticket/conversations/ConversationShareDialog';
import CoManagedNamedTicketConversation from '../../../components/co-managed/CoManagedNamedTicketConversation';
import { NativeRequesterConversation } from '../../../../../packages/tickets/src/components/ticket/conversations/NativeRequesterConversation';
import { useNamedTicketConversations } from '../../../../../packages/tickets/src/components/ticket/conversations/useNamedTicketConversations';
const mocks = vi.hoisted(() => ({ aiSources: vi.fn(), askAi: vi.fn(), aiStatus: vi.fn(), aiCancel: vi.fn(), aiCapability: vi.fn(), synthesis: vi.fn(), synthesisStatus: vi.fn(), synthesisCancel: vi.fn(), synthesisDraft: vi.fn(), share: vi.fn(), getConversation: vi.fn(), acknowledge: vi.fn(), preference: vi.fn(), details: vi.fn(), schedules: vi.fn(), reschedule: vi.fn(), cancelSchedule: vi.fn(), flag: true, onPublished: vi.fn(), requesterProps: vi.fn(), uploadOptions: vi.fn(), uploadFile: vi.fn(), load: vi.fn(), page: vi.fn(), activity: vi.fn(), capabilities: vi.fn(), replyTarget: vi.fn(), replace: vi.fn(), readDraft: vi.fn(), saveDraft: vi.fn(), post: vi.fn(), create: vi.fn(), status: vi.fn(), push: vi.fn(), mailboxes: vi.fn(), selectMailbox: vi.fn(), latestSend: vi.fn(), prepareEmail: vi.fn(), sendEmail: vi.fn(), emailStatus: vi.fn(), emailDefaults: vi.fn(),
  query: '', session: { session_id: 'session', user: { tenant: 'home', id: 'author' } } }));
vi.mock('../../../../../packages/tickets/src/components/ticket/conversations/conversationAiRequest', () => ({ requestConversationAi: mocks.askAi }));
vi.mock('../../../../../packages/tickets/src/components/ticket/conversations/conversationSynthesisRequest', () => ({ requestConversationSynthesis: mocks.synthesis }));
vi.mock('../../../../../packages/tickets/src/actions/conversationAiActions', () => ({
  getConversationAiCapabilityAction: mocks.aiCapability, prepareNamedConversationSynthesisAction: mocks.synthesis,
  getNamedConversationSynthesisStatusAction: mocks.synthesisStatus, cancelNamedConversationSynthesisAction: mocks.synthesisCancel,
  getNamedConversationDraftSynthesisAction: mocks.synthesisDraft, getConversationAiSourcesAction: mocks.aiSources,
  getNamedConversationAiStatusAction: mocks.aiStatus, cancelNamedConversationAiAction: mocks.aiCancel,
}));
vi.mock('../../../../../packages/tickets/src/actions/namedTicketConversationActions', () => ({
  prepareNamedConversationShareAction: mocks.share, getNamedTicketConversationAction: mocks.getConversation,
  acknowledgeNamedConversationMessagesAction: mocks.acknowledge,
  updateNamedConversationPreferenceAction: mocks.preference,
  getNamedConversationMessageDetailsAction: mocks.details,
  listNamedScheduledCommentsAction: mocks.schedules,
  getNamedTicketConversationPublicationCapabilitiesAction: mocks.capabilities,
  getNamedTicketConversationActivityAction: mocks.activity, getNamedTicketConversationReplyTargetAction: mocks.replyTarget,
  getNamedConversationUploadOptionsAction: mocks.uploadOptions, uploadNamedConversationEditorFileAction: mocks.uploadFile,
  listNamedConversationMailboxesAction: mocks.mailboxes, selectNamedConversationMailboxAction: mocks.selectMailbox, getLatestNamedTicketEmailSendAction: mocks.latestSend,
  prepareNamedTicketEmailAction: mocks.prepareEmail, sendNamedTicketEmailAction: mocks.sendEmail, getNamedTicketEmailOperationAction: mocks.emailStatus,
  getNamedConversationEmailDefaultsAction: mocks.emailDefaults,
  getNamedTicketConversationScreenAction: mocks.load, getNamedTicketConversationMessagesAction: mocks.page,
  getNamedConversationEditorDraftAction: mocks.readDraft, saveNamedConversationEditorDraftAction: mocks.saveDraft,
  postNamedTicketConversationAction: mocks.post, createNamedTicketConversationAction: mocks.create, setNamedTicketConversationStatusAction: mocks.status,
}));
vi.mock('../../../../../packages/tickets/src/actions/comment-actions/commentActions', () => ({ rescheduleScheduledComment: mocks.reschedule, cancelScheduledComment: mocks.cancelSchedule }));
vi.mock('@alga-psa/ui/components/DateTimePicker', () => ({ DateTimePicker: ({ id, label, value, onChange, disabled }: any) => <label>{label}<input id={id} type="datetime-local" disabled={disabled} value={value ? new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''} onChange={event => onChange(event.target.value ? new Date(event.target.value) : undefined)} /></label> }));
vi.mock('@alga-psa/ui/hooks/useFeatureFlag', () => ({ useFeatureFlag: () => ({ enabled: mocks.flag }) }));
vi.mock('../../../components/co-managed/CoManagedTicketConversation', () => ({ default: (props: any) => {
  mocks.requesterProps(props);
  return <div>Canonical Requester<button onClick={() => props.onDraftState?.(true)}>Start requester edit</button><button onClick={() => props.onDraftState?.(false)}>Finish requester edit</button></div>;
} }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: mocks.session }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, replace: mocks.replace }), useSearchParams: () => new URLSearchParams(mocks.query) }));
vi.mock('next/dynamic', () => ({ default: () => ({ id, document, editable, onChange }: any) => editable !== undefined
  ? <textarea aria-label="Message" id={id} disabled={!editable} value={document.map((block: any) => block.content?.map((part: any) => part.text ?? '').join('') ?? '').join('\n')}
      onChange={event => onChange([{ type: 'paragraph', content: [{ type: 'text', text: event.target.value, styles: {} }] }])} />
  : <div id={id}>{document.map((block: any) => block.content?.map((part: any) => part.text ?? '').join('') ?? '').join('\n')}</div> }));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: ({ children, variant, size, ...props }: any) => <button {...props}>{children}</button> }));
vi.mock('@alga-psa/ui/components/Checkbox', () => ({ Checkbox: ({ label, ...props }: any) => <label><input type="checkbox" {...props} />{label}</label> }));
vi.mock('@alga-psa/ui/components/Switch', () => ({ Switch: ({ checked, onCheckedChange, ...props }: any) => <input type="checkbox" checked={checked} onChange={event => onCheckedChange(event.target.checked)} {...props} /> }));
vi.mock('@alga-psa/ui/components/Label', () => ({ Label: ({ children, ...props }: any) => <label {...props}>{children}</label> }));
vi.mock('@alga-psa/ui/components/Input', () => ({ Input: ({ label, ...props }: any) => <label>{label}<input {...props} /></label> }));
vi.mock('@alga-psa/ui/components/Dialog', () => ({ Dialog: ({ isOpen, children, footer }: any) => isOpen ? <div role="dialog">{children}{footer}</div> : null, DialogContent: ({ children }: any) => <div>{children}</div> }));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: ({ options, value, onValueChange, label, ...props }: any) => <label>{label}<select {...props} value={value} onChange={event => onValueChange(event.target.value)}>{options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label> }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (_key: string, fallback: any) => typeof fallback === 'string' ? fallback : fallback?.defaultValue?.replace('{{name}}', fallback.name) }), useFormatters: () => ({ formatDate: (value: string) => value }) }));
const ticket = { tenant: 'owner', ticketId: 'ticket' };
const requester = { storeTenant: 'owner', conversationId: 'requester', ticket, name: 'Requester', audience: 'requester', transport: 'email', defaultSlot: 'requester', status: 'open', revision: 1, messageVersion: '0', mailbox: null, createdAt: '2026-01-01T00:00:00Z' };
const side = { ...requester, storeTenant: 'home', conversationId: 'private', name: 'Diagnostics', audience: 'organization_private', transport: 'internal', defaultSlot: null };
function Harness({ enabled = true }: { enabled?: boolean }) {
  const view = useNamedTicketConversations(ticket, enabled, 'named', { onPublished: mocks.onPublished });
  return <>{view.navigator}{view.panel ?? <p>Default requester panel</p>}</>;
}
function NativeHarness() {
  const [editing, setEditing] = React.useState(false);
  const view = useNamedTicketConversations(ticket, true, 'native', {
    requesterPanel: props => <NativeRequesterConversation {...props} id="native-requester" editing={() => editing} onPublished={mocks.onPublished} historyComments={() => [{ comment_id: 'source', thread_id: 'root' } as any]}
      renderHistory={composition => <div>
        <output aria-label="Native focused message">{composition.focusedMessageId}</output>
        {composition.renderDetails?.({ comment_id: 'source', thread_id: 'root' } as any)}
        <button disabled={!composition.ready} onClick={async () => { if (await composition.beforeEdit()) setEditing(true); }}>Edit old reply</button>
        {editing && <button onClick={() => setEditing(false)}>Finish history edit</button>}
        <button disabled={!composition.ready} onClick={() => void composition.reply({ comment_id: 'source', thread_id: 'root' } as any)}>Reply from history</button>
      </div>} />,
  });
  return <>{view.navigator}{view.panel}</>;
}
const deferred = () => { let resolve!: (value: any) => void; const promise = new Promise<any>(done => { resolve = done; }); return { promise, resolve }; };
beforeEach(() => {
  vi.resetAllMocks(); mocks.aiSources.mockResolvedValue({ ok: true, sources: [requester, side] }); mocks.aiCancel.mockResolvedValue({ ok: true, result: { status: 'cancelled' } }); mocks.aiCapability.mockResolvedValue({ available: false }); mocks.synthesisDraft.mockResolvedValue({ ok: true, result: null }); mocks.flag = true; mocks.query = 'conversation=private&conversationStore=home';
  mocks.share.mockResolvedValue({ ok: true, draft: { content: { text: 'Copied source' }, revision: 1, conversationRevision: 1 } });
  mocks.getConversation.mockImplementation(async (_ticket, ref) => ref.conversationId === requester.conversationId ? requester : side);
  mocks.acknowledge.mockResolvedValue({ changed: false });
  mocks.session = { session_id: 'session', user: { tenant: 'home', id: 'author' } };
  mocks.load.mockResolvedValue({ conversations: [requester, side], writeAudiences: ['requester', 'organization_private'], actor: { tenant: 'home', userId: 'author' } });
  mocks.page.mockResolvedValue({ conversation: side, items: [], nextBefore: null });
  mocks.capabilities.mockResolvedValue({ resolution: false });
  mocks.preference.mockResolvedValue(undefined);
  mocks.schedules.mockResolvedValue({ items: [], next: null });
  mocks.details.mockResolvedValue([]);
  mocks.activity.mockResolvedValue({ items: [], nextBefore: null });
  mocks.replyTarget.mockImplementation(async (_ticket, _conversation, parent) => parent);
  mocks.readDraft.mockResolvedValue(null);
  mocks.uploadOptions.mockResolvedValue({ maxBytes: 1048576 });
  mocks.saveDraft.mockImplementation(async (_ticket, _ref, request) => ({ content: request.content, revision: request.expectedRevision + 1, conversationRevision: 1 }));
  mocks.post.mockResolvedValue({ commentId: 'posted' });
  mocks.mailboxes.mockResolvedValue([{ id: 'mailbox', tenant: 'home', email: 'support@example.test', name: 'Support' }]);
  mocks.latestSend.mockResolvedValue(null); mocks.emailDefaults.mockResolvedValue(null);
});
afterEach(cleanup);

it('does not load named data when the UI flag is off and keeps Requester pinned when enabled', async () => {
  const view = render(<Harness enabled={false} />); expect(mocks.load).not.toHaveBeenCalled();
  view.rerender(<Harness />); await screen.findByLabelText('Message');
  const nav = screen.getByRole('navigation'); expect(nav.querySelector('button')?.textContent).toContain('Requester');
  expect(screen.getByRole('button', { name: /Diagnostics/ }).getAttribute('aria-current')).toBe('page');
});

it('coalesces pending edits and flushes the latest draft before navigation', async () => {
  const first = deferred(); mocks.saveDraft.mockReturnValueOnce(first.promise);
  render(<Harness />); const editor = await screen.findByLabelText('Message');
  fireEvent.change(editor, { target: { value: 'First' } });
  await waitFor(() => expect(mocks.saveDraft).toHaveBeenCalledTimes(1));
  fireEvent.change(editor, { target: { value: 'First and latest' } });
  fireEvent.click(screen.getByRole('button', { name: /Requester/ })); expect(mocks.push).not.toHaveBeenCalled();
  await act(async () => first.resolve({ revision: 1, conversationRevision: 1 }));
  await waitFor(() => expect(mocks.push).toHaveBeenCalledTimes(1));
  expect(mocks.saveDraft).toHaveBeenCalledTimes(2);
  expect(mocks.saveDraft.mock.calls[1][2]).toMatchObject({ expectedRevision: 1, content: { document: [{ content: [{ text: 'First and latest' }] }] } });
});

it('retries an uncertain save and post with their original operation identities', async () => {
  mocks.saveDraft.mockRejectedValueOnce(new Error('Lost save acknowledgement'));
  mocks.post.mockRejectedValueOnce(new Error('Lost post acknowledgement'));
  render(<Harness />); const editor = await screen.findByLabelText('Message');
  fireEvent.change(editor, { target: { value: 'One internal message' } });
  await screen.findByText('Could not save. Retry before switching conversations.');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(mocks.saveDraft).toHaveBeenCalledTimes(2));
  expect(mocks.saveDraft.mock.calls[1]).toEqual(mocks.saveDraft.mock.calls[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Post' }));
  await screen.findByText('Could not confirm the post. Retry to check the same message.');
  expect(screen.getByLabelText('Message')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry post' }));
  await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));
  expect(mocks.post.mock.calls[1]).toEqual(mocks.post.mock.calls[0]);
});

it('drops a prior author’s late draft and clears history after access refresh fails', async () => {
  const pending = deferred(); mocks.readDraft.mockReturnValueOnce(pending.promise);
  const view = render(<Harness />);
  await waitFor(() => expect(mocks.readDraft).toHaveBeenCalledTimes(1));
  mocks.session = { session_id: 'another-session', user: { tenant: 'home', id: 'another-author' } };
  view.rerender(<Harness />); await screen.findByLabelText('Message');
  await act(async () => pending.resolve({ content: { text: 'Prior author secret' }, revision: 1 }));
  expect(screen.getByLabelText('Message')).toHaveValue('');
  mocks.load.mockRejectedValue(new Error('Permission revoked'));
  fireEvent.focus(window);
  await screen.findAllByText('This conversation is unavailable.');
  expect(screen.queryByLabelText('Message')).toBeNull(); expect(screen.queryByText('Diagnostics')).toBeNull();
});

it('saves the reply target with the draft, restores it after remount, and can detach it without losing text', async () => {
  const parent = { threadId: 'root-thread', commentId: 'root-message' };
  mocks.page.mockResolvedValue({ conversation: side, items: [{ ...parent, storeTenant: 'home', note: 'Original question', markdown: null,
    createdAt: '2026-01-01T00:00:00Z', deleted: false, author: { displayName: 'Technician' } }], nextBefore: null });
  let retained: any = null;
  mocks.readDraft.mockImplementation(async () => retained);
  mocks.saveDraft.mockImplementation(async (_ticket, _ref, request) => retained = { ...request, revision: request.expectedRevision + 1 });
  const first = render(<Harness />);
  const editor = await screen.findByLabelText('Message');
  fireEvent.change(editor, { target: { value: 'My existing draft' } });
  await waitFor(() => expect(retained?.content).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
  await waitFor(() => expect(retained?.parent).toEqual(parent));
  first.unmount(); render(<Harness />);
  expect(await screen.findByLabelText('Message')).toHaveValue('My existing draft');
  expect(screen.getByText('Replying to a message in this conversation')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'New message instead' }));
  await waitFor(() => expect(retained.parent).toBeNull());
  expect(screen.getByLabelText('Message')).toHaveValue('My existing draft');
  fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
  await waitFor(() => expect(retained.parent).toEqual(parent));
  fireEvent.click(screen.getByRole('button', { name: 'Post' }));
  await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
  expect(mocks.post.mock.calls[0][2].expectedDraftRevision).toBe(retained.revision);
});

it('refreshes newly published messages without overwriting the current draft', async () => {
  render(<Harness />);
  const editor = await screen.findByLabelText('Message');
  fireEvent.change(editor, { target: { value: 'Work in progress' } });
  await waitFor(() => expect(mocks.saveDraft).toHaveBeenCalledTimes(1));
  mocks.load.mockResolvedValue({ conversations: [requester, { ...side, messageVersion: '1' }], writeAudiences: ['organization_private'], actor: { tenant: 'home', userId: 'author' } });
  mocks.page.mockResolvedValue({ conversation: { ...side, messageVersion: '1' }, items: [{ commentId: 'new', storeTenant: 'home', note: 'New colleague reply', markdown: null,
    createdAt: '2026-01-01T00:00:00Z', deleted: false, author: { displayName: 'Technician' } }], nextBefore: null });
  fireEvent.focus(window);
  await screen.findByText('New colleague reply');
  expect(screen.getByLabelText('Message')).toHaveValue('Work in progress');
  expect(mocks.readDraft).toHaveBeenCalledTimes(1);
});

it('retains the publication identity if the post succeeded but refreshing the draft failed', async () => {
  mocks.readDraft.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('Draft refresh unavailable')).mockResolvedValue(null);
  render(<Harness />);
  fireEvent.change(await screen.findByLabelText('Message'), { target: { value: 'Publish exactly once' } });
  await waitFor(() => expect(mocks.saveDraft).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: 'Post' }));
  await screen.findByText('Could not confirm the post. Retry to check the same message.');
  expect(screen.getByLabelText('Message')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry post' }));
  await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));
  expect(mocks.post.mock.calls[1]).toEqual(mocks.post.mock.calls[0]);
  await waitFor(() => expect(screen.getByLabelText('Message')).toHaveValue(''));
});

function scheduledEmailFixture() {
  const f = emailFixture();
  const selected = { ...f.emailSide, storeTenant: 'owner', audience: 'requester', mailbox: { id: 'mailbox', tenant: 'owner' } };
  mocks.session.user.tenant = 'owner'; mocks.query = 'conversation=private&conversationStore=owner';
  mocks.load.mockResolvedValue({ conversations: [requester, selected], writeAudiences: ['requester'], actor: { tenant: 'owner', userId: 'author' } });
  mocks.page.mockResolvedValue({ conversation: selected, items: [], nextBefore: null });
  mocks.capabilities.mockResolvedValue({ resolution: true, scheduling: true, closeStatuses: [{ value: 'closed', label: 'Resolved' }] });
  mocks.prepareEmail.mockImplementation(async (_ticket, _ref, request) => ({ operationId: request.operationId, status: 'reviewed', review: f.preview, publicationOptions: f.draft().publicationOptions }));
  return f;
}
it('privately restores scheduling, blocks invalid timing and reviews before accepting a scheduled email', async () => {
  const f = scheduledEmailFixture();
  const send = mocks.sendEmail.getMockImplementation()!;
  mocks.sendEmail.mockImplementation(async (...args) => ({ ...await send(...args), status: 'scheduled' }));
  const first = render(<Harness />); await writeEmail();
  fireEvent.click(screen.getByLabelText('Mark as resolution'));
  fireEvent.change(screen.getByLabelText('After sending'), { target: { value: 'closed' } });
  fireEvent.click(screen.getByLabelText('Schedule'));
  await waitFor(() => expect(f.draft().publicationOptions?.schedule).toBeTruthy());
  expect(f.draft().publicationOptions.close).toBeUndefined();
  const timing = f.draft().publicationOptions.schedule;
  first.unmount(); render(<Harness />);
  expect(await screen.findByLabelText('Schedule')).toBeChecked();
  expect(screen.getByLabelText('Mark as resolution')).toBeChecked();
  expect(screen.queryByLabelText('After sending')).toBeNull();
  fireEvent.change(screen.getByLabelText(/Publish at/), { target: { value: '' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Review email' })).toBeDisabled());
  fireEvent.click(screen.getAllByRole('button', { name: /Requester/ })[0]);
  expect(mocks.push).not.toHaveBeenCalled(); expect(f.draft().publicationOptions.schedule).toEqual(timing);
  fireEvent.click(screen.getByLabelText('Schedule'));
  fireEvent.click(screen.getByLabelText('Schedule'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Review email' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Review email' }));
  const confirm = await screen.findByRole('button', { name: 'Schedule email' });
  expect(screen.getByRole('dialog')).toHaveTextContent('Scheduled replies keep the current ticket status.');
  expect(mocks.sendEmail).not.toHaveBeenCalled();
  const reads = mocks.schedules.mock.calls.length;
  fireEvent.click(confirm);
  await waitFor(() => expect(screen.getByLabelText('Schedule')).not.toBeChecked());
  await waitFor(() => expect(mocks.schedules.mock.calls.length).toBeGreaterThan(reads));
  expect(screen.getByLabelText('Message')).toHaveValue(''); expect(mocks.sendEmail).toHaveBeenCalledOnce();
});
it('pages accepted replies and reschedules or cancels without replacing the composer draft', async () => {
  scheduledEmailFixture();
  const at = new Date(Date.now() + 7200000).toISOString();
  const row = (commentId: string) => ({ commentId, note: `${commentId} accepted body`, markdown: null, at, timeZone: 'UTC', isResolution: false,
    email: { subject: 'Reviewed subject', to: [{ email: 'recipient@example.test' }], cc: [] }, files: [{ name: 'Selected report.txt', size: 10 }] });
  mocks.schedules.mockImplementation(async (_ticket, _conversation, after) => ({ items: [row(after ? 'second' : 'first')], next: after ? null : { at, commentId: 'first' } }));
  render(<Harness />); await writeEmail();
  await screen.findByText('first accepted body');
  expect(mocks.schedules).toHaveBeenCalledWith(ticket, { storeTenant: 'owner', conversationId: 'private' }, undefined);
  fireEvent.click(screen.getByRole('button', { name: 'Load more' })); await screen.findByText('second accepted body');
  expect(mocks.schedules.mock.calls.at(-1)[2]).toEqual({ at, commentId: 'first' });
  fireEvent.click(within(screen.getByText('second accepted body').closest('article')!).getByRole('button', { name: 'Reschedule' }));
  const wall = new Date(Date.now() + 10800000).toISOString().slice(0, 16);
  fireEvent.change(screen.getByLabelText(/Publish at/), { target: { value: wall } });
  fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
  await waitFor(() => expect(mocks.reschedule).toHaveBeenCalledWith('second', new Date(wall + ':00.000Z').toISOString(), 'UTC'));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByLabelText('Message')).toHaveValue('Selected vendor question');
  await screen.findByText('first accepted body');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel scheduled reply' }));
  expect(mocks.cancelSchedule).not.toHaveBeenCalled();
  mocks.schedules.mockResolvedValue({ items: [], next: null });
  mocks.latestSend.mockResolvedValue({ operationId: 'first', status: 'canceled', errorCode: null, reviewHash: 'review-hash' });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm cancellation' }));
  await waitFor(() => expect(mocks.cancelSchedule).toHaveBeenCalledWith('first'));
  await waitFor(() => expect(screen.queryByText('first accepted body')).toBeNull());
  await screen.findByText('Scheduled email canceled.');
  expect(screen.getByLabelText('Message')).toHaveValue('Selected vendor question');
});
it('drops late scheduled rows after the author changes', async () => {
  scheduledEmailFixture(); const old = deferred();
  mocks.schedules.mockReturnValueOnce(old.promise);
  const view = render(<Harness />); await screen.findByLabelText('Message');
  await waitFor(() => expect(mocks.schedules).toHaveBeenCalledOnce());
  mocks.session = { session_id: 'new-session', user: { tenant: 'owner', id: 'second-author' } };
  view.rerender(<Harness />);
  await waitFor(() => expect(mocks.schedules).toHaveBeenCalledTimes(2));
  await act(async () => old.resolve({ items: [{ commentId: 'old', note: 'Old author schedule', at: new Date().toISOString(), timeZone: 'UTC', files: [] }], next: null }));
  expect(screen.queryByText('Old author schedule')).toBeNull();
});

function emailFixture(selected = true) {
  const emailSide = { ...side, transport: 'email', mailbox: selected ? { id: 'mailbox', tenant: 'home' } : null };
  let draft: any = null;
  mocks.load.mockResolvedValue({ conversations: [requester, emailSide], writeAudiences: ['organization_private'], actor: { tenant: 'home', userId: 'author' } });
  mocks.page.mockResolvedValue({ conversation: emailSide, items: [], nextBefore: null });
  mocks.readDraft.mockImplementation(async () => draft);
  mocks.saveDraft.mockImplementation(async (_ticket, _ref, request) => draft = { ...request, revision: request.expectedRevision + 1 });
  const preview = { senderRevision: 'sender', messageHash: 'review-hash', from: { email: 'resolved@example.test' }, replyTo: { email: 'support@example.test' },
    to: [{ email: 'vendor@example.test' }], cc: [{ email: 'colleague@example.test' }], subject: 'Connection failure', html: '<p>Selected vendor question</p>', text: 'Selected vendor question', files: [] as Array<{ filename: string; contentType: string; size: number }> };
  mocks.prepareEmail.mockImplementation(async (_ticket, _ref, request) => ({ operationId: request.operationId, status: 'reviewed', review: preview }));
  mocks.sendEmail.mockImplementation(async (_ticket, _ref, operationId) => { draft = { content: null, email: null, revision: draft.revision + 1 }; return { operationId, status: 'delivered', errorCode: null }; });
  return { emailSide, preview, draft: () => draft };
}
async function writeEmail() {
  fireEvent.change(await screen.findByLabelText('Message'), { target: { value: 'Selected vendor question' } });
  fireEvent.change(screen.getByLabelText('To'), { target: { value: 'vendor@example.test' } });
  fireEvent.change(screen.getByLabelText('CC'), { target: { value: 'colleague@example.test' } });
  fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Connection failure' } });
}
it('restores the email envelope and reviews the resolved sender without sending until confirmation', async () => {
  const f = emailFixture(); f.preview.files = [{ filename: 'Reviewed report.txt', contentType: 'text/plain', size: 1536 }];
  const first = render(<Harness />); await writeEmail();
  fireEvent.click(screen.getByRole('button', { name: /Requester/ }));
  await waitFor(() => expect(mocks.push).toHaveBeenCalledTimes(1));
  expect(f.draft().email).toEqual({ to: ['vendor@example.test'], cc: ['colleague@example.test'], subject: 'Connection failure' });
  first.unmount(); render(<Harness />);
  expect(await screen.findByLabelText('Message')).toHaveValue('Selected vendor question');
  expect(screen.getByLabelText('To')).toHaveValue('vendor@example.test');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Review email' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Review email' }));
  await screen.findByText('resolved@example.test'); expect(mocks.sendEmail).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog')).toHaveTextContent('Reviewed report.txt (2 KiB)');
  expect(mocks.prepareEmail.mock.calls[0][2].expectedDraftRevision).toBe(f.draft().revision);
  expect(screen.getByLabelText('Message')).toBeDisabled(); expect(screen.getByLabelText('To')).toBeDisabled();
  expect(screen.getByTitle('Email body preview').getAttribute('sandbox')).toBe('');
  fireEvent.click(screen.getByRole('button', { name: 'Back to draft' }));
  expect(screen.getByLabelText('Message')).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Review email' })); await screen.findByText('resolved@example.test');
  fireEvent.click(screen.getByRole('button', { name: 'Send email' })); await screen.findByText('Email sent.');
  await waitFor(() => expect(screen.getByLabelText('Message')).toHaveValue(''));
  expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
  expect(mocks.sendEmail.mock.calls[0].slice(2)).toEqual([mocks.prepareEmail.mock.calls[1][2].operationId, 'review-hash']);
  expect(mocks.post).not.toHaveBeenCalled();
});
it('checks an uncertain Send with its original identity and restores its warning after remount', async () => {
  emailFixture(); mocks.sendEmail.mockRejectedValueOnce(new Error('Lost confirmation response'));
  const first = render(<Harness />); await writeEmail();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Review email' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Review email' })); await screen.findByText('resolved@example.test');
  fireEvent.click(screen.getByRole('button', { name: 'Send email' }));
  await screen.findAllByText('Could not confirm the result. Check this send before editing or sending again.');
  expect(screen.queryByRole('button', { name: 'Send email' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Requester/ })); expect(mocks.push).not.toHaveBeenCalled();
  const operationId = mocks.sendEmail.mock.calls[0][2], outcome = { operationId, status: 'unknown', errorCode: 'delivery_unknown' };
  mocks.emailStatus.mockResolvedValue(outcome); mocks.readDraft.mockResolvedValue({ content: null, email: null, revision: 10 });
  mocks.latestSend.mockResolvedValue({ ...outcome, reviewHash: 'review-hash' });
  fireEvent.click(screen.getByRole('button', { name: 'Check delivery' }));
  await screen.findByText('Delivery could not be confirmed. Check the mailbox before sending this message again.');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(mocks.emailStatus.mock.calls[0][2]).toBe(operationId); expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
  first.unmount(); render(<Harness />);
  await screen.findByText('Delivery could not be confirmed. Check the mailbox before sending this message again.');
  fireEvent.click(screen.getByRole('button', { name: 'Check delivery' }));
  await waitFor(() => expect(mocks.emailStatus).toHaveBeenCalledTimes(2)); expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
});
// F033: a genuine stale-conversation conflict (the audience/mailbox/draft
// changed between "Review email" and "Send") gets its own specific message —
// distinct from an ambiguous transport failure — and returns the user to an
// intact, still-reviewable draft rather than a dead end.
it('reports a stale conversation conflict at Send distinctly from an ambiguous send failure', async () => {
  emailFixture();
  mocks.sendEmail.mockRejectedValueOnce(new Error('The conversation changed. Reload it before trying again.'));
  render(<Harness />); await writeEmail();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Review email' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Review email' })); await screen.findByText('resolved@example.test');
  fireEvent.click(screen.getByRole('button', { name: 'Send email' }));
  await screen.findAllByText(/This conversation changed since you opened this review/);
  expect(screen.queryByText('Could not confirm the result. Check this send before editing or sending again.')).toBeNull();
  // The review dialog is still open with a still-intact draft to retry from.
  expect(screen.getByRole('button', { name: 'Send email' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Back to draft' })).toBeEnabled();
});
it('saves the email draft before selecting a mailbox and uses its new revision at review', async () => {
  const f = emailFixture(false); render(<Harness />); await writeEmail();
  await waitFor(() => expect(screen.getByLabelText('Sending mailbox')).toBeEnabled());
  mocks.selectMailbox.mockImplementation(async () => {
    expect(f.draft().email.to).toEqual(['vendor@example.test']);
    const selected = { ...f.emailSide, mailbox: { id: 'mailbox', tenant: 'home' }, revision: 2 };
    mocks.load.mockResolvedValue({ conversations: [requester, selected], writeAudiences: ['organization_private'], actor: { tenant: 'home', userId: 'author' } });
    return selected;
  });
  fireEvent.change(screen.getByLabelText('Sending mailbox'), { target: { value: 'mailbox' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Review email' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Review email' })); await screen.findByText('resolved@example.test');
  expect(mocks.selectMailbox.mock.calls[0].slice(2)).toEqual([1, 'mailbox']);
  expect(mocks.prepareEmail.mock.calls[0][2].expectedConversationRevision).toBe(2); expect(mocks.sendEmail).not.toHaveBeenCalled();
});

it('uses accepted recipient defaults without replacing an edited envelope on refresh or reload', async () => {
  const f = emailFixture();
  mocks.emailDefaults.mockResolvedValue({ to: ['new-vendor@example.test'], cc: ['colleague@example.test'], subject: 'Latest accepted subject' });
  const first = render(<Harness />);
  await screen.findByLabelText('Message');
  expect(screen.getByLabelText('To')).toHaveValue('new-vendor@example.test');
  fireEvent.change(screen.getByLabelText('To'), { target: { value: 'intentional-recipient@example.test' } });
  await waitFor(() => expect(f.draft()?.email.to).toEqual(['intentional-recipient@example.test']));
  mocks.emailDefaults.mockResolvedValue({ to: ['another-new-vendor@example.test'], cc: [], subject: 'Newer arrival' });
  fireEvent.focus(window);
  await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
  expect(screen.getByLabelText('To')).toHaveValue('intentional-recipient@example.test');
  first.unmount(); render(<Harness />);
  await screen.findByLabelText('Message');
  expect(screen.getByLabelText('To')).toHaveValue('intentional-recipient@example.test');
  expect(screen.getByLabelText('Subject')).toHaveValue('Latest accepted subject');
  expect(mocks.emailDefaults).toHaveBeenCalledTimes(1);
});

it('links received files to the qualified conversation download without exposing storage paths', async () => {
  mocks.page.mockResolvedValue({ conversation: side, nextBefore: null, items: [{ storeTenant: 'home', commentId: 'message', threadId: 'root',
    audience: 'organization_private', createdAt: '2026-09-08T00:00:00Z', deleted: false, note: 'Vendor report',
    attachments: [{ attachmentId: 'file', storeTenant: 'home', commentId: 'message', threadId: 'root', fileName: 'carrier-report.txt', mimeType: 'text/plain', size: 8 }] }] });
  render(<Harness />);
  const link = await screen.findByRole('link', { name: 'carrier-report.txt' });
  const url = new URL(link.getAttribute('href')!, 'https://app.example.test');
  expect(url.pathname).toBe('/api/tickets/conversation-attachments/file');
  expect(Object.fromEntries(url.searchParams)).toEqual({ ticketTenant: 'owner', ticketId: 'ticket', conversationId: 'private', storeTenant: 'home', threadId: 'root', commentId: 'message' });
  expect(link.hasAttribute('download')).toBe(true);
});


it('retries the same private upload, preserves file selection through edits and reload, then removes it through the draft writer', async () => {
  const file = { attachmentId: 'uploaded', fileName: 'diagnosis.txt', mimeType: 'text/plain', size: 12, contentHash: 'digest' };
  let draft: any = null;
  mocks.readDraft.mockImplementation(async () => draft);
  mocks.saveDraft.mockImplementation(async (_ticket, _ref, request) => draft = { ...request, revision: request.expectedRevision + 1,
    conversationRevision: 1, attachments: request.attachments.map((value: any) => ({ ...file, attachmentId: value.attachmentId })) });
  mocks.uploadFile.mockResolvedValueOnce({ ok: false, code: 'unknownOutcome' }).mockImplementation(async (_ticket, _ref, id) => ({ ok: true, attachment: { ...file, attachmentId: id } }));
  const first = render(<Harness />);
  const input = await screen.findByLabelText('Attachments'); await waitFor(() => expect(input).toBeEnabled());
  const bytes = new File(['private text'], file.fileName, { type: file.mimeType });
  fireEvent.change(input, { target: { files: [bytes] } });
  await screen.findByText('The upload result is uncertain. Retry this file or cancel before switching conversations.');
  expect(screen.getByLabelText('Message')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: /Requester/ })); expect(mocks.push).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry attachment' }));
  await screen.findByRole('link', { name: /diagnosis.txt/ });
  expect(mocks.uploadFile.mock.calls[0][2]).toBe(mocks.uploadFile.mock.calls[1][2]);
  expect(mocks.uploadFile.mock.calls[1][3].get('file')).toBe(bytes);
  await waitFor(() => expect(screen.getByLabelText('Message')).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Edited with attachment' } });
  await waitFor(() => expect(draft.content.document[0].content[0].text).toBe('Edited with attachment'));
  expect(draft.attachments).toHaveLength(1);
  first.unmount(); render(<Harness />);
  const link = await screen.findByRole('link', { name: /diagnosis.txt/ });
  expect(link.getAttribute('href')).toContain('/api/tickets/conversation-editor-files/');
  expect(link.getAttribute('href')).toContain('conversationId=private');
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  await waitFor(() => expect(draft.attachments).toEqual([]));
  expect(screen.queryByRole('link', { name: /diagnosis.txt/ })).toBeNull();
});


it('connects the shared ticket navigator to a scoped canonical Requester and preserves an active requester edit', async () => {
  mocks.query = '';
  const resource = { kind: 'ticket' as const, tenant: 'owner', id: 'ticket', relationshipId: 'relationship' };
  const view = render(<CoManagedNamedTicketConversation resource={resource} />);
  await screen.findByText('Canonical Requester');
  expect(mocks.requesterProps.mock.calls.at(-1)?.[0]).toMatchObject({ resource, requester: { storeTenant: 'owner', conversationId: 'requester' } });
  expect(mocks.load).toHaveBeenCalledWith({ tenant: 'owner', ticketId: 'ticket', relationshipId: 'relationship' });
  fireEvent.click(screen.getByRole('button', { name: 'Start requester edit' }));
  await screen.findByText('Finish or cancel your current edit before switching conversations.');
  fireEvent.click(screen.getByRole('button', { name: /Diagnostics/ })); expect(mocks.push).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Finish requester edit' }));
  fireEvent.click(screen.getByRole('button', { name: /Diagnostics/ })); await waitFor(() => expect(mocks.push).toHaveBeenCalledTimes(1));
  mocks.query = 'conversation=private&conversationStore=home'; view.rerender(<CoManagedNamedTicketConversation resource={resource} />);
  await screen.findByLabelText('Message');
  expect(screen.queryByText('Canonical Requester')).toBeNull();
  view.unmount(); mocks.flag = false; mocks.load.mockClear();
  render(<CoManagedNamedTicketConversation resource={resource} />);
  expect(screen.getByText('Canonical Requester')).toBeInTheDocument(); expect(mocks.load).not.toHaveBeenCalled();
  expect(mocks.requesterProps.mock.calls.at(-1)?.[0].requester).toBeUndefined();
});

function requesterEmailFixture() {
  const email = emailFixture();
  mocks.query = '';
  const selected = { ...requester, mailbox: { tenant: 'owner', id: 'mailbox' } };
  mocks.load.mockResolvedValue({ conversations: [selected, side], writeAudiences: ['requester', 'organization_private'], actor: { tenant: 'home', userId: 'author' } });
  mocks.mailboxes.mockResolvedValue([{ id: 'mailbox', tenant: 'owner', email: 'owner-support@example.test', name: 'Owner support' }]);
  mocks.emailDefaults.mockResolvedValue({ to: ['requester@example.test'], cc: [], subject: 'Requester arrangements' });
  const drafts = new Map<string, any>();
  const key = (ref: any) => `${mocks.session.user.id}:${ref.storeTenant}:${ref.conversationId}`;
  mocks.readDraft.mockImplementation(async (_ticket, ref) => drafts.get(key(ref)) ?? null);
  mocks.saveDraft.mockImplementation(async (_ticket, ref, request) => {
    const saved = { ...request, revision: request.expectedRevision + 1, conversationRevision: request.expectedConversationRevision };
    drafts.set(key(ref), saved); return saved;
  });
  email.preview.from = { email: 'owner-support@example.test' };
  email.preview.to = [{ email: 'requester@example.test' }]; email.preview.cc = []; email.preview.subject = 'Requester arrangements';
  mocks.sendEmail.mockImplementation(async (_ticket, ref, operationId) => {
    drafts.set(key(ref), { revision: drafts.get(key(ref)).revision + 1, content: null, email: null });
    return { operationId, status: 'delivered' };
  });
  return { drafts, selected, resource: { kind: 'ticket' as const, tenant: 'owner', id: 'ticket', relationshipId: 'relationship' } };
}

it('co-managed Requester saves its own draft across navigation and reload without persisting untouched recipient defaults', async () => {
  const f = requesterEmailFixture();
  const view = render(<CoManagedNamedTicketConversation resource={f.resource} />);
  const editor = await screen.findByLabelText('Message');
  expect(screen.getByLabelText('To')).toHaveValue('requester@example.test');
  expect(mocks.saveDraft).not.toHaveBeenCalled();
  expect(screen.getByRole('navigation').querySelector('button')).not.toHaveTextContent('Draft');
  fireEvent.change(editor, { target: { value: 'Requester-only draft' } });
  await waitFor(() => expect(f.drafts.get('author:owner:requester')?.content.document[0].content[0].text).toBe('Requester-only draft'));
  fireEvent.click(screen.getByRole('button', { name: /Diagnostics/ }));
  await waitFor(() => expect(mocks.push).toHaveBeenCalledOnce());
  mocks.query = 'conversation=private&conversationStore=home'; view.rerender(<CoManagedNamedTicketConversation resource={f.resource} />);
  await waitFor(() => expect(screen.getByLabelText('Message')).toHaveValue(''));
  mocks.query = ''; view.rerender(<CoManagedNamedTicketConversation resource={f.resource} />);
  await waitFor(() => expect(screen.getByLabelText('Message')).toHaveValue('Requester-only draft'));
  view.unmount();
  const restored = render(<CoManagedNamedTicketConversation resource={f.resource} />);
  expect(await screen.findByLabelText('Message')).toHaveValue('Requester-only draft');
  restored.unmount(); mocks.session.user.id = 'other-author';
  render(<CoManagedNamedTicketConversation resource={f.resource} />);
  expect(await screen.findByLabelText('Message')).toHaveValue('');
  expect(mocks.sendEmail).not.toHaveBeenCalled(); expect(mocks.post).not.toHaveBeenCalled();
});

it('co-managed Requester replies through private drafts and reviewed Send while blocking history edits during review', async () => {
  const f = requesterEmailFixture();
  render(<CoManagedNamedTicketConversation resource={f.resource} />);
  fireEvent.change(await screen.findByLabelText('Message'), { target: { value: 'Reviewed requester answer' } });
  await waitFor(() => expect(mocks.requesterProps.mock.calls.at(-1)[0].composition.ready).toBe(true));
  await act(async () => { expect(await mocks.requesterProps.mock.calls.at(-1)[0].composition.reply({ threadId: 'thread', commentId: 'source' })).toBe(true); });
  expect(f.drafts.get('author:owner:requester').parent).toEqual({ threadId: 'thread', commentId: 'source' });
  fireEvent.click(screen.getByRole('button', { name: 'Review email' }));
  await screen.findByTitle('Email body preview');
  expect(mocks.prepareEmail.mock.calls[0][1]).toEqual({ storeTenant: 'owner', conversationId: 'requester' });
  expect(mocks.sendEmail).not.toHaveBeenCalled(); expect(screen.getByLabelText('Message')).toBeDisabled();
  await act(async () => { expect(await mocks.requesterProps.mock.calls.at(-1)[0].composition.beforeEdit()).toBe(false); });
  fireEvent.click(screen.getByRole('button', { name: /Diagnostics/ })); expect(mocks.push).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Send email' }));
  await screen.findByText('Email sent.');
  await waitFor(() => expect(mocks.requesterProps.mock.calls.at(-1)[0].composition.refreshVersion).toBe(1));
  expect(screen.getByLabelText('Message')).toHaveValue('');
  expect(mocks.sendEmail).toHaveBeenCalledOnce(); expect(mocks.post).not.toHaveBeenCalled();
});

it.each([{ writeAudiences: ['requester', 'organization_private'] }, { writeAudiences: ['requester'] }])('creates an additional requester email conversation without publishing ($writeAudiences)', async ({ writeAudiences }) => {
  mocks.query = '';
  mocks.load.mockResolvedValue({ conversations: [requester], writeAudiences, actor: { tenant: 'home', userId: 'author' } });
  const additional = { ...requester, conversationId: 'additional', name: 'Migration updates', defaultSlot: null };
  mocks.create.mockRejectedValueOnce(new Error('Lost creation acknowledgement')).mockResolvedValue(additional);
  render(<Harness />);
  fireEvent.click(await screen.findByRole('button', { name: 'New conversation' }));
  const audience = await screen.findByLabelText('Visible to');
  if (writeAudiences.includes('organization_private')) expect(audience).toHaveValue('organization_private');
  fireEvent.change(audience, { target: { value: 'requester' } });
  expect(screen.getByLabelText('Conversation type')).toHaveValue('email');
  expect(screen.getByLabelText('Conversation type')).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Migration updates' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create conversation' }));
  await screen.findByText('Could not confirm creation. Retry to check the same request.');
  fireEvent.click(screen.getByRole('button', { name: 'Create conversation' }));
  await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
  expect(mocks.create.mock.calls[1]).toEqual(mocks.create.mock.calls[0]);
  expect(mocks.create.mock.calls[0]).toEqual([ticket, { operationId: expect.any(String), name: 'Migration updates', audience: 'requester', transport: 'email' }]);
  await waitFor(() => expect(mocks.push).toHaveBeenCalledWith(expect.stringContaining('conversation=additional'), { scroll: false }));
  expect(mocks.sendEmail).not.toHaveBeenCalled(); expect(mocks.post).not.toHaveBeenCalled(); expect(mocks.saveDraft).not.toHaveBeenCalled();
});

it('ignores a prior session’s late conversation creation response', async () => {
  const pending = deferred(); mocks.query = '';
  mocks.load.mockResolvedValue({ conversations: [requester], writeAudiences: ['requester'], actor: { tenant: 'home', userId: 'author' } });
  mocks.create.mockReturnValue(pending.promise);
  const view = render(<Harness />);
  fireEvent.click(await screen.findByRole('button', { name: 'New conversation' }));
  fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Prior session exchange' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create conversation' }));
  await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
  mocks.session = { session_id: 'new-session', user: { tenant: 'home', id: 'another-author' } };
  mocks.load.mockResolvedValue({ conversations: [requester], writeAudiences: ['requester'], actor: { tenant: 'home', userId: 'another-author' } });
  view.rerender(<Harness />);
  await act(async () => pending.resolve({ ...requester, conversationId: 'prior-session', name: 'Prior session exchange', defaultSlot: null }));
  expect(mocks.push).not.toHaveBeenCalled(); expect(screen.queryByText('Prior session exchange')).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('shows labelled All activity with resolution markers and routes replies to their source instead of broadcasting', async () => {
  mocks.query = 'conversationView=all';
  mocks.activity.mockResolvedValue({ items: [{ conversation: side, storeTenant: 'home', commentId: 'message', threadId: 'thread',
    createdAt: '2026-09-08T10:00:00.000001Z', note: 'Diagnostic outcome', deleted: false, isResolution: true, audience: 'organization_private' }], nextBefore: null });
  render(<Harness />);
  await screen.findByText('Diagnostic outcome'); expect(screen.getByText('Resolution')).toBeInTheDocument();
  expect(screen.getByText('Diagnostics · Your organization only')).toBeInTheDocument();
  expect(screen.queryByLabelText('Message')).toBeNull(); expect(mocks.readDraft).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
  await waitFor(() => expect(mocks.push).toHaveBeenCalled());
  const query = new URL(mocks.push.mock.calls[0][0], 'https://alga.test').searchParams;
  expect(Object.fromEntries(query)).toEqual({ conversation: 'private', conversationStore: 'home', replyTo: 'message', replyThread: 'thread' });
  expect(mocks.post).not.toHaveBeenCalled(); expect(mocks.sendEmail).not.toHaveBeenCalled();
});
it('admits a linked reply before changing its private draft and consumes the link only after saving', async () => {
  mocks.query += '&replyTo=parent&replyThread=thread';
  mocks.readDraft.mockResolvedValue({ revision: 1, conversationRevision: 1, content: { text: 'Existing private draft' } });
  render(<Harness />); await waitFor(() => expect(mocks.replace).toHaveBeenCalled());
  expect(mocks.replyTarget).toHaveBeenCalledWith(ticket, { storeTenant: 'home', conversationId: 'private' }, { commentId: 'parent', threadId: 'thread' });
  expect(mocks.saveDraft.mock.calls.at(-1)[2]).toMatchObject({ content: { text: 'Existing private draft' }, parent: { commentId: 'parent', threadId: 'thread' } });
  expect(mocks.replace.mock.calls[0][0]).not.toContain('replyTo'); expect(mocks.post).not.toHaveBeenCalled();
});
it('keeps the saved draft intact when a linked reply target is no longer authorized', async () => {
  mocks.query += '&replyTo=parent&replyThread=thread'; mocks.replyTarget.mockRejectedValue(new Error('Access revoked'));
  mocks.readDraft.mockResolvedValue({ revision: 1, conversationRevision: 1, content: { text: 'Existing private draft' } });
  render(<Harness />); await screen.findByText('This reply target is unavailable. Your saved draft is unchanged.');
  expect(mocks.saveDraft).not.toHaveBeenCalled(); expect(screen.getByLabelText('Message')).toHaveValue('Existing private draft');
  expect(mocks.replace).not.toHaveBeenCalled();
});

it('keeps loaded All activity pages on refresh and clears their bodies after a denied refresh', async () => {
  mocks.query = 'conversationView=all';
  const cursor = { createdAt: '2026-09-08T10:00:00.000001Z', storeTenant: 'home', commentId: 'new' };
  const item = (commentId: string) => ({ conversation: side, storeTenant: 'home', commentId, threadId: 'thread',
    createdAt: '2026-09-08T10:00:00.000001Z', note: `${commentId} message`, deleted: false, audience: 'organization_private' });
  mocks.activity.mockImplementation(async (_ticket, before) => ({ items: [item(before ? 'older' : 'new')], nextBefore: before ? null : cursor }));
  render(<Harness />); await screen.findByText('new message');
  fireEvent.click(screen.getByRole('button', { name: 'Load earlier messages' })); await screen.findByText('older message');
  fireEvent.focus(window); await waitFor(() => expect(mocks.activity).toHaveBeenCalledTimes(4));
  expect(screen.getByText('older message')).toBeInTheDocument();
  mocks.activity.mockRejectedValue(new Error('Access revoked'));
  fireEvent.focus(window); await screen.findByRole('alert');
  expect(screen.queryByText('older message')).toBeNull(); expect(screen.queryByText('new message')).toBeNull();
  expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
});

it('privately retains a native requester resolution marker and shows it in the locked email review', async () => {
  const f = emailFixture();
  const selected = { ...f.emailSide, storeTenant: 'owner', audience: 'requester', mailbox: { id: 'mailbox', tenant: 'owner' } };
  mocks.session.user.tenant = 'owner'; mocks.query = 'conversation=private&conversationStore=owner';
  mocks.load.mockResolvedValue({ conversations: [requester, selected], writeAudiences: ['requester'], actor: { tenant: 'owner', userId: 'author' } });
  mocks.page.mockResolvedValue({ conversation: selected, items: [], nextBefore: null });
  mocks.capabilities.mockResolvedValue({ resolution: true });
  mocks.prepareEmail.mockImplementation(async (_ticket, _ref, request) => ({ operationId: request.operationId, status: 'reviewed', review: f.preview, publicationOptions: f.draft().publicationOptions }));
  const first = render(<Harness />); await writeEmail();
  fireEvent.click(screen.getByLabelText('Mark as resolution'));
  await waitFor(() => expect(f.draft().publicationOptions).toEqual({ isResolution: true }));
  expect(mocks.sendEmail).not.toHaveBeenCalled(); first.unmount(); render(<Harness />);
  expect(await screen.findByLabelText('Mark as resolution')).toBeChecked();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Review email' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Review email' }));
  await screen.findByText('This message will be marked as a resolution.');
  expect(screen.getByLabelText('Mark as resolution')).toBeDisabled(); expect(mocks.sendEmail).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Send email' }));
  await waitFor(() => expect(screen.getByLabelText('Mark as resolution')).not.toBeChecked());
});

it('keeps close intent and the draft after a blocked Send and reviews an explicit permitted override', async () => {
  const f = emailFixture();
  const selected = { ...f.emailSide, storeTenant: 'owner', audience: 'requester', mailbox: { id: 'mailbox', tenant: 'owner' } };
  mocks.session.user.tenant = 'owner'; mocks.query = 'conversation=private&conversationStore=owner';
  mocks.load.mockResolvedValue({ conversations: [requester, selected], writeAudiences: ['requester'], actor: { tenant: 'owner', userId: 'author' } });
  mocks.page.mockResolvedValue({ conversation: selected, items: [], nextBefore: null });
  mocks.capabilities.mockResolvedValue({ resolution: true, closeStatuses: [{ value: 'closed', label: 'Resolved' }], canOverrideClose: true });
  mocks.prepareEmail.mockImplementation(async (_ticket, _ref, request) => ({ operationId: request.operationId, status: 'reviewed', review: f.preview, publicationOptions: f.draft().publicationOptions }));
  mocks.sendEmail.mockResolvedValueOnce({ status: 'close_blocked', failedRules: ['time_entry'] });
  const first = render(<Harness />); await writeEmail();
  fireEvent.click(screen.getByLabelText('Mark as resolution'));
  fireEvent.change(screen.getByLabelText('After sending'), { target: { value: 'closed' } });
  await waitFor(() => expect(f.draft().publicationOptions).toEqual({ isResolution: true, close: { statusId: 'closed' } }));
  first.unmount(); render(<Harness />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Review email' })).toBeEnabled());
  expect(screen.getByLabelText('After sending')).toHaveValue('closed');
  fireEvent.click(screen.getByRole('button', { name: 'Review email' }));
  await screen.findByText(/The ticket will close when this send is accepted/);
  expect(screen.getByRole('dialog')).toHaveTextContent('Resolved');
  fireEvent.click(screen.getByRole('button', { name: 'Send email' }));
  await screen.findByText('Log a time entry.');
  expect(screen.getByRole('alert')).toHaveTextContent('Nothing was sent.');
  expect(mocks.onPublished).not.toHaveBeenCalled();
  expect(f.draft().content).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Back to draft' }));
  fireEvent.click(screen.getByLabelText('Override unmet close rules'));
  fireEvent.change(screen.getByLabelText('Override reason'), { target: { value: 'Recorded with the incident.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review email' }));
  await screen.findByText(/Override unmet close rules: Recorded with the incident/);
  expect(mocks.prepareEmail.mock.calls[1][2].expectedDraftRevision).toBeGreaterThan(mocks.prepareEmail.mock.calls[0][2].expectedDraftRevision);
  expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Send email' }));
  await waitFor(() => expect(screen.getByLabelText('Mark as resolution')).not.toBeChecked());
  expect(screen.queryByLabelText('After sending')).toBeNull();
  await waitFor(() => expect(mocks.onPublished).toHaveBeenCalledOnce());
});

it('uses the default Requester private composer while keeping history edits and refreshes independent', async () => {
  const f = scheduledEmailFixture(); mocks.query = '';
  mocks.load.mockResolvedValue({ conversations: [{ ...requester, mailbox: { id: 'mailbox', tenant: 'owner' } }, side], writeAudiences: ['requester', 'organization_private'], actor: { tenant: 'owner', userId: 'author' } });
  mocks.details.mockResolvedValue([{ commentId: 'source', email: { ...f.preview, delivery: 'delivered' }, attachments: [{ attachmentId: 'selected-file', storeTenant: 'owner', commentId: 'source', threadId: 'root', fileName: 'Reviewed attachment.txt' }] }]);
  render(<NativeHarness />); await writeEmail();
  const file = await screen.findByRole('link', { name: 'Reviewed attachment.txt' });
  const query = new URL(file.getAttribute('href')!, 'https://local.test').searchParams;
  expect(Object.fromEntries(query)).toEqual({ ticketTenant: 'owner', ticketId: 'ticket', conversationId: 'requester', storeTenant: 'owner', threadId: 'root', commentId: 'source' });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Edit old reply' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Reply from history' }));
  await waitFor(() => expect(f.draft().parent).toEqual({ commentId: 'source', threadId: 'root' }));
  expect(mocks.saveDraft.mock.calls.at(-1)[1]).toEqual({ storeTenant: 'owner', conversationId: 'requester' });
  fireEvent.focus(window); await waitFor(() => expect(mocks.load.mock.calls.length).toBeGreaterThan(1));
  expect(mocks.readDraft).toHaveBeenCalledOnce(); expect(screen.getByLabelText('Message')).toHaveValue('Selected vendor question');
  fireEvent.click(screen.getByRole('button', { name: 'Edit old reply' }));
  await screen.findByRole('button', { name: 'Finish history edit' });
  expect(screen.getByLabelText('Message')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: /Diagnostics/ }));
  expect(mocks.push).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Finish history edit' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Review email' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Review email' })); await screen.findByRole('dialog');
  expect(screen.getByRole('button', { name: 'Edit old reply' })).toBeDisabled();
  expect(mocks.sendEmail).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Send email' }));
  await waitFor(() => expect(mocks.onPublished).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.getByLabelText('Message')).toHaveValue(''));
  expect(mocks.sendEmail.mock.calls[0][1]).toEqual({ storeTenant: 'owner', conversationId: 'requester' });
  expect(mocks.schedules).not.toHaveBeenCalled(); // Native history already owns scheduled rows.
});

it('discards late default Requester details after a session change and displays a denied-refresh recovery', async () => {
  scheduledEmailFixture(); mocks.query = '';
  mocks.load.mockResolvedValue({ conversations: [requester], writeAudiences: ['requester'], actor: { tenant: 'owner', userId: 'author' } });
  const old = deferred(); mocks.details.mockReturnValueOnce(old.promise);
  const view = render(<NativeHarness />);
  await waitFor(() => expect(mocks.details).toHaveBeenCalledOnce());
  mocks.details.mockRejectedValue(new Error('Current details unavailable'));
  mocks.session = { session_id: 'next-session', user: { tenant: 'owner', id: 'next-author' } };
  view.rerender(<NativeHarness />);
  await screen.findByText('Email and attachment details are unavailable.');
  await act(async () => old.resolve([{ commentId: 'source', email: null, attachments: [{ attachmentId: 'late', fileName: 'Late attachment.txt', storeTenant: 'owner', commentId: 'source', threadId: 'root' }] }]));
  expect(screen.queryByRole('link', { name: 'Late attachment.txt' })).toBeNull();
  mocks.details.mockResolvedValue([]); fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(screen.queryByText('Email and attachment details are unavailable.')).toBeNull());
});

it('shows qualified unread counts and changes following without reloading an edited private draft', async () => {
  const attention = { following: false, attentionVersion: '4', lastReadVersion: '1', unreadCount: 3 };
  const load = (following: boolean) => ({ conversations: [{ ...requester, attention: { ...attention, unreadCount: 1 } }, { ...side, attention: { ...attention, following } }], writeAudiences: ['organization_private'] });
  mocks.load.mockResolvedValue(load(false));
  render(<Harness />);
  const editor = await screen.findByLabelText('Message');
  expect(within(screen.getByRole('button', { name: /Diagnostics/ })).getByLabelText('3 unread')).toBeTruthy();
  fireEvent.change(editor, { target: { value: 'Keep my current draft.' } });
  await waitFor(() => expect(mocks.saveDraft).toHaveBeenCalled());
  const reads = mocks.readDraft.mock.calls.length;
  mocks.load.mockResolvedValue(load(true));
  fireEvent.click(screen.getByRole('button', { name: 'Follow', exact: true }));
  await screen.findByRole('button', { name: 'Following', pressed: true });
  expect(mocks.preference).toHaveBeenCalledWith(ticket, { storeTenant: 'home', conversationId: 'private' }, { following: true });
  expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toBe('Keep my current draft.');
  expect(mocks.readDraft).toHaveBeenCalledTimes(reads);
  expect(mocks.post).not.toHaveBeenCalled(); expect(mocks.sendEmail).not.toHaveBeenCalled();
  mocks.load.mockResolvedValue(load(false));
  fireEvent.click(screen.getByRole('button', { name: 'Following' }));
  await screen.findByRole('button', { name: 'Follow', exact: true });
  expect(mocks.preference).toHaveBeenLastCalledWith(ticket, { storeTenant: 'home', conversationId: 'private' }, { following: false });
});

it('marks only the displayed conversation snapshot read and preserves a later reply and sibling unread count', async () => {
  const pending = deferred(); mocks.preference.mockReturnValueOnce(pending.promise);
  const attention = { following: false, attentionVersion: '4', lastReadVersion: '1', unreadCount: 3 };
  mocks.load.mockResolvedValue({ conversations: [{ ...requester, attention }, { ...side, attention }], writeAudiences: ['organization_private'] });
  render(<Harness />); await screen.findByLabelText('Message');
  expect(mocks.preference).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Mark as read' }));
  expect(mocks.preference).toHaveBeenCalledWith(ticket, { storeTenant: 'home', conversationId: 'private' }, { readThrough: '4' });
  mocks.load.mockResolvedValue({ conversations: [{ ...requester, attention }, { ...side, attention: { ...attention, attentionVersion: '5', lastReadVersion: '4', unreadCount: 1 } }], writeAudiences: ['organization_private'] });
  await act(async () => pending.resolve(undefined));
  await waitFor(() => expect(within(screen.getByRole('button', { name: /Diagnostics/ })).getByLabelText('1 unread')).toBeTruthy());
  expect(within(screen.getByRole('button', { name: /Requester/ })).getByLabelText('3 unread')).toBeTruthy();
  expect(mocks.preference).toHaveBeenCalledTimes(1);
});

it('retries the original read cursor after failure and drops controls and counts when access is lost', async () => {
  const attention = { following: false, attentionVersion: '4', lastReadVersion: '1', unreadCount: 3 };
  mocks.load.mockResolvedValue({ conversations: [requester, { ...side, attention }], writeAudiences: ['organization_private'] });
  mocks.preference.mockRejectedValueOnce(new Error('Lost acknowledgment'));
  const view = render(<Harness />); await screen.findByLabelText('Message');
  fireEvent.click(screen.getByRole('button', { name: 'Mark as read' }));
  await screen.findByText('Could not update your conversation preference.');
  mocks.load.mockResolvedValue({ conversations: [requester, { ...side, attention: { ...attention, attentionVersion: '5' } }], writeAudiences: ['organization_private'] });
  fireEvent.focus(window);
  await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
  const pending = deferred(); mocks.preference.mockReturnValueOnce(pending.promise);
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(mocks.preference).toHaveBeenLastCalledWith(ticket, { storeTenant: 'home', conversationId: 'private' }, { readThrough: '4' });
  mocks.load.mockResolvedValue({ conversations: [requester], writeAudiences: [] });
  mocks.session = { session_id: 'replacement-session', user: { tenant: 'home', id: 'other-author' } };
  view.rerender(<Harness />);
  await waitFor(() => expect(screen.queryByRole('button', { name: /Diagnostics/ })).toBeNull());
  const reads = mocks.load.mock.calls.length;
  await act(async () => pending.resolve(undefined));
  expect(mocks.load).toHaveBeenCalledTimes(reads);
  expect(screen.queryByLabelText('3 unread')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Following' })).toBeNull();
});

it('acknowledges a selected side history only after its messages load and leaves All activity unread', async () => {
  const focused = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  const row = { commentId: 'loaded', threadId: 'loaded-root', storeTenant: 'home', note: 'Loaded diagnostic message', markdown: null,
    audience: 'organization_private', deleted: false, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', attachments: [], email: null };
  const pending = deferred(); mocks.page.mockReturnValueOnce(pending.promise);
  try {
    const rendered = render(<Harness />);
    await screen.findAllByText('Diagnostics');
    expect(mocks.acknowledge).not.toHaveBeenCalled();
    await act(async () => pending.resolve({ conversation: side, items: [row], nextBefore: null }));
    await screen.findByText('Loaded diagnostic message');
    await waitFor(() => expect(mocks.acknowledge).toHaveBeenCalledOnce());
    expect(mocks.acknowledge).toHaveBeenCalledWith(ticket, { conversationId: 'private', storeTenant: 'home' }, [{ commentId: 'loaded', threadId: 'loaded-root' }]);
    mocks.query = 'conversationView=all';
    mocks.activity.mockResolvedValue({ items: [{ ...row, conversation: side }], nextBefore: null });
    rendered.rerender(<Harness />);
    await screen.findByText('All activity', { selector: 'h2' });
    await screen.findByText('Loaded diagnostic message');
    expect(mocks.acknowledge).toHaveBeenCalledOnce();
  } finally { focused.mockRestore(); }
});

it('acknowledges native requester history after its current source details are admitted', async () => {
  mocks.query = '';
  const focused = vi.spyOn(document, 'hasFocus').mockReturnValue(true), pending = deferred();
  mocks.details.mockReturnValueOnce(pending.promise);
  try {
    render(<NativeHarness />);
    await waitFor(() => expect(mocks.details).toHaveBeenCalled());
    expect(mocks.acknowledge).not.toHaveBeenCalled();
    await act(async () => pending.resolve([{ commentId: 'source', attachments: [], email: null }]));
    await waitFor(() => expect(mocks.acknowledge).toHaveBeenCalledOnce());
    expect(mocks.acknowledge).toHaveBeenCalledWith(ticket, { conversationId: 'requester', storeTenant: 'owner' }, [{ commentId: 'source', threadId: 'root' }]);
  } finally { focused.mockRestore(); }
});

it('loads an exact older message and keeps the composer draft when returning to latest or visiting an unavailable target', async () => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  const row = { commentId: 'older', threadId: 'root', storeTenant: 'home', note: 'Linked older message', markdown: null,
    createdAt: '2026-09-08T10:00:00.000001Z', deleted: false, audience: 'organization_private' };
  mocks.query += '&message=older&tab=details';
  mocks.page.mockResolvedValue({ conversation: side, items: [row], nextBefore: null, focusedMessageId: 'older' });
  try {
    const view = render(<Harness />); await screen.findByLabelText('Message');
    expect(mocks.page).toHaveBeenCalledWith(ticket, { conversationId: 'private', storeTenant: 'home' }, undefined, 'older');
    await waitFor(() => expect(screen.getByText('Linked older message').closest('article')).toHaveFocus());
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Keep these edits' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show latest messages' }));
    const requested = new URL(mocks.push.mock.calls.at(-1)![0], 'https://example.test');
    expect(requested.searchParams.has('message')).toBe(false); expect(requested.searchParams.get('conversation')).toBe('private');
    expect(requested.searchParams.get('tab')).toBe('details'); expect(screen.getByLabelText('Message')).toHaveValue('Keep these edits');
    mocks.query = 'conversation=private&conversationStore=home&message=missing';
    mocks.page.mockResolvedValue({ conversation: side, items: [{ ...row, commentId: 'new', note: 'Newest unread reply' }], nextBefore: null, messageUnavailable: true });
    const before = mocks.acknowledge.mock.calls.length; view.rerender(<Harness />);
    await screen.findByText('This message is unavailable in this conversation.');
    expect(screen.getByLabelText('Message')).toHaveValue('Keep these edits');
    expect(mocks.acknowledge.mock.calls.length).toBe(before);
    expect(mocks.post).not.toHaveBeenCalled();
  } finally { focus.mockRestore(); }
});


it('passes an exact native requester focus only after the selected history has loaded successfully', async () => {
  mocks.query = 'message=source'; const details = deferred(); mocks.details.mockReturnValue(details.promise);
  const view = render(<NativeHarness />); await screen.findByLabelText('Native focused message');
  expect(screen.getByLabelText('Native focused message')).toBeEmptyDOMElement();
  await act(async () => details.resolve([{ commentId: 'source', threadId: 'root' }]));
  await waitFor(() => expect(screen.getByLabelText('Native focused message')).toHaveTextContent('source'));
  mocks.query = 'conversation=requester&conversationStore=owner&message=unknown'; view.rerender(<NativeHarness />);
  expect(screen.getByLabelText('Native focused message')).toBeEmptyDOMElement();
  await screen.findByText('This message is unavailable in this conversation.');
});

const shareMessage = { storeTenant: 'home', commentId: 'source-message', threadId: 'source-root', parentCommentId: null,
  audience: 'organization_private', createdAt: '2026-09-01T10:00:00Z', updatedAt: null, revision: 1, deleted: false,
  note: 'Original private message', markdown: 'Original private message', attachments: [
    { storeTenant: 'home', commentId: 'source-message', threadId: 'source-root', attachmentId: 'selected-file', fileName: 'Selected report.txt', mimeType: 'text/plain', size: 12, audience: 'organization_private' },
    { storeTenant: 'home', commentId: 'source-message', threadId: 'source-root', attachmentId: 'other-file', fileName: 'Other report.txt', mimeType: 'text/plain', size: 16, audience: 'organization_private' },
  ] };
const shareSelection = { conversation: { storeTenant: 'home', conversationId: 'private' }, commentId: 'source-message', threadId: 'source-root' };

it('flushes and pauses the source editor, defaults sharing to Requester, and reloads a replaced same-conversation draft', async () => {
  mocks.page.mockResolvedValue({ conversation: side, items: [shareMessage], nextBefore: null });
  const drafts: Record<string, any> = { private: { content: { text: 'Earlier source draft' }, revision: 4, conversationRevision: 1 } };
  mocks.readDraft.mockImplementation(async (_ticket, ref) => drafts[ref.conversationId] ?? null);
  mocks.saveDraft.mockImplementation(async (_ticket, ref, request) => {
    const draft = { content: request.content, revision: request.expectedRevision + 1, conversationRevision: 1 };
    drafts[ref.conversationId] = draft; return draft;
  });
  mocks.share.mockImplementation(async (_ticket, ref, request) => {
    const draft = { content: { text: 'Copied source ready for editing' }, revision: request.expectedDraftRevision + 1, conversationRevision: 1 };
    drafts[ref.conversationId] = draft; return { ok: true, draft };
  });
  render(<Harness />);
  fireEvent.change(await screen.findByLabelText('Message'), { target: { value: 'Unsaved latest source draft' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Share' })).toBeEnabled()); fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  const dialog = await screen.findByRole('dialog');
  await waitFor(() => expect(within(dialog).getByLabelText('Destination')).toHaveValue('owner:requester'));
  expect(screen.getByLabelText('Message')).toBeDisabled();
  expect(within(dialog).getByLabelText('Selected report.txt')).not.toBeChecked();
  expect(within(dialog).getByLabelText('Other report.txt')).not.toBeChecked();
  fireEvent.change(within(dialog).getByLabelText('Destination'), { target: { value: 'home:private' } });
  await within(dialog).findByText('You already have a draft here.');
  expect(mocks.share).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByLabelText('Selected report.txt'));
  fireEvent.click(within(dialog).getByLabelText('Format as a quote'));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Replace draft and prepare copy' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(screen.getByLabelText('Message')).toHaveValue('Copied source ready for editing'));
  expect(mocks.share).toHaveBeenCalledOnce();
  expect(mocks.share.mock.calls[0]).toMatchObject([ticket, { storeTenant: 'home', conversationId: 'private' }, {
    source: shareSelection.conversation, commentId: 'source-message', threadId: 'source-root',
    expectedDraftRevision: 5, expectedConversationRevision: 1, replaceExisting: true, quote: true, attachments: [{ attachmentId: 'selected-file' }],
  }]);
  expect(mocks.saveDraft).toHaveBeenCalledOnce();
  expect(mocks.prepareEmail).not.toHaveBeenCalled(); expect(mocks.sendEmail).not.toHaveBeenCalled(); expect(mocks.post).not.toHaveBeenCalled();
});

it('creates a requester-directed sharing destination once after an uncertain result and retains explicit recipients without sending', async () => {
  mocks.page.mockResolvedValue({ conversation: side, items: [shareMessage], nextBefore: null });
  const created = { ...requester, conversationId: 'new-requester', defaultSlot: null, name: 'Delivery update' };
  mocks.create.mockRejectedValueOnce(new Error('Lost creation acknowledgement')).mockResolvedValue(created);
  const onOpen = vi.fn();
  render(<ConversationShareDialog id="share" ticket={ticket} selection={shareSelection} onClose={vi.fn()} onOpen={onOpen} />);
  fireEvent.change(await screen.findByLabelText('Destination'), { target: { value: '__new__' } });
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Delivery update' } });
  expect(screen.getByRole('button', { name: 'Prepare draft' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('To'), { target: { value: 'Requester <requester@example.test>; colleague@example.test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Prepare draft' }));
  await screen.findByText('Could not confirm preparation. Retry the same request, or open the destination to check its draft.');
  expect(screen.getByLabelText('Name')).toBeDisabled(); expect(mocks.share).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry preparation' }));
  await waitFor(() => expect(onOpen).toHaveBeenCalledWith(created));
  expect(mocks.create.mock.calls[1]).toEqual(mocks.create.mock.calls[0]);
  expect(mocks.create.mock.calls[0][1]).toMatchObject({ name: 'Delivery update', audience: 'requester', transport: 'email' });
  expect(mocks.share.mock.calls[0][2]).toMatchObject({ expectedDraftRevision: 0, replaceExisting: false, attachments: [],
    email: { subject: 'Delivery update', to: ['Requester <requester@example.test>', 'colleague@example.test'], cc: [] } });
  expect(mocks.prepareEmail).not.toHaveBeenCalled(); expect(mocks.sendEmail).not.toHaveBeenCalled(); expect(mocks.post).not.toHaveBeenCalled();
});

it('discards a late destination load and requires a fresh explicit replacement after a sharing conflict', async () => {
  mocks.page.mockResolvedValue({ conversation: side, items: [shareMessage], nextBefore: null });
  const oldDestination = deferred();
  mocks.getConversation.mockImplementationOnce(() => oldDestination.promise).mockResolvedValue(side);
  mocks.readDraft.mockImplementation(async (_ticket, ref) => ref.conversationId === 'private' ? { content: { text: 'Current draft' }, revision: 4, conversationRevision: 1 } : null);
  mocks.share.mockResolvedValueOnce({ ok: false, code: 'conflict' }).mockResolvedValue({ ok: true, draft: { revision: 6 } });
  const onOpen = vi.fn();
  render(<ConversationShareDialog id="share" ticket={ticket} selection={shareSelection} onClose={vi.fn()} onOpen={onOpen} />);
  fireEvent.change(await screen.findByLabelText('Destination'), { target: { value: 'home:private' } });
  await screen.findByText('You already have a draft here.');
  await act(async () => oldDestination.resolve(requester));
  expect(screen.getByLabelText('Destination')).toHaveValue('home:private');
  fireEvent.click(screen.getByRole('button', { name: 'Replace draft and prepare copy' }));
  await screen.findByText('The destination draft or conversation changed. Reload it before preparing a copy.');
  expect(onOpen).not.toHaveBeenCalled();
  mocks.readDraft.mockResolvedValue({ content: { text: 'Another tab edited this' }, revision: 5, conversationRevision: 1 });
  fireEvent.click(screen.getByRole('button', { name: 'Reload destination draft' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Replace draft and prepare copy' })).toBeEnabled());
  expect(mocks.share).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Replace draft and prepare copy' }));
  await waitFor(() => expect(onOpen).toHaveBeenCalledWith(side));
  expect(mocks.share.mock.calls[0][2].expectedDraftRevision).toBe(4);
  expect(mocks.share.mock.calls[1][2].expectedDraftRevision).toBe(5);
  expect(mocks.share.mock.calls[1][2].operationId).not.toBe(mocks.share.mock.calls[0][2].operationId);
});

it('retries uncertain sharing with the same operation and ignores completion after an identity change', async () => {
  mocks.page.mockResolvedValue({ conversation: side, items: [shareMessage], nextBefore: null });
  const pending = deferred();
  mocks.share.mockResolvedValueOnce({ ok: false, code: 'unknown' }).mockImplementationOnce(() => pending.promise);
  const view = render(<Harness />);
  await screen.findByLabelText('Message');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Share' })).toBeEnabled()); fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Prepare draft' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Prepare draft' }));
  await screen.findByText('Could not confirm preparation. Retry the same request, or open the destination to check its draft.');
  fireEvent.click(screen.getByRole('button', { name: 'Retry preparation' }));
  await waitFor(() => expect(mocks.share).toHaveBeenCalledTimes(2));
  expect(mocks.share.mock.calls[1]).toEqual(mocks.share.mock.calls[0]);
  mocks.session = { session_id: 'new-session', user: { tenant: 'new-home', id: 'new-author' } };
  mocks.load.mockRejectedValue(new Error('No access'));
  view.rerender(<Harness />);
  await act(async () => pending.resolve({ ok: true, draft: { content: { text: 'Old author private copy' }, revision: 1 } }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(mocks.push).not.toHaveBeenCalled();
  expect(screen.queryByText('Old author private copy')).toBeNull();
});


it('opens an authorized shared source at its exact message after flushing the current draft', async () => {
  const source = { conversation: { storeTenant: 'home', conversationId: 'source-conversation', name: 'Source exchange' }, commentId: 'original-message', threadId: 'original-root' };
  mocks.query += '&view=details';
  mocks.page.mockResolvedValue({ conversation: side, items: [{ ...shareMessage, attachments: [], sharedFrom: source }], nextBefore: null });
  const saved = deferred(); mocks.saveDraft.mockReturnValue(saved.promise);
  render(<Harness />);
  fireEvent.change(await screen.findByLabelText('Message'), { target: { value: 'Keep destination edits' } });
  const link = screen.getByRole('link', { name: 'Shared from Source exchange' });
  expect(link).toHaveAttribute('href', '?conversation=source-conversation&conversationStore=home&view=details&message=original-message');
  fireEvent.click(link);
  await waitFor(() => expect(mocks.saveDraft).toHaveBeenCalledOnce());
  expect(mocks.push).not.toHaveBeenCalled();
  await act(async () => saved.resolve({ content: { text: 'Keep destination edits' }, revision: 1, conversationRevision: 1 }));
  await waitFor(() => expect(mocks.push).toHaveBeenCalledOnce());
  const url = new URL(mocks.push.mock.calls[0][0], 'https://example.test');
  expect(url.searchParams.get('conversation')).toBe('source-conversation');
  expect(url.searchParams.get('conversationStore')).toBe('home');
  expect(url.searchParams.get('message')).toBe('original-message');
  expect(url.searchParams.get('view')).toBe('details');
  expect(mocks.post).not.toHaveBeenCalled(); expect(mocks.sendEmail).not.toHaveBeenCalled();
});

it('allows a readable source to be shared to a writable audience without requiring source write access', async () => {
  mocks.load.mockResolvedValue({ conversations: [requester, side], writeAudiences: ['requester'] });
  mocks.page.mockResolvedValue({ conversation: side, items: [shareMessage], nextBefore: null });
  render(<Harness />);
  const share = await screen.findByRole('button', { name: 'Share' });
  expect(share).toBeEnabled(); expect(screen.queryByLabelText('Message')).toBeNull();
  fireEvent.click(share);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Prepare draft' })).toBeEnabled());
  expect(screen.getByLabelText('Destination')).toHaveValue('owner:requester');
  expect(within(screen.getByLabelText('Destination')).queryByRole('option', { name: /Diagnostics/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Prepare draft' }));
  await waitFor(() => expect(mocks.share).toHaveBeenCalledOnce());
  expect(mocks.share.mock.calls[0][1]).toEqual({ storeTenant: 'owner', conversationId: 'requester' });
  expect(mocks.share.mock.calls[0][2].source).toEqual({ storeTenant: 'home', conversationId: 'private' });
});

it('selects a prepared destination immediately while its private draft and URL navigation are still loading', async () => {
  const destination = { ...side, conversationId: 'prepared-destination', name: 'Prepared destination' };
  mocks.load.mockResolvedValue({ conversations: [requester, side, destination], writeAudiences: ['requester', 'organization_private'] });
  mocks.getConversation.mockImplementation(async (_ticket, ref) => ref.conversationId === destination.conversationId ? destination : requester);
  mocks.page.mockImplementation(async (_ticket, ref) => ({ conversation: ref.conversationId === destination.conversationId ? destination : side,
    items: ref.conversationId === destination.conversationId ? [] : [shareMessage], nextBefore: null }));
  const draft = deferred(); let prepared = false;
  mocks.readDraft.mockImplementation(async (_ticket, ref) => prepared && ref.conversationId === destination.conversationId ? draft.promise : null);
  mocks.share.mockImplementation(async () => { prepared = true; return { ok: true, draft: { content: { text: 'Prepared draft content' }, revision: 1 } }; });
  const view = render(<Harness />);
  await screen.findByLabelText('Message'); await waitFor(() => expect(screen.getByRole('button', { name: 'Share' })).toBeEnabled()); fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  fireEvent.change(await screen.findByLabelText('Destination'), { target: { value: 'home:prepared-destination' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Prepare draft' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Prepare draft' }));
  await screen.findByRole('heading', { name: 'Prepared destination' });
  expect(screen.queryByRole('dialog')).toBeNull();
  await act(async () => draft.resolve({ content: { text: 'Prepared draft content' }, revision: 1, conversationRevision: 1 }));
  await waitFor(() => expect(screen.getByLabelText('Message')).toHaveValue('Prepared draft content'));
  mocks.query = 'conversation=prepared-destination&conversationStore=home'; view.rerender(<Harness />);
  expect(screen.getByLabelText('Message')).toHaveValue('Prepared draft content');
  expect(mocks.saveDraft).not.toHaveBeenCalled();
});

it('generates from the full selected conversation into an explicit requester destination without publishing', async () => {
  const opened = vi.fn();
  mocks.synthesis.mockResolvedValue({ ok: true, result: { status: 'completed', sourceChanged: false } });
  render(<ConversationShareDialog id="synthesis" ticket={ticket} selection={{ kind: 'synthesis', conversation: shareSelection.conversation }} onClose={vi.fn()} onOpen={opened} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Generate draft' })).toBeEnabled());
  expect(screen.getByLabelText('Destination')).toHaveValue('owner:requester');
  expect(screen.queryByLabelText('Format as a quote')).toBeNull(); expect(screen.queryByLabelText('Selected report.txt')).toBeNull();
  fireEvent.change(screen.getByLabelText('What should the summary focus on? (optional)'), { target: { value: 'Explain the fix and next steps.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Generate draft' }));
  await waitFor(() => expect(opened).toHaveBeenCalledWith(requester));
  expect(mocks.synthesis.mock.calls[0]).toEqual([ticket, { storeTenant: 'owner', conversationId: 'requester' }, {
    operationId: expect.any(String), source: shareSelection.conversation, expectedDraftRevision: 0, expectedConversationRevision: 1,
    replaceExisting: false, prompt: 'Explain the fix and next steps.',
  }]);
  expect(mocks.page).not.toHaveBeenCalled(); expect(mocks.share).not.toHaveBeenCalled();
  expect(mocks.post).not.toHaveBeenCalled(); expect(mocks.sendEmail).not.toHaveBeenCalled();
});

it('preserves explicit new requester recipients and retries an uncertain synthesis using the same operation', async () => {
  const destination = { ...requester, conversationId: 'new-requester', name: 'Resolution update', defaultSlot: null };
  const opened = vi.fn(); mocks.create.mockResolvedValue(destination);
  mocks.synthesis.mockResolvedValueOnce({ ok: false, code: 'unknown' }).mockResolvedValueOnce({ ok: true, result: { status: 'completed' } });
  render(<ConversationShareDialog id="synthesis" ticket={ticket} selection={{ kind: 'synthesis', conversation: shareSelection.conversation }} onClose={vi.fn()} onOpen={opened} />);
  fireEvent.change(await screen.findByLabelText('Destination'), { target: { value: '__new__' } });
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Resolution update' } });
  fireEvent.change(screen.getByLabelText('To'), { target: { value: 'requester@example.test' } });
  fireEvent.change(screen.getByLabelText('CC'), { target: { value: 'manager@example.test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Generate draft' }));
  await screen.findByRole('button', { name: 'Retry generation' });
  expect(screen.getByLabelText('To')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry generation' }));
  await waitFor(() => expect(opened).toHaveBeenCalledWith(destination));
  expect(mocks.create).toHaveBeenCalledOnce(); expect(mocks.synthesis.mock.calls[1]).toEqual(mocks.synthesis.mock.calls[0]);
  expect(mocks.synthesis.mock.calls[0][2].email).toEqual({ subject: 'Resolution update', to: ['requester@example.test'], cc: ['manager@example.test'] });
  expect(mocks.sendEmail).not.toHaveBeenCalled();
});

it('keeps edited drafts on a changed source and requires a refreshed explicit replacement before regeneration', async () => {
  mocks.aiCapability.mockResolvedValue({ available: true });
  mocks.synthesisDraft.mockResolvedValue({ ok: true, result: { operationId: 'previous', source: shareSelection.conversation, sourceChanged: true } });
  mocks.readDraft.mockResolvedValue({ content: { text: 'My revised response' }, revision: 4, conversationRevision: 1 });
  mocks.synthesis.mockResolvedValueOnce({ ok: false, code: 'conflict' }).mockResolvedValueOnce({ ok: true, result: { status: 'completed' } });
  render(<Harness />);
  await screen.findByText('The source conversation changed. Your draft edits are kept; regenerate when you are ready.');
  expect(await screen.findByLabelText('Message')).toHaveValue('My revised response'); expect(mocks.synthesis).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Regenerate summary…' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Replace draft and generate' })).toBeEnabled());
  expect(screen.getByLabelText('Destination')).toHaveValue('home:private');
  fireEvent.click(screen.getByRole('button', { name: 'Replace draft and generate' }));
  await screen.findByText('The destination draft or conversation changed. Reload it before preparing a copy.');
  expect(screen.getByRole('button', { name: 'Retry generation' })).toBeDisabled();
  mocks.readDraft.mockResolvedValue({ content: { text: 'A newer edit' }, revision: 5, conversationRevision: 1 });
  fireEvent.click(screen.getByRole('button', { name: 'Reload destination draft' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Replace draft and generate' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Replace draft and generate' }));
  await waitFor(() => expect(mocks.synthesis).toHaveBeenCalledTimes(2));
  expect(mocks.synthesis.mock.calls[1][2]).toMatchObject({ expectedDraftRevision: 5, replaceExisting: true });
  expect(mocks.synthesis.mock.calls[1][2].operationId).not.toBe(mocks.synthesis.mock.calls[0][2].operationId);
  expect(mocks.post).not.toHaveBeenCalled();
});

it('cancels an admitted generation without opening a late result or replacing the current draft', async () => {
  const pending = deferred(), opened = vi.fn(), closed = vi.fn();
  mocks.synthesis.mockImplementation(() => pending.promise);
  mocks.synthesisCancel.mockResolvedValue({ ok: true, result: { status: 'cancelled' } });
  const view = render(<ConversationShareDialog id="synthesis" ticket={ticket} selection={{ kind: 'synthesis', conversation: shareSelection.conversation }} onClose={closed} onOpen={opened} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Generate draft' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Generate draft' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel generation' }));
  await waitFor(() => expect(closed).toHaveBeenCalledOnce());
  expect(mocks.synthesisCancel).toHaveBeenCalledWith(ticket, { storeTenant: 'owner', conversationId: 'requester' }, mocks.synthesis.mock.calls[0][2].operationId);
  view.unmount();
  await act(async () => pending.resolve({ ok: true, result: { status: 'completed' } }));
  expect(opened).not.toHaveBeenCalled(); expect(mocks.saveDraft).not.toHaveBeenCalled();
});

it('reports full-context failure without preparing a partial draft and hides AI when capability is unavailable', async () => {
  const opened = vi.fn(); mocks.synthesis.mockResolvedValue({ ok: false, code: 'AI_CONTEXT_TOO_LARGE' });
  const view = render(<ConversationShareDialog id="synthesis" ticket={ticket} selection={{ kind: 'synthesis', conversation: shareSelection.conversation }} onClose={vi.fn()} onOpen={opened} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Generate draft' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Generate draft' }));
  await screen.findByText('The complete conversation exceeds the available AI context. No partial summary was saved. You can still compose manually.');
  expect(opened).not.toHaveBeenCalled(); expect(mocks.saveDraft).not.toHaveBeenCalled();
  view.unmount(); render(<Harness />); await screen.findByLabelText('Message');
  expect(screen.queryByRole('button', { name: 'Summarize with AI' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Post' })).toBeInTheDocument();
});

it('removes cached source and destination details when synthesis reports lost access', async () => {
  mocks.synthesis.mockResolvedValue({ ok: false, code: 'unavailable' });
  render(<ConversationShareDialog id="synthesis" ticket={ticket} selection={{ kind: 'synthesis', conversation: shareSelection.conversation }} onClose={vi.fn()} onOpen={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Generate draft' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Generate draft' }));
  await screen.findByText('The source or destination is no longer available. Refresh to check your access.');
  expect(screen.queryByLabelText('Destination')).toBeNull();
  expect(screen.queryByText('From conversation: Diagnostics')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Open existing draft' })).toBeNull();
});


it('cancels an uncertain synthesis before closing instead of leaving an unconfirmed generation running', async () => {
  const closed = vi.fn(), cancelled = deferred();
  mocks.synthesis.mockResolvedValue({ ok: false, code: 'unknown' });
  mocks.synthesisCancel.mockImplementation(() => cancelled.promise);
  render(<ConversationShareDialog id="synthesis" ticket={ticket} selection={{ kind: 'synthesis', conversation: shareSelection.conversation }} onClose={closed} onOpen={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Generate draft' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Generate draft' }));
  await screen.findByRole('button', { name: 'Retry generation' });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
  await waitFor(() => expect(mocks.synthesisCancel).toHaveBeenCalledOnce());
  expect(closed).not.toHaveBeenCalled();
  await act(async () => cancelled.resolve({ ok: true, result: { status: 'cancelled' } }));
  await waitFor(() => expect(closed).toHaveBeenCalledOnce());
});

it('flushes the manual draft before opening Ask AI and submits only the selected sources', async () => {
  mocks.aiCapability.mockResolvedValue({ available: true });
  mocks.askAi.mockResolvedValue({ ok: true, result: { status: 'completed', replyId: 'ai-reply' } });
  render(<Harness />);
  const editor = await screen.findByRole('textbox', { name: 'Message' });
  await waitFor(() => expect((editor as HTMLTextAreaElement).disabled).toBe(false));
  fireEvent.change(editor, { target: { value: 'Manual draft stays separate' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Ask AI' }));
  const dialog = await screen.findByRole('dialog');
  expect(mocks.saveDraft).toHaveBeenCalled();
  await within(dialog).findByRole('checkbox', { name: 'Diagnostics' });
  fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Diagnostics' }));
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Your question' }), { target: { value: 'Suggest the next diagnostic step' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Ask AI' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(mocks.askAi).toHaveBeenCalledWith(ticket, { storeTenant: 'home', conversationId: 'private' }, expect.objectContaining({
    expectedConversationRevision: 1, prompt: 'Suggest the next diagnostic step', sources: [{ storeTenant: 'owner', conversationId: 'requester' }],
  }));
  expect(mocks.post).not.toHaveBeenCalled(); expect(mocks.sendEmail).not.toHaveBeenCalled();
});

it('retries uncertain AI requests with identical intent and waits for cancellation before closing', async () => {
  const onClose = vi.fn(), cancellation = deferred();
  mocks.askAi.mockResolvedValue({ ok: false, code: 'unknown' }); mocks.aiCancel.mockReturnValue(cancellation.promise);
  render(<ConversationAiDialog id="ai" ticket={ticket} conversation={side as any} onClose={onClose} />);
  await screen.findByRole('checkbox', { name: 'Diagnostics' });
  fireEvent.change(screen.getByRole('textbox', { name: 'Your question' }), { target: { value: 'Help diagnose this' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ask AI' }));
  await screen.findByRole('button', { name: 'Retry' });
  expect((screen.getByRole('textbox', { name: 'Your question' }) as HTMLTextAreaElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(mocks.askAi).toHaveBeenCalledTimes(2));
  expect(mocks.askAi.mock.calls[1]).toEqual(mocks.askAi.mock.calls[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel generation' }));
  await waitFor(() => expect(mocks.aiCancel).toHaveBeenCalledTimes(1)); expect(onClose).not.toHaveBeenCalled();
  expect(mocks.aiCancel.mock.calls[0][2]).toBe(mocks.askAi.mock.calls[0][2].operationId);
  await act(async () => cancellation.resolve({ ok: true, result: { status: 'cancelled' } }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('ignores late AI completion after cancellation and never submits a manual post', async () => {
  const inference = deferred(), onClose = vi.fn(); mocks.askAi.mockReturnValue(inference.promise);
  render(<ConversationAiDialog id="ai" ticket={ticket} conversation={side as any} onClose={onClose} />);
  await screen.findByRole('checkbox', { name: 'Diagnostics' });
  fireEvent.change(screen.getByRole('textbox', { name: 'Your question' }), { target: { value: 'Investigate' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ask AI' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel generation' }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  await act(async () => inference.resolve({ ok: true, result: { status: 'completed', replyId: 'late' } }));
  expect(onClose).toHaveBeenCalledOnce(); expect(mocks.post).not.toHaveBeenCalled(); expect(mocks.saveDraft).not.toHaveBeenCalled();
});

it('clears protected AI source names and prompt after source authority is lost', async () => {
  const onClose = vi.fn(); mocks.askAi.mockResolvedValue({ ok: false, code: 'unavailable' });
  render(<ConversationAiDialog id="ai" ticket={ticket} conversation={side as any} onClose={onClose} />);
  await screen.findByRole('checkbox', { name: 'Diagnostics' });
  fireEvent.change(screen.getByRole('textbox', { name: 'Your question' }), { target: { value: 'Private prompt' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ask AI' }));
  await screen.findByRole('alert');
  expect(screen.queryByText('Diagnostics')).toBeNull(); expect(screen.queryByRole('textbox', { name: 'Your question' })).toBeNull();
  expect(screen.queryByText('Requester')).toBeNull(); expect(mocks.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(onClose).toHaveBeenCalledOnce();
});

it('offers no Ask AI action for email conversations or unavailable AI', async () => {
  const view = render(<Harness />); await screen.findByRole('textbox', { name: 'Message' });
  expect(screen.queryByRole('button', { name: 'Ask AI' })).toBeNull();
  view.unmount(); mocks.aiCapability.mockResolvedValue({ available: true });
  mocks.load.mockResolvedValue({ conversations: [requester, { ...side, transport: 'email' }], writeAudiences: ['requester', 'organization_private'] });
  render(<Harness />); await screen.findByRole('button', { name: 'Summarize with AI' });
  expect(screen.queryByRole('button', { name: 'Ask AI' })).toBeNull();
});

// F019: an unsent-draft indicator must be visible on every accessible row,
// not only the currently-selected one.
it('shows the draft indicator on an inaccessible-selection row that has its own saved draft, not only the active row', async () => {
  mocks.load.mockResolvedValue({ conversations: [{ ...requester, hasDraft: true }, side], writeAudiences: ['requester', 'organization_private'], actor: { tenant: 'home', userId: 'author' } });
  render(<Harness />); await screen.findByRole('textbox', { name: 'Message' });
  const requesterRow = screen.getByRole('button', { name: /Requester/ });
  expect(requesterRow).toHaveTextContent('Draft');
  const diagnosticsRow = screen.getByRole('button', { name: /Diagnostics/ });
  expect(diagnosticsRow).not.toHaveTextContent('Draft');
});

// F025: interactive navigator rows carry the repo's stable
// `data-automation-id` convention, not just a DOM `id`.
it('gives navigator rows and the All activity control stable data-automation-id attributes', async () => {
  render(<Harness />); await screen.findByRole('textbox', { name: 'Message' });
  const requesterRow = screen.getByRole('button', { name: /Requester/ });
  expect(requesterRow.getAttribute('data-automation-id')).toBe(requesterRow.getAttribute('id'));
  expect(requesterRow.getAttribute('data-automation-id')).toBeTruthy();
  const allActivity = screen.getByRole('button', { name: 'All activity' });
  expect(allActivity.getAttribute('data-automation-id')).toBe(allActivity.getAttribute('id'));
});
