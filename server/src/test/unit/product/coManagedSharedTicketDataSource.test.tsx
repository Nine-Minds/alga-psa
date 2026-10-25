/** @vitest-environment jsdom */
import React from 'react';
import { TicketConversationAttachments } from '../../../../../packages/tickets/src/components/ticket/TicketConversationAttachments';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSharedTicketDataSource } from '../../../components/co-managed/sharedTicketDataSource';
import SharedTicketScreen from '../../../components/co-managed/SharedTicketScreen';
import { useTicketDataSource } from '@alga-psa/tickets/components/ticket/TicketDataSourceContext';
import { nativeTicketDataSource } from '@alga-psa/tickets/lib/nativeTicketDataSource';
import { NO_TICKET_CAPABILITIES, TICKET_SCREEN_FIELDS, type TicketDataSource } from '@alga-psa/tickets/lib/ticketDataSource';
import { createTicketIdGuardDataSource, NativeTicketIdMethodCalledError, TICKET_ID_KEYED_GROUPS } from '@alga-psa/tickets/lib/testing/ticketIdGuardDataSource';

const mocks = vi.hoisted(() => ({
  save: vi.fn(), search: vi.fn(), page: vi.fn(), create: vi.fn(), mutate: vi.fn(), priv: vi.fn(), details: vi.fn(),
  prepare: vi.fn(), submit: vi.fn(), session: vi.fn(), avatarUser: vi.fn(), avatarTeam: vi.fn(), avatarContact: vi.fn(),
}));
vi.mock('next-auth/react', () => ({ useSession: mocks.session }));
vi.mock('@alga-psa/ui/hooks', () => ({ useFeatureFlag: () => ({ enabled: true, loading: false, error: null }) }));
vi.mock('@alga-psa/ui/ui-reflection/useAutomationIdAndRegister', () => ({ useAutomationIdAndRegister: ({ id }: any) => ({ automationIdProps: { id }, updateMetadata: () => {}, updateActions: () => {} }) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string) => key }), useOptionalI18n: () => null, useFormatters: () => ({}) }));
vi.mock('../../../lib/actions/coManagedTicketEditActions', () => ({ saveSharedTicketEditAction: mocks.save, searchSharedTicketEditOptionsAction: mocks.search }));
vi.mock('../../../lib/actions/coManagedTicketConversationActions', () => ({ getCoManagedTicketConversationScreenAction: mocks.page }));
vi.mock('../../../lib/actions/coManagedTicketCommentActions', () => ({ createCoManagedTicketCommentAction: mocks.create }));
vi.mock('../../../lib/actions/coManagedTicketCommentMutationActions', () => ({ mutateCoManagedTicketCommentAction: mocks.mutate }));
vi.mock('../../../lib/actions/coManagedPrivateTicketCommentActions', () => ({ saveCoManagedPrivateTicketCommentAction: mocks.priv }));
vi.mock('../../../lib/actions/coManagedSharedWorkActions', () => ({ getSharedTicketDetailsAction: mocks.details }));
vi.mock('../../../components/co-managed/conversationDraftSubmission', () => ({ prepareConversationDraft: mocks.prepare, submitConversationDraft: mocks.submit }));
vi.mock('../../../components/co-managed/CoManagedTicketSection', () => ({ default: () => <div id="section-stub" /> }));
vi.mock('../../../components/co-managed/CoManagedEffortSummary', () => ({ default: () => <div id="effort-stub" /> }));
vi.mock('../../../components/co-managed/CoManagedThreadDisclosure', () => ({ default: () => null }));
vi.mock('../../../components/co-managed/SharedCommentAttachmentPicker', () => ({ default: () => null }));
vi.mock('@alga-psa/tickets/components', async () => import('../../../../../packages/tickets/src/components/ticket/TicketConversationAttachments'));
vi.mock('../../../components/co-managed/CoManagedCommentAttachments', () => ({ default: ({ resource, comment }: any) => (
  <a href={`/attachments/${resource.tenant}/${resource.relationshipId}/${resource.id}/${comment.storeTenant}/${comment.threadId}/${comment.commentId}`}>Shared evidence file</a>
) }));
vi.mock('../../../components/co-managed/useCoManagedSharedTimeConfig', () => ({ useCoManagedSharedTimeConfig: () => ({}) }));
vi.mock('@alga-psa/msp-composition/tickets/MspTicketDetailsContainerClient', () => ({
  default: (props: any) => { probe.source = useTicketDataSource(); probe.props = props; return <div id="container-stub">
    {props.ticketData.comments.map((comment: any) => <TicketConversationAttachments key={`${comment.tenant}:${comment.comment_id}`} ticketId={props.ticketData.ticket.ticket_id} comment={comment} />)}
  </div>; },
}));

const probe: { source: TicketDataSource | null; props: any } = { source: null, props: null };
const resource = { tenant: 'customer-a', relationshipId: 'relationship-a', kind: 'ticket' as const, id: 'ticket-a' };
const actor = { tenant: 'msp-home', userId: 'user-me' };
const rich = (text: string) => JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text, styles: {} }] }]);
const t = (key: string) => key;

const item = (over: Record<string, unknown> = {}) => ({
  storeTenant: 'customer-a', commentId: 'c1', threadId: 't1', parentCommentId: null, audience: 'shared_it', createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z', deleted: false, revision: 3, note: rich('Hello'), markdown: null,
  author: { tenant: 'customer-a', kind: 'contact', id: 'ct-1', displayName: 'Dana', organizationName: 'Customer A', referenceId: 'ref-1' }, ...over,
}) as any;
const own = (over: Record<string, unknown> = {}) => item({ commentId: 'own', threadId: 'town', author: { tenant: actor.tenant, kind: 'user', id: actor.userId,
  displayName: 'Me', organizationName: 'MSP', referenceId: 'ref-me' }, ...over });

const baseDetails = (canWrite = true) => ({
  resource,
  ticketData: { ticket: { ticket_id: 'ticket-a', tenant: 'customer-a', title: 'Printer', status_id: 's1', priority_id: 'p1' },
    board: { board_id: 'b1', board_name: 'Support' }, client: { client_name: 'End Client' }, comments: [], documents: [] },
  screen: { side: 'sponsor', canWrite, canEscalate: false, canHandBack: false, canRevoke: false, customerName: 'Customer A', sponsorName: 'MSP', destinationName: undefined, revision: 1, sla: null },
  editor: { editableFields: canWrite ? ['title', 'status_id', 'priority_id', 'description'] : [], baselines: canWrite ? { title: 'Printer', status_id: 's1', priority_id: 'p1', description: null } : {} },
}) as any;
const loaded = (over: { canWrite?: boolean; items?: any[]; writeAudiences?: string[]; attachAudiences?: string[] } = {}) => ({
  details: baseDetails(over.canWrite ?? true),
  conversation: { items: over.items ?? [], actor, writeAudiences: over.writeAudiences ?? ['requester', 'shared_it', 'organization_private'],
    draftAttachments: { audiences: over.attachAudiences ?? ['requester', 'shared_it'], maxBytes: 1024, maxFiles: 2 } },
}) as any;

const refresh = vi.fn();
const requestDisclosure = vi.fn();
function build(over: Parameters<typeof loaded>[0] = {}, base?: TicketDataSource) {
  return createSharedTicketDataSource(resource, loaded(over), { t, refresh, backHref: '/msp/co-management/tickets', requestDisclosure, base });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockReturnValue({ data: { user: { name: 'Me Myself', email: 'me@example.com' } } });
  mocks.save.mockResolvedValue({ ok: true, receipt: {} });
  mocks.search.mockResolvedValue({ options: [], nextAfterId: null });
  mocks.page.mockResolvedValue({ items: [], nextBefore: null, actor, writeAudiences: ['requester', 'shared_it', 'organization_private'], draftAttachments: { audiences: ['requester', 'shared_it'], maxBytes: 1024, maxFiles: 2 } });
  mocks.create.mockResolvedValue({ ok: true, receipt: { commentId: 'new', storeTenant: 'customer-a', threadId: 'tn' } });
  mocks.mutate.mockResolvedValue({ ok: true, receipt: {} });
  mocks.priv.mockResolvedValue({ ok: true, receipt: {} });
  mocks.prepare.mockResolvedValue({ prepared: true });
  mocks.submit.mockResolvedValue({ ok: true, receipt: { commentId: 'new', storeTenant: 'customer-a', threadId: 'tn' } });
  probe.source = null; probe.props = null;
});
afterEach(cleanup);

describe('T003 no native ticket-id action and no foreign-tenant avatar call', () => {
  const guard = () => {
    const avatars = { getUserAvatarUrlsBatchAction: mocks.avatarUser, getTeamAvatarUrlsBatchAction: mocks.avatarTeam, getContactAvatarUrlAction: mocks.avatarContact };
    return createTicketIdGuardDataSource({ overrides: { avatars } as never });
  };

  it('answers every method of every ticket-id keyed group without reaching the native implementation', async () => {
    const source = build({ items: [item(), own()] }, guard());
    const reached: string[] = [];
    for (const group of TICKET_ID_KEYED_GROUPS) {
      for (const method of Object.keys((source as any)[group])) {
        try { await (source as any)[group][method]('ticket-a', 'x', 'y'); }
        catch (error) { if (error instanceof NativeTicketIdMethodCalledError) reached.push(`${group}.${method}`); }
      }
    }
    expect(reached).toEqual([]);
  });

  it('never calls avatar batch actions, with the customer tenant or any other', async () => {
    const source = build({}, guard());
    await source.avatars.getUserAvatarUrlsBatchAction('customer-a', ['u1'] as never);
    await source.avatars.getTeamAvatarUrlsBatchAction('customer-a', ['t1'] as never);
    await (source.avatars as any).getContactAvatarUrlAction('ct-1', 'customer-a');
    expect(mocks.avatarUser).not.toHaveBeenCalled();
    expect(mocks.avatarTeam).not.toHaveBeenCalled();
    expect(mocks.avatarContact).not.toHaveBeenCalled();
  });

  it('classifies the same method set as the native source, and turns every optional capability off', () => {
    const source = build();
    for (const group of TICKET_ID_KEYED_GROUPS) {
      expect(Object.keys((source as any)[group]).sort()).toEqual(Object.keys((nativeTicketDataSource as any)[group]).sort());
    }
    expect(source.kind).toBe('shared');
    expect(source.capabilities).toEqual({ ...NO_TICKET_CAPABILITIES, timeEntry: true });
    expect(build({ canWrite: false }).capabilities.timeEntry).toBe(false);
  });
});

describe('T006 field edits and pickers', () => {
  it('saves a status change with the expected baseline and an operation id', async () => {
    const source = build();
    const result = await source.ticket.updateTicketWithCache('ticket-a', { status_id: 's2' } as never, undefined as never);
    expect(result).toBeUndefined();
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save).toHaveBeenCalledWith(resource, { operationId: expect.any(String), expected: { status_id: 's1' }, patch: { status_id: 's2' } });
  });

  it('advances the baseline after a save, and reports a conflict without changing it', async () => {
    const source = build();
    await source.ticket.updateTicketWithCache('ticket-a', { status_id: 's2' } as never, undefined as never);
    await source.ticket.updateTicketWithCache('ticket-a', { status_id: 's3' } as never, undefined as never);
    expect(mocks.save.mock.calls[1][1].expected).toEqual({ status_id: 's2' });
    mocks.save.mockResolvedValueOnce({ ok: false, code: 'conflict' });
    const conflict = await source.ticket.updateTicketWithCache('ticket-a', { status_id: 's4' } as never, undefined as never);
    expect(conflict).toEqual({ actionError: 'coManaged.editor.errors.conflict' });
    await source.ticket.updateTicketWithCache('ticket-a', { status_id: 's5' } as never, undefined as never);
    expect(mocks.save.mock.calls[3][1].expected).toEqual({ status_id: 's3' });
  });

  it('retries an unknown outcome with the same operation id, then starts a fresh one', async () => {
    const source = build();
    mocks.save.mockRejectedValueOnce(new Error('network'));
    expect(await source.ticket.updateTicketWithCache('ticket-a', { title: 'New' } as never, undefined as never)).toEqual({ actionError: 'coManaged.editor.errors.unknownOutcome' });
    await source.ticket.updateTicketWithCache('ticket-a', { title: 'New' } as never, undefined as never);
    expect(mocks.save.mock.calls[1][1].operationId).toBe(mocks.save.mock.calls[0][1].operationId);
    await source.ticket.updateTicketWithCache('ticket-a', { title: 'Newer' } as never, undefined as never);
    expect(mocks.save.mock.calls[2][1].operationId).not.toBe(mocks.save.mock.calls[0][1].operationId);
  });

  it('refuses fields the shared model cannot write and never calls the command', async () => {
    const source = build();
    expect(await source.ticket.updateTicketWithCache('ticket-a', { assigned_to: 'u1' } as never, undefined as never)).toEqual({ actionError: 'coManaged.editor.errors.forbidden' });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('saves the description through the attributes object', async () => {
    const source = build();
    await source.ticket.updateTicketWithCacheForCurrentUser('ticket-a', { attributes: { description: rich('Body') } } as never);
    expect(mocks.save).toHaveBeenCalledWith(resource, expect.objectContaining({ patch: { description: rich('Body') }, expected: { description: null } }));
  });

  it('lists options from the co-managed search, following pages, and never from tenant lookups', async () => {
    mocks.search.mockResolvedValueOnce({ options: [{ id: 's1', name: 'Open' }], nextAfterId: 's1' }).mockResolvedValueOnce({ options: [{ id: 's2', name: 'Closed' }], nextAfterId: null });
    const source = build();
    expect(await source.options.getTicketStatuses()).toEqual([{ status_id: 's1', name: 'Open' }, { status_id: 's2', name: 'Closed' }]);
    expect(mocks.search).toHaveBeenNthCalledWith(1, resource, { field: 'status_id' });
    expect(mocks.search).toHaveBeenNthCalledWith(2, resource, { field: 'status_id', afterId: 's1' });
    await source.options.getTicketStatuses();
    expect(mocks.search).toHaveBeenCalledTimes(2);
  });

  it('is read-only for a viewer without write authority', async () => {
    const source = build({ canWrite: false });
    expect(source.screen.readOnly).toBe(true);
    expect(source.screen.frozenFields).toEqual([...TICKET_SCREEN_FIELDS]);
    expect(await source.ticket.updateTicketWithCache('ticket-a', { title: 'x' } as never, undefined as never)).toEqual({ actionError: 'coManaged.editor.errors.readOnly' });
    expect(await source.comments.addTicketCommentWithCacheForCurrentUser('ticket-a', rich('hi'), false)).toEqual({ actionError: 'coManaged.editor.errors.forbidden' });
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('points back at Customer Tickets and refreshes through the supplied function', () => {
    const source = build();
    expect(source.screen.backHref).toBe('/msp/co-management/tickets');
    expect(source.screen.refresh).toBe(refresh);
  });
});

describe('T007 conversation', () => {
  it('shows collaborator authors with their organization, the restricted marker for hidden authors, and offers only permitted audiences', async () => {
    const hidden = item({ commentId: 'h', author: undefined });
    mocks.page.mockResolvedValue({ items: [item(), hidden, own()], nextBefore: null, actor, writeAudiences: ['requester', 'shared_it'], draftAttachments: { audiences: [], maxBytes: 1, maxFiles: 1 } });
    const source = build({ items: [item(), hidden, own()], writeAudiences: ['requester', 'shared_it'] });
    const comments = await source.comments.findCommentsByTicketId('ticket-a');
    const byId = Object.fromEntries(comments.map((comment: any) => [comment.comment_id, comment]));
    expect(byId.c1).toMatchObject({ actor_display_name: 'Dana', actor_organization_name: 'Customer A' });
    expect(byId.c1.user_id).toBeUndefined();
    expect(byId.h.actor_display_name).toBe(byId.h.actor_reference_id);
    expect(byId.own.user_id).toBe(actor.userId);
    expect(source.conversation.formatAuthorLabel?.({ comment: byId.h, authorName: 'x' } as never)).toBe('coManaged.conversation.restrictedAuthor');
    const audiences = source.conversation.audiences!;
    expect(audiences.options.map(option => option.id)).toEqual(['requester', 'shared_it']);
    expect(audiences.defaultId).toBe('shared_it');
  });

  it('posts the chosen audience through createCoManagedTicketCommentAction and returns the saved comment', async () => {
    mocks.page.mockResolvedValue({ items: [item({ commentId: 'new', author: { tenant: actor.tenant, kind: 'user', id: actor.userId, displayName: 'Me', organizationName: 'MSP', referenceId: 'r' } })],
      nextBefore: null, actor, writeAudiences: ['requester', 'shared_it', 'organization_private'], draftAttachments: { audiences: [], maxBytes: 1, maxFiles: 1 } });
    const source = build();
    const saved: any = await source.comments.addTicketCommentWithCacheForCurrentUser('ticket-a', 'plain text', false, false, false, undefined, undefined, undefined, { audienceId: 'requester' });
    expect(mocks.create).toHaveBeenCalledWith(resource, { operationId: expect.any(String), document: expect.anything(), audience: 'requester' });
    expect(saved.comment_id).toBe('new');
    expect(mocks.priv).not.toHaveBeenCalled();
  });

  it('writes organization-private notes of a foreign viewer through the private command', async () => {
    const source = build();
    await source.comments.addTicketCommentWithCacheForCurrentUser('ticket-a', 'secret', true, false, false, undefined, undefined, undefined, { audienceId: 'organization_private' });
    expect(mocks.priv).toHaveBeenCalledWith(resource, expect.objectContaining({ kind: 'create', operationId: expect.any(String) }));
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('turns a failed write into a returned error, not a throw', async () => {
    mocks.create.mockResolvedValueOnce({ ok: false, code: 'unknownOutcome' });
    const source = build();
    expect(await source.comments.addTicketCommentWithCacheForCurrentUser('ticket-a', 'hi', false)).toEqual({ actionError: 'coManaged.conversation.unknownOutcome' });
  });

  it('edits and deletes only the viewer\'s own items, through the mutation command', async () => {
    mocks.page.mockResolvedValue({ items: [item(), own()], nextBefore: null, actor, writeAudiences: ['requester', 'shared_it', 'organization_private'], draftAttachments: { audiences: [], maxBytes: 1, maxFiles: 1 } });
    const source = build({ items: [item(), own()] });
    expect(await source.comments.updateComment('c1', { note: rich('x') } as never)).toEqual({ actionError: 'coManaged.editor.errors.forbidden' });
    expect(mocks.mutate).not.toHaveBeenCalled();
    await source.comments.updateComment('own', { note: rich('Edited') } as never);
    expect(mocks.mutate).toHaveBeenCalledWith(resource, expect.objectContaining({ kind: 'edit', comment: { storeTenant: 'customer-a', threadId: 'town', commentId: 'own' }, expectedUpdatedAt: '2026-01-01T00:00:00.000Z' }));
    await source.comments.deleteComment('own');
    expect(mocks.mutate).toHaveBeenLastCalledWith(resource, expect.objectContaining({ kind: 'delete' }));
  });

  it('routes the audience change through the disclosure dialog and only for own top-level threads', async () => {
    requestDisclosure.mockResolvedValue(undefined);
    const source = build({ items: [item(), own()] });
    const audiences = source.conversation.audiences!;
    expect(audiences.canChangeCommentAudience!({ comment_id: 'c1' } as never)).toBe(false);
    expect(audiences.canChangeCommentAudience!({ comment_id: 'own' } as never)).toBe(true);
    await audiences.changeCommentAudience!({ comment_id: 'own' } as never, 'requester');
    expect(requestDisclosure).toHaveBeenCalledWith(expect.objectContaining({ thread: { storeTenant: 'customer-a', threadId: 'town' }, actor }));
  });
});

describe('T008 composer and attachments', () => {
  it('disallows image, file and mention blocks and turns off scheduling and resolution', () => {
    const { conversation } = build();
    expect(conversation.editor).toMatchObject({ disallowImages: true, disallowFiles: true, disallowMentions: true });
    expect(conversation.composerFeatures).toEqual({ schedule: false, resolution: false });
  });

  it('sends staged files through the draft flow and clears them only after the message is saved', async () => {
    const source = build();
    const footer = source.conversation.composerFooter!({ audienceId: 'shared_it', disabled: false }) as React.ReactElement<any>;
    const staging = footer.props.staging;
    const file = new File(['abc'], 'a.txt', { type: 'text/plain' });
    staging.add([file]);
    await source.comments.addTicketCommentWithCacheForCurrentUser('ticket-a', 'with file', false, false, false, undefined, undefined, undefined, { audienceId: 'shared_it' });
    expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({ resource, audience: 'shared_it', files: [file] }));
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(staging.getSnapshot()).toHaveLength(0);

    staging.add([file]);
    mocks.submit.mockResolvedValueOnce({ ok: false, code: 'notReady' });
    const failed = await source.comments.addTicketCommentWithCacheForCurrentUser('ticket-a', 'again', false, false, false, undefined, undefined, undefined, { audienceId: 'shared_it' });
    expect(failed).toEqual({ actionError: 'coManaged.conversation.files.notReady' });
    expect(staging.getSnapshot()).toHaveLength(1);
  });

  it('refuses files for an audience the draft flow does not support', async () => {
    const source = build();
    const footer = source.conversation.composerFooter!({ audienceId: 'organization_private', disabled: false }) as React.ReactElement<any>;
    expect(footer.props.attachable).toBe(false);
    footer.props.staging.add([new File(['a'], 'a.txt')]);
    const result = await source.comments.addTicketCommentWithCacheForCurrentUser('ticket-a', 'x', true, false, false, undefined, undefined, undefined, { audienceId: 'organization_private' });
    expect(result).toEqual({ actionError: 'coManaged.editor.errors.invalid' });
    expect(mocks.priv).not.toHaveBeenCalled();
  });

  it('publishes replacement bytes after an uncertain attempt even when file metadata is identical', async () => {
    const source = build();
    const footer = source.conversation.composerFooter!({ audienceId: 'shared_it', disabled: false }) as React.ReactElement<any>;
    const staging = footer.props.staging;
    const first = new File(['one'], 'same.txt', { type: 'text/plain', lastModified: 10 });
    const replacement = new File(['two'], 'same.txt', { type: 'text/plain', lastModified: 10 });
    staging.add([first]);
    mocks.submit.mockRejectedValueOnce(new Error('Lost response'));
    const send = () => source.comments.addTicketCommentWithCacheForCurrentUser('ticket-a', 'message', false, false, false, undefined, undefined, undefined, { audienceId: 'shared_it' });
    await send();
    staging.remove(staging.getSnapshot()[0].key);
    staging.add([replacement]);
    await send();
    expect(mocks.prepare).toHaveBeenCalledTimes(2);
    expect(mocks.prepare.mock.calls[1][0].files).toEqual([replacement]);
    expect(mocks.prepare.mock.calls[1][0].operationId).not.toBe(mocks.prepare.mock.calls[0][0].operationId);
  });

  it('keeps newly selected files when a previous message finishes publication', async () => {
    const source = build();
    const footer = source.conversation.composerFooter!({ audienceId: 'shared_it', disabled: false }) as React.ReactElement<any>;
    const staging = footer.props.staging;
    const first = new File(['one'], 'first.txt');
    const next = new File(['two'], 'next.txt');
    staging.add([first]);
    let release!: (value: any) => void;
    mocks.submit.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const saving = source.comments.addTicketCommentWithCacheForCurrentUser('ticket-a', 'message', false);
    await waitFor(() => expect(release).toBeTypeOf('function'));
    staging.add([next]);
    release({ ok: true, receipt: { commentId: 'own', storeTenant: 'customer-a', threadId: 'town' } });
    await saving;
    expect(staging.getSnapshot().map((item: any) => item.file)).toEqual([next]);
  });
});

describe('T012 MSP shared route', () => {
  it('renders customer and MSP-private comment attachments through the native comment slot and omits tombstones', async () => {
    mocks.page.mockResolvedValue({ items: [item(), own({ storeTenant: 'msp-home' }), item({ commentId: 'deleted', deleted: true })],
      nextBefore: null, actor, writeAudiences: ['shared_it'], draftAttachments: { audiences: [], maxBytes: 1, maxFiles: 1 } });
    render(<SharedTicketScreen resource={resource} initialDetails={baseDetails()} />);
    const links = await screen.findAllByRole('link', { name: 'Shared evidence file' });
    expect(links.map(link => link.getAttribute('href'))).toEqual([
      '/attachments/customer-a/relationship-a/ticket-a/customer-a/t1/c1',
      '/attachments/customer-a/relationship-a/ticket-a/msp-home/town/own',
    ]);
  });
  it('renders the native container under the shared data source, with the section slot and a read-only viewer frozen', async () => {
    mocks.details.mockResolvedValue(baseDetails(false));
    render(<SharedTicketScreen resource={resource} initialDetails={baseDetails(false)} />);
    await waitFor(() => expect(probe.source).not.toBeNull());
    expect(probe.source!.kind).toBe('shared');
    expect(probe.source!.screen.readOnly).toBe(true);
    expect(probe.source!.slots.coManagedSection).toBeTypeOf('function');
    expect(probe.props.ticketData.client).toEqual({ client_name: 'Customer A · End Client' });
  });

  it('shows a clear error, not the container, when the ticket cannot be loaded', () => {
    render(<SharedTicketScreen resource={resource} initialDetails={null} />);
    expect(screen.getByRole('alert')).toHaveTextContent('coManaged.ticket.loadError');
    expect(screen.queryByText('coManaged.ticket.restricted')).not.toBeNull();
    expect(probe.source).toBeNull();
  });

  it('preserves the originating qualified queue in native back navigation', async () => {
    const backHref = '/msp/tickets/customer?queueView=oversight&workspace=all&searchQuery=printer&queueSort=title&pageSize=1';
    render(<SharedTicketScreen resource={resource} initialDetails={baseDetails()} backHref={backHref} />);
    await waitFor(() => expect(probe.source).not.toBeNull());
    expect(probe.source!.screen.backHref).toBe(backHref);
  });

  it('keeps the page on the native screen: shared screen inside the feature boundary, no stacked panel', () => {
    const page = readFileSync(path.resolve(__dirname, '../../../app/msp/co-management/tickets/[customerTenant]/[relationshipId]/[ticketId]/page.tsx'), 'utf8');
    expect(page).toMatch(/<CoManagedFeatureBoundary><SharedTicketScreen /);
    expect(page).toMatch(/getSharedTicketDetailsAction/);
    expect(page).not.toMatch(/CoManagedTicketPanel/);
  });
});
