/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CoManagedTicketConversation from '../../../components/co-managed/CoManagedTicketConversation';
import { CoManagedFeatureBoundary } from '../../../components/co-managed/CoManagedFeatureBoundary';
const mocks = vi.hoisted(() => ({ flag: vi.fn(), load: vi.fn(), create: vi.fn(), mutate: vi.fn(), private: vi.fn(),
  session: { user: { tenant: 'msp', id: 'technician' } } }));
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
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string) => key }), useFormatters: () => ({ formatDate: (date: Date) => date.toISOString() }), useOptionalI18n: () => null }));
const resource = { tenant: 'customer', relationshipId: 'relationship', kind: 'ticket' as const, id: 'ticket' };
const note = (text: string) => JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text, styles: {} }] }]);
const item = () => ({ storeTenant: 'customer', commentId: 'comment', threadId: 'thread', parentCommentId: null, audience: 'shared_it',
  createdAt: '2026-01-01T00:00:00.123456Z', updatedAt: '2026-01-01T00:00:00.654321Z', deleted: false, revision: null, note: note('Shared content'), markdown: 'Shared content',
  author: { tenant: 'msp', kind: 'user', id: 'technician', displayName: 'Morgan', organizationName: 'Provider IT', referenceId: 'reference' } });
const data = () => ({ resource, actor: { tenant: 'msp', userId: 'technician' }, writeAudiences: ['requester', 'shared_it', 'organization_private'], items: [item()], nextBefore: null });
const mount = () => render(<CoManagedFeatureBoundary><CoManagedTicketConversation resource={resource} /></CoManagedFeatureBoundary>);
const button = (name: string) => screen.getByRole('button', { name: `coManaged.conversation.${name}` });
const message = () => screen.getByLabelText('coManaged.conversation.message');
const deferred = () => { let resolve!: (value: any) => void; const promise = new Promise<any>(done => { resolve = done; }); return { promise, resolve }; };
beforeEach(() => {
  vi.resetAllMocks(); mocks.session = { user: { tenant: 'msp', id: 'technician' } };
  mocks.flag.mockReturnValue({ enabled: true, loading: false, error: null }); mocks.load.mockResolvedValue(data());
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
  expect(mocks.private).toHaveBeenCalledWith(resource, { kind: 'create', text: 'MSP private note', operationId: expect.any(String) }); expect(mocks.create).not.toHaveBeenCalled();
});
it('inherits reply audience and sends the exact original version for an own-author edit', async () => {
  mount(); await screen.findByText('Shared content'); fireEvent.click(button('reply'));
  expect(screen.queryByRole('combobox')).toBeNull(); fireEvent.change(message(), { target: { value: 'Inherited reply' } }); fireEvent.click(button('send'));
  await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
  expect(mocks.create).toHaveBeenCalledWith(resource, { operationId: expect.any(String), text: 'Inherited reply', parent: { storeTenant: 'customer', threadId: 'thread', commentId: 'comment' } });
  await waitFor(() => expect(button('edit')).toBeInTheDocument()); fireEvent.click(button('edit')); fireEvent.change(message(), { target: { value: 'Edited' } }); fireEvent.click(button('send'));
  await waitFor(() => expect(mocks.mutate).toHaveBeenCalledOnce()); expect(mocks.mutate.mock.calls[0][1]).toMatchObject({ kind: 'edit', text: 'Edited', expectedUpdatedAt: item().updatedAt });
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
  expect(mocks.create.mock.calls[0][1]).toMatchObject({ text: 'Customer-private note', audience: 'organization_private' });
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
