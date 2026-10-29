import { describe, expect, it, vi } from 'vitest';
import { createCoManagedSharedTicketDataSource, type SharedTicketConversation } from '@/lib/co-managed/sharedTicketDataSource';
import { mapConversation, conversationAuthorMaps } from '@/lib/co-managed/sharedConversationMapping';

const summary = { revision: 1, resource: { tenant: 't1', relationshipId: 'r1', kind: 'ticket' as const, id: 'tk1' },
  fields: { ticket_number: 'T-1', title: 'Printer' } };

const item = (over: Record<string, unknown>) => ({
  commentId: 'c1', storeTenant: 't1', threadId: 'th1', parentCommentId: null, note: 'hello', markdown: null, audience: 'requester',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: null, deleted: false,
  author: { kind: 'user', tenant: 'msp', id: 'u-msp', referenceId: 'ref-1', displayName: 'Quinn', organizationName: 'MSP Co' }, ...over,
}) as any;

function fakeConversation(audiences: any[]): SharedTicketConversation & { write: ReturnType<typeof vi.fn> } {
  const comments = [{ comment_id: 'c1', audience: 'shared_it' }] as any[];
  return {
    load: vi.fn(async () => undefined), comments: () => comments, writeAudiences: () => audiences,
    write: vi.fn(async (m: any) => ({ comment_id: 'new', note: m.content, audience: m.audience }) as any),
    audienceOf: (id: string) => (id === 'c1' ? 'shared_it' : undefined),
  };
}

describe('shared conversation mapping', () => {
  it('shapes foreign authors by reference and the viewer\'s own by id, oldest first, without deleted items', () => {
    const viewer = { tenant: 'msp', userId: 'u-msp' };
    const mapped = mapConversation([
      item({ commentId: 'b', createdAt: '2026-01-02T00:00:00.000Z', audience: 'organization_private', author: { kind: 'user', tenant: 'cust', id: 'u-c', referenceId: 'r2', displayName: 'Alice', organizationName: 'Cust' } }),
      item({ commentId: 'a' }),
      item({ commentId: 'gone', deleted: true }),
    ], 'tk1', viewer);
    expect(mapped.map(c => c.comment_id)).toEqual(['a', 'b']);
    expect(mapped[0]).toMatchObject({ user_id: 'u-msp', is_internal: false });
    expect(mapped[1]).toMatchObject({ actor_reference_id: 'r2', actor_display_name: 'Alice', is_internal: true });
    expect((mapped[1] as any).user_id).toBeUndefined();
    expect(conversationAuthorMaps([item({})], viewer).userMap['u-msp']).toBeTruthy();
  });
});

describe('shared ticket data source with a conversation', () => {
  it('is writable for the conversation only, offering exactly the server-resolved audiences', () => {
    const source = createCoManagedSharedTicketDataSource(summary, '/back', fakeConversation(['requester', 'shared_it', 'organization_private']));
    expect(source.screen.readOnly).toBe(false);
    expect(source.conversation.audiences).toEqual(['requester', 'shared_it', 'organization_private']);
    expect(() => (source.ticket.updateTicket as any)()).toThrow(/read-only/);
  });

  it('stays read-only when the viewer may write nowhere', () => {
    const source = createCoManagedSharedTicketDataSource(summary, '/back', fakeConversation([]));
    expect(source.screen.readOnly).toBe(true);
    expect(source.conversation.audiences).toBeUndefined();
  });

  it('posts every audience through the writer, never the native action', async () => {
    const conversation = fakeConversation(['requester', 'shared_it', 'organization_private']);
    const source = createCoManagedSharedTicketDataSource(summary, '/back', conversation);
    for (const audience of ['shared_it', 'requester', 'organization_private']) {
      const result = await (source.comments.addTicketCommentWithCacheForCurrentUser as any)('tk1', 'hi', true, false, false, undefined, undefined, undefined, audience);
      expect(result).toMatchObject({ audience });
    }
    expect(conversation.write.mock.calls.map(c => c[0].audience)).toEqual(['shared_it', 'requester', 'organization_private']);
  });

  it('fails closed without an audience, for a resolution, and for an audience the viewer lacks', async () => {
    const conversation = fakeConversation(['requester']);
    const source = createCoManagedSharedTicketDataSource(summary, '/back', conversation);
    const add = source.comments.addTicketCommentWithCache as any;
    expect(await add('tk1', 'hi', true)).toHaveProperty('actionError');
    expect(await add('tk1', 'hi', true, true, false, undefined, undefined, undefined, 'requester')).toHaveProperty('actionError');
    expect(await add('tk1', 'hi', true, false, false, undefined, undefined, undefined, 'shared_it')).toHaveProperty('actionError');
    expect(conversation.write).not.toHaveBeenCalled();
  });

  it('a reply without an audience inherits the parent thread audience', async () => {
    const conversation = fakeConversation(['requester', 'shared_it']);
    const source = createCoManagedSharedTicketDataSource(summary, '/back', conversation);
    await (source.comments.createComment as any)({ note: 'reply', parent_comment_id: 'c1' });
    expect(conversation.write).toHaveBeenCalledWith({ content: 'reply', audience: 'shared_it', parentCommentId: 'c1' });
  });

  it('reads the loaded conversation', async () => {
    const source = createCoManagedSharedTicketDataSource(summary, '/back', fakeConversation(['requester']));
    expect(await source.comments.findCommentsByTicketId('tk1')).toHaveLength(1);
  });
});
