/**
 * CM L4c: ONE redaction function strips hidden author / revision / reaction fields, and the REST JSON and the
 * search indexer both go through it.
 */
import { describe, expect, it, vi } from 'vitest';
import { redactTaskComment, redactTaskCommentReactions, taskCommentFieldPolicy, TASK_COMMENT_SHOW_ALL } from '@alga-psa/types';
import { projectTaskCommentIndexer } from '@alga-psa/search/indexers/project_task_comment';

const tombstone = {
  taskCommentId: 'c1', taskId: 't1', threadId: 'th1', parentCommentId: null, userId: 'u1', actorReferenceId: 'ref1', contactId: null,
  authorType: 'internal', authorKind: 'user', note: '[deleted]', markdownContent: null, createdAt: '2026-01-01', updatedAt: '2026-01-02', deletedAt: '2026-01-02',
  firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', avatarUrl: '/a.png', organizationName: 'Sponsor MSP',
  collaborationRevision: 3, audience: 'shared_it', canEdit: true, canReply: false,
} as any;

describe('redactTaskComment', () => {
  it('strips the hidden author without touching the input', () => {
    const snapshot = structuredClone(tombstone);
    const out = redactTaskComment(tombstone, { hideAuthor: true, hideRevision: false, hideReactors: false }) as any;
    expect(out).toMatchObject({ userId: null, actorReferenceId: null, avatarUrl: null, organizationName: null, firstName: '', lastName: '', email: '', canEdit: false, collaborationRevision: 3 });
    expect(tombstone).toEqual(snapshot);
  });
  it('strips the hidden revision and the affordances that depend on it', () => {
    const out = redactTaskComment({ ...tombstone, revision: 3 }, { hideAuthor: false, hideRevision: true, hideReactors: false }) as any;
    expect(out.collaborationRevision).toBeUndefined();
    expect(out).toMatchObject({ revision: null, canEdit: false, canReply: false, userId: 'u1' });
  });
  it('is the identity when nothing is hidden', () => {
    expect(redactTaskComment(tombstone, TASK_COMMENT_SHOW_ALL)).toEqual(tombstone);
  });
  it('builds a policy from the reader predicate', () => {
    expect(taskCommentFieldPolicy(fields => fields[0] === 'reactions')).toEqual({ hideAuthor: false, hideRevision: false, hideReactors: true });
  });
  it('reactions keep the count but lose the reactor identities', () => {
    const batch = { reactions: { c1: [{ emoji: '👍', count: 2, userIds: ['u1', 'u2'], currentUserReacted: true }] }, userNames: { u1: 'Ada', u2: 'Bob' } } as any;
    const out = redactTaskCommentReactions(batch, { hideAuthor: false, hideRevision: false, hideReactors: true });
    expect(out.reactions.c1[0]).toMatchObject({ emoji: '👍', count: 2, userIds: [] });
    expect(out.userNames).toEqual({});
    expect(redactTaskCommentReactions(batch, TASK_COMMENT_SHOW_ALL)).toBe(batch);
  });
});

describe('search indexer', () => {
  function knexWith(row: unknown) {
    const join = { on: vi.fn().mockReturnThis(), andOn: vi.fn().mockReturnThis() };
    const q: any = {
      join: vi.fn((_t: string, cb: (this: typeof join) => void) => { cb.call(join); return q; }),
      leftJoin: vi.fn((_t: string, cb: (this: typeof join) => void) => { cb.call(join); return q; }),
      select: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), whereNull: vi.fn().mockReturnThis(), whereNotNull: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(), groupBy: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(), first: vi.fn().mockResolvedValue(row),
    };
    const knex: any = vi.fn().mockReturnValue(q);
    knex.raw = vi.fn((sql: string) => ({ sql }));
    return knex;
  }
  const tenant = '11111111-1111-4111-8111-111111111111';
  const row = { task_comment_id: 'c1', task_id: 't1', note: null, markdown_content: 'hello', task_name: 'Task', project_id: 'p1', project_name: 'P', client_id: 'cl',
    user_id: 'u1', actor_reference_id: 'ref1', contact_id: 'ct1', collaboration_revision: null, updated_at: '2026-01-02T00:00:00.000Z' };

  // Neutrality: the indexer is main's. A native row yields exactly main's document (no metadata, no author block),
  // and selects no L4c column, so it also runs on a schema without the L4c migrations.
  it('a native row produces main\'s SearchDoc unchanged and selects no L4c column', async () => {
    const knex = knexWith(row);
    const doc = await projectTaskCommentIndexer.loadOne(knex as never, tenant, 'c1');
    expect(doc).toEqual({
      tenant, objectType: 'project_task_comment', objectId: 'c1', parentType: 'project_task', parentId: 't1', title: 'Task', subtitle: 'P', body: 'hello',
      url: '/msp/projects/p1?taskId=t1#comment-c1', acl: { requiredPermission: 'project:read', clientScopeId: 'cl' }, sourceUpdatedAt: new Date('2026-01-02T00:00:00.000Z'),
    });
    expect('metadata' in (doc as object)).toBe(false);
    const selected = JSON.stringify(knex().select.mock.calls);
    expect(selected).not.toMatch(/user_id|actor_reference_id|contact_id|collaboration_revision/);
  });
});
