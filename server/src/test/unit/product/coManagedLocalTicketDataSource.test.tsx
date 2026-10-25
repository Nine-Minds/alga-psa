/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CoManagedLocalTicketDataSourceProvider from '../../../components/co-managed/CoManagedLocalTicketDataSourceProvider';
import { useTicketDataSource } from '@alga-psa/tickets/components/ticket/TicketDataSourceContext';
import { TicketConversationAttachments } from '@alga-psa/tickets/components/ticket/TicketConversationAttachments';

const mocks = vi.hoisted(() => ({ flag: vi.fn(), screen: vi.fn(), conversation: vi.fn(), create: vi.fn(), find: vi.fn(),
  nativeAdd: vi.fn(), nativeCreate: vi.fn(), prepare: vi.fn(), submit: vi.fn() }));
vi.mock('@alga-psa/tickets/components', async () => import('../../../../../packages/tickets/src/components/ticket/TicketConversationAttachments'));
vi.mock('../../../components/co-managed/CoManagedCommentAttachments', () => ({ default: ({ resource, comment }: any) => (
  <a href={`/attachments/${resource.tenant}/${resource.id}/${comment.storeTenant}/${comment.threadId}/${comment.commentId}`}>Customer evidence file</a>
) }));
vi.mock('../../../components/co-managed/conversationDraftSubmission', () => ({ prepareConversationDraft: mocks.prepare, submitConversationDraft: mocks.submit }));
vi.mock('@alga-psa/tickets/lib/nativeTicketDataSource', () => ({ nativeTicketDataSource: {
  comments: { findCommentById: mocks.find, addTicketCommentWithCacheForCurrentUser: mocks.nativeAdd, createComment: mocks.nativeCreate },
  conversation: {}, slots: {} } }));
vi.mock('@alga-psa/ui/hooks', () => ({ useFeatureFlag: mocks.flag }));
vi.mock('@alga-psa/ui/ui-reflection/useAutomationIdAndRegister', () => ({ useAutomationIdAndRegister: ({ id }: any) => ({ automationIdProps: { id }, updateMetadata: () => {}, updateActions: () => {} }) }));
vi.mock('../../../components/co-managed/CoManagedTicketSection', () => ({ default: (props: any) => <div id="section-stub" data-layout={props.layout} /> }));
vi.mock('../../../components/co-managed/CoManagedThreadDisclosure', () => ({ default: () => null }));
vi.mock('../../../lib/actions/coManagedSharedWorkActions', () => ({ getCoManagedTicketScreenAction: mocks.screen }));
vi.mock('../../../lib/actions/coManagedTicketConversationActions', () => ({ getCoManagedTicketConversationScreenAction: mocks.conversation }));
vi.mock('../../../lib/actions/coManagedPrivateTicketCommentActions', () => ({ saveCoManagedPrivateTicketCommentAction: vi.fn() }));
vi.mock('../../../lib/actions/coManagedTicketCommentActions', () => ({ createCoManagedTicketCommentAction: mocks.create }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string, options?: any) => options?.organization ? `${key}: ${options.organization}` : key }),
  useOptionalI18n: () => null, useFormatters: () => ({ formatDate: (date: Date) => date.toISOString() }) }));

const resource = { tenant: 'customer-a', relationshipId: 'relationship-a', kind: 'ticket' as const, id: 'ticket-a' };
let source: any = null;
function Probe() { source = useTicketDataSource(); return null; }
const mount = () => render(<CoManagedLocalTicketDataSourceProvider ticketId="ticket-a"><Probe /></CoManagedLocalTicketDataSourceProvider>);
const richText = JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'Hello team', styles: {} }] }]);

beforeEach(() => {
  vi.resetAllMocks(); source = null;
  mocks.flag.mockReturnValue({ enabled: true, loading: false, error: null });
  mocks.screen.mockResolvedValue({ summary: { resource }, customerName: 'Customer A' });
  mocks.conversation.mockResolvedValue({ items: [], nextBefore: null, actor: { tenant: 'customer-a', userId: 'user-1' }, writeAudiences: ['requester', 'shared_it', 'organization_private'],
    draftAttachments: { audiences: ['requester', 'shared_it', 'organization_private'], maxBytes: 1024, maxFiles: 2 } });
  mocks.create.mockResolvedValue({ ok: true, receipt: { commentId: 'comment-1', threadId: 'thread-1', storeTenant: 'customer-a' } });
  mocks.find.mockResolvedValue({ comment_id: 'comment-1', note: richText });
  mocks.nativeAdd.mockResolvedValue({ comment_id: 'native' });
  mocks.prepare.mockResolvedValue({ captured: true });
  mocks.submit.mockResolvedValue({ ok: true, receipt: { commentId: 'comment-1', threadId: 'thread-1', storeTenant: 'customer-a' } });
});
afterEach(cleanup);

it('renders an authorized comment attachment in the customer native ticket, retaining its store identity', async () => {
  render(<CoManagedLocalTicketDataSourceProvider ticketId="ticket-a">
    <TicketConversationAttachments ticketId="ticket-a" comment={{ tenant: 'customer-a', ticket_id: 'ticket-a', thread_id: 'thread-1', comment_id: 'comment-1' } as any} />
  </CoManagedLocalTicketDataSourceProvider>);
  expect(await screen.findByRole('link', { name: 'Customer evidence file' })).toHaveAttribute('href', '/attachments/customer-a/ticket-a/customer-a/thread-1/comment-1');
});

it('publishes customer composer files through the draft flow and keeps one immutable operation after a lost response', async () => {
  mount();
  await waitFor(() => expect(source.conversation.composerFooter).toBeTypeOf('function'));
  const footer = source.conversation.composerFooter({ audienceId: 'organization_private', disabled: false });
  const file = new File(['private customer bytes'], 'customer-private.txt', { type: 'text/plain' });
  footer.props.staging.add([file]);
  mocks.submit.mockRejectedValueOnce(new Error('lost publication acknowledgment'));
  const send = () => source.comments.addTicketCommentWithCacheForCurrentUser('ticket-a', richText, true, false, false, undefined, undefined, undefined, { audienceId: 'organization_private' });
  await act(async () => { expect(await send()).toHaveProperty('actionError'); });
  expect(footer.props.staging.getSnapshot()).toHaveLength(1);
  await act(async () => { expect(await send()).toMatchObject({ comment_id: 'comment-1' }); });
  expect(mocks.prepare).toHaveBeenCalledTimes(1);
  expect(mocks.prepare.mock.calls[0][0]).toMatchObject({ resource, actorTenant: 'customer-a', audience: 'organization_private', files: [file] });
  expect(mocks.submit).toHaveBeenCalledTimes(2);
  expect(mocks.submit.mock.calls[1][0]).toBe(mocks.submit.mock.calls[0][0]);
  expect(footer.props.staging.getSnapshot()).toHaveLength(0);
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.nativeAdd).not.toHaveBeenCalled();
});

it('replaces the Internal toggle with the requester, shared IT and private-to-organization audience control', async () => {
  mount();
  await waitFor(() => expect(source.conversation.audiences).toBeDefined());
  const audiences = source.conversation.audiences;
  expect(audiences.options.map((option: any) => [option.id, option.label])).toEqual([
    ['requester', 'coManaged.conversation.audiences.requester'],
    ['shared_it', 'coManaged.conversation.audiences.shared_it'],
    ['organization_private', 'coManaged.section.privateTo: Customer A'],
  ]);
  expect(audiences.defaultId).toBe('shared_it');
  expect(source.slots.coManagedSection).toBeTypeOf('function');
});

it('writes the chosen audience through the co-managed comment command, not the native comment action', async () => {
  mount();
  await waitFor(() => expect(source.conversation.audiences).toBeDefined());
  let result: any;
  await act(async () => { result = await source.comments.addTicketCommentWithCacheForCurrentUser('ticket-a', richText, false, false, false, undefined, undefined, undefined, { audienceId: 'organization_private' }); });
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(mocks.create.mock.calls[0][0]).toEqual(resource);
  expect(mocks.create.mock.calls[0][1]).toMatchObject({ audience: 'organization_private', operationId: expect.any(String) });
  expect(mocks.nativeAdd).not.toHaveBeenCalled();
  expect(result).toMatchObject({ comment_id: 'comment-1' });
});

it('replays the same operation when an unconfirmed write is retried with the same content', async () => {
  mocks.create.mockResolvedValueOnce({ ok: false, code: 'unknownOutcome' });
  mount();
  await waitFor(() => expect(source.conversation.audiences).toBeDefined());
  const send = () => source.comments.addTicketCommentWithCacheForCurrentUser('ticket-a', richText, false, false, false, undefined, undefined, undefined, { audienceId: 'requester' });
  await act(async () => { expect(await send()).toHaveProperty('actionError'); });
  await act(async () => { await send(); });
  expect(mocks.create.mock.calls[1][1].operationId).toBe(mocks.create.mock.calls[0][1].operationId);
});

it('stays the native data source while the release flag is off and for tickets that are not co-managed', async () => {
  mocks.flag.mockReturnValue({ enabled: false, loading: false, error: null });
  mount();
  expect(source.conversation.audiences).toBeUndefined();
  expect(mocks.screen).not.toHaveBeenCalled();
  cleanup();
  mocks.flag.mockReturnValue({ enabled: true, loading: false, error: null });
  mocks.screen.mockRejectedValue(new Error('not co-managed'));
  mount();
  await waitFor(() => expect(mocks.screen).toHaveBeenCalled());
  expect(source.conversation.audiences).toBeUndefined();
  expect(source.slots.coManagedSection).toBeUndefined();
});

it('hides the native time panel (denied on co_managed tenants) and supplies the effort split slot instead', async () => {
  mount();
  await waitFor(() => expect(source.slots.timeSummary).toBeTypeOf('function'));
  expect(source.capabilities.timeEntry).toBe(false);
  // Everything else stays native.
  expect(source.capabilities.sla).toBe(true);
  expect(source.capabilities.tags).toBe(true);
});

it('keeps native time capabilities until the co-managed screen has loaded or when the flag is off', async () => {
  mocks.flag.mockReturnValue({ enabled: false, loading: false, error: null });
  mount();
  await act(async () => {});
  expect(source.slots.timeSummary).toBeUndefined();
});
