/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TicketDetails } from '../../../../../packages/client-portal/src/components/tickets/TicketDetails';

vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { session_id: mocks.session, user: { tenant: 'owner', id: 'requester' } } }) }));
const mocks = vi.hoisted(() => ({ session: 'portal-session', enabled: true, read: vi.fn(), post: vi.fn(), edit: vi.fn(), remove: vi.fn(), error: vi.fn() }));
vi.mock('@alga-psa/ui/hooks/useFeatureFlag', () => ({ useFeatureFlag: () => ({ enabled: mocks.enabled }) }));
vi.mock('@alga-psa/client-portal/actions', () => ({
  getClientTicketDetails: mocks.read, addClientTicketComment: mocks.post, updateClientTicketComment: mocks.edit,
  deleteClientTicketComment: mocks.remove, getClientTicketDocuments: async () => [], getClientDocumentFolders: async () => [],
  getAppointmentRequestsByTicketId: async () => ({ success: true, data: [] }), updateTicketStatus: vi.fn(), getClientAssetById: vi.fn(),
}));
vi.mock('@alga-psa/user-composition/actions', () => ({ getCurrentUser: async () => ({ user_id: 'requester', first_name: 'Portal', last_name: 'User' }) }));
vi.mock('@alga-psa/teams/actions', () => ({ getTeamAvatarUrlsBatchAction: async () => ({}) }));
vi.mock('@alga-psa/tickets/actions/ticketDisplaySettings', () => ({ getTicketingDisplaySettings: async () => ({ responseStateTrackingEnabled: true }) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback, i18n: { language: 'en' } }) }));
vi.mock('@alga-psa/ui', () => ({ getDateFnsLocale: () => undefined }));
vi.mock('@alga-psa/ui/components', () => ({ ResponseStateBadge: () => null }));
vi.mock('@alga-psa/ui/components/Dialog', () => ({ Dialog: ({ isOpen, children }: any) => isOpen ? <div>{children}</div> : null, DialogContent: ({ children }: any) => <div>{children}</div> }));
vi.mock('@alga-psa/ui/components/Card', () => ({ Card: ({ children }: any) => <div>{children}</div> }));
vi.mock('@alga-psa/ui/components/Badge', () => ({ Badge: ({ children }: any) => <span>{children}</span> }));
vi.mock('@alga-psa/ui/components/UserAvatar', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/TeamAvatar', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/Tooltip', () => ({ Tooltip: ({ children }: any) => <>{children}</> }));
vi.mock('@alga-psa/ui/editor', () => ({ RichTextViewer: () => null }));
vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({ ConfirmationDialog: () => null }));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: ({ id, label, value, onValueChange, options, disabled }: any) =>
  <label>{label}<select id={id} value={value} disabled={disabled} onChange={event => onValueChange(event.target.value)}>
    {options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select></label> }));
vi.mock('@alga-psa/ui/lib/errorHandling', () => ({ handleError: mocks.error, getErrorMessage: (e: any) => e.actionError ?? e.permissionError,
  isActionMessageError: (e: any) => Boolean(e?.actionError), isActionPermissionError: (e: any) => Boolean(e?.permissionError) }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@alga-psa/tickets/components', () => ({
  TicketDocumentsSection: () => null, TicketAppointmentRequests: () => null, TicketOriginBadge: () => null,
  TicketConversation: (props: any) => <div>
    <span>{props.ticket.selectedConversationId} history</span>
    <textarea aria-label="Reply" onChange={event => props.onNewCommentContentChange([{ type: 'paragraph', content: [{ type: 'text', text: event.target.value }] }])} />
    <button onClick={() => props.onAddNewComment(false, false)}>Post reply</button>
    <button onClick={() => props.onEdit({ comment_id: 'message', user_id: 'requester', note: 'Earlier reply' })}>Edit reply</button>
    <button onClick={() => props.onClose()}>Cancel edit</button>
    <button onClick={() => props.onSave({ note: 'Changed reply' })}>Save edit</button>
    <button onClick={() => props.onDelete({ comment_id: 'message', user_id: 'requester' })}>Delete reply</button>
  </div>,
}));
const base = { tenant: 'owner', ticket_id: 'ticket', entered_at: '2026-01-01T00:00:00Z', selectedConversationId: 'default', conversations: [],
  requesterConversations: [{ conversationId: 'default', name: 'Requester', isDefault: true, status: 'open' },
    { conversationId: 'delivery', name: 'Delivery arrangements', isDefault: false, status: 'open' }] };
function view(ticket: any = base) { return <TicketDetails ticketId={ticket.ticket_id} initialTicket={ticket} initialDocuments={[]} initialStatusOptions={[]} isOpen asStandalone onClose={() => {}} />; }
const deferred = () => { let resolve!: (value: any) => void; const promise = new Promise<any>(done => { resolve = done; }); return { promise, resolve }; };
beforeEach(() => {
  vi.clearAllMocks(); mocks.enabled = true; mocks.session = 'portal-session';
  mocks.read.mockImplementation(async (id, selected = 'default') => ({ ...base, ticket_id: id, selectedConversationId: selected }));
  mocks.post.mockResolvedValue(true); mocks.edit.mockResolvedValue(undefined); mocks.remove.mockResolvedValue(undefined);
});
afterEach(cleanup);

it('keeps portal selection through posting, editing and deletion and guards unfinished work', async () => {
  render(view());
  const selector = screen.getByLabelText('Conversation');
  fireEvent.change(screen.getByLabelText('Reply'), { target: { value: 'Unsent reply' } });
  expect(selector).toBeDisabled();
  fireEvent.change(selector, { target: { value: 'delivery' } });
  expect(mocks.read).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Reply'), { target: { value: '' } });
  fireEvent.change(selector, { target: { value: 'delivery' } });
  await screen.findByText('delivery history');
  fireEvent.change(screen.getByLabelText('Reply'), { target: { value: 'Selected reply' } });
  fireEvent.click(screen.getByRole('button', { name: 'Post reply' }));
  await waitFor(() => expect(selector).not.toBeDisabled());
  expect(mocks.post).toHaveBeenCalledWith('ticket', expect.stringContaining('Selected reply'), false, false, 'delivery');
  expect(mocks.read).toHaveBeenLastCalledWith('ticket', 'delivery');
  fireEvent.click(screen.getByRole('button', { name: 'Edit reply' }));
  expect(selector).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Save edit' }));
  await waitFor(() => expect(mocks.edit).toHaveBeenCalled());
  await waitFor(() => expect(selector).not.toBeDisabled());
  fireEvent.click(screen.getByRole('button', { name: 'Delete reply' }));
  await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('message'));
  await waitFor(() => expect(selector).not.toBeDisabled());
  expect(mocks.read.mock.calls.every(call => call[1] === 'delivery')).toBe(true);
});

it('freezes the old composer during selection, preserves it on failure and drops a late prior-ticket response', async () => {
  const pending = deferred(); mocks.read.mockReturnValueOnce(pending.promise);
  const rendered = render(view());
  fireEvent.change(screen.getByLabelText('Conversation'), { target: { value: 'delivery' } });
  expect(screen.getByRole('button', { name: 'Post reply' })).toBeDisabled();
  expect(screen.getByRole('group')).toHaveAttribute('inert');
  await act(async () => pending.resolve({ actionError: 'This conversation is unavailable.' }));
  expect(screen.getByText('default history')).toBeInTheDocument();
  expect(screen.getByLabelText('Conversation')).toHaveValue('default');
  const late = deferred(); mocks.read.mockReturnValueOnce(late.promise);
  fireEvent.change(screen.getByLabelText('Conversation'), { target: { value: 'delivery' } });
  rendered.rerender(view({ ...base, ticket_id: 'another-ticket' }));
  await act(async () => late.resolve({ ...base, selectedConversationId: 'delivery' }));
  expect(screen.queryByText('delivery history')).not.toBeInTheDocument();
  expect(screen.getByText('default history')).toBeInTheDocument();
});

it('keeps a single requester view when the UI release flag is off', () => {
  mocks.enabled = false; render(view());
  expect(screen.queryByLabelText('Conversation')).not.toBeInTheDocument();
  expect(screen.getByText('default history')).toBeInTheDocument();
  expect(mocks.read).not.toHaveBeenCalled();
});

it('removes prefetched ticket content when the authenticated account changes', () => {
  const rendered = render(view());
  mocks.session = 'another-session'; rendered.rerender(view());
  expect(screen.queryByText('default history')).not.toBeInTheDocument();
  expect(screen.getByText('Reopen this ticket after switching accounts.')).toBeInTheDocument();
});
