/**
 * CM L4c: the REST service shapes task comments through the same single redaction function as the UI and the
 * indexer, so a hidden author/revision never appears in the API JSON.
 */
import { describe, expect, it, vi } from 'vitest';

// Shaping is pure; the DB-backed service modules (and their event publishing graph) are not needed to test it.
vi.mock('@alga-psa/projects/lib/taskComments/taskCommentService', () => ({}));
vi.mock('@alga-psa/projects/lib/taskComments/taskCommentAuthorization', () => ({}));
vi.mock('@alga-psa/db', () => ({ BaseService: class {} }));
vi.mock('../../lib/api/middleware/apiMiddleware', () => ({ ConflictError: class extends Error {}, ForbiddenError: class extends Error {}, NotFoundError: class extends Error {}, ValidationError: class extends Error {} }));
import { ProjectTaskCommentService } from '../../lib/api/services/ProjectTaskCommentService';

const tombstone = {
  taskCommentId: 'c1', taskId: 't1', threadId: 'th1', parentCommentId: null, userId: 'u1', actorReferenceId: 'ref1', contactId: null,
  authorType: 'internal', authorKind: 'user', note: '[deleted]', markdownContent: null, createdAt: '2026-01-01', updatedAt: '2026-01-02', deletedAt: '2026-01-02',
  firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', avatarUrl: '/a.png', organizationName: 'Sponsor MSP',
  collaborationRevision: 3, audience: 'shared_it', canEdit: true, canReply: false,
} as any;

describe('REST JSON', () => {
  const service = Object.create(ProjectTaskCommentService.prototype) as any;
  const hiding = (fields: string[]) => ({ hidden: (_task: string, asked: readonly string[]) => asked.some(f => fields.includes(f)) }) as any;

  it('a hidden author and revision never reach the response, and the tombstone body is not exposed', () => {
    const json = service.shape(tombstone, {}, {}, hiding(['author', 'revision']));
    expect(json).toMatchObject({ user_id: null, author: null, organization_name: null, deleted_at: '2026-01-02', note: '[deleted]', audience: 'shared_it' });
    expect('collaboration_revision' in json).toBe(false);
    expect(JSON.stringify(json)).not.toMatch(/Ada|Lovelace|ada@example\.com|Sponsor MSP|ref1/);
  });
  it('a visible author keeps its label and revision', () => {
    const json = service.shape(tombstone, {}, {}, hiding([]));
    expect(json).toMatchObject({ user_id: 'u1', organization_name: 'Sponsor MSP', collaboration_revision: 3 });
    expect(json.author).toMatchObject({ first_name: 'Ada' });
  });
  it('native (no collaboration) responses are unchanged: no collaboration keys', () => {
    const json = service.shape(tombstone, {}, {});
    expect('organization_name' in json || 'audience' in json || 'author_kind' in json).toBe(false);
  });
});

