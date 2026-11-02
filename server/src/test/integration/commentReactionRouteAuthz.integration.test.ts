// Regression for alga-2026-0002994: POST /api/v1/tickets/{id}/comments/{commentId}/reactions must
// bind the comment to the path ticket and apply the record-level ticket policy.
import 'server/test-utils/testMocks';

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { TestContext } from 'server/test-utils/testContext';
import { setupCommonMocks } from 'server/test-utils/testMocks';

const ref = vi.hoisted(() => ({
  knex: null as any,
  tenant: '' as string,
  user: null as any,
  deniedTicketIds: new Set<string>(),
}));

// API-key seam: authenticateApiKeyRequest returns the request with a ready user context.
vi.mock('@/lib/api/middleware/apiAuthMiddleware', () => ({
  authenticateApiKeyRequest: vi.fn(async (req: any) => {
    req.context = { tenant: ref.tenant, userId: ref.user.user_id, user: ref.user, kind: 'user' };
    return req;
  }),
}));
vi.mock('@/lib/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('@/lib/db/db', () => ({ getConnection: vi.fn(async () => ref.knex) }));

// Row-level ticket policy (bundle/relationship narrowing) is exercised in the authorization suites;
// here the real check runs except for tickets listed in deniedTicketIds, refused as the kernel would.
vi.mock('@alga-psa/tickets/lib/ticketRecordAuthorization', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/tickets/lib/ticketRecordAuthorization')>();
  return {
    ...actual,
    authorizeTicketRecordAccess: vi.fn(async (input: any) => {
      if (ref.deniedTicketIds.has(input.ticketId)) throw new Error('Permission denied: Cannot access ticket');
      return actual.authorizeTicketRecordAccess(input);
    }),
  };
});

import { POST } from '../../app/api/v1/tickets/[id]/comments/[commentId]/reactions/route';

const HOOK_TIMEOUT = 120_000;
const EMOJI = '\u{1F44D}';

const {
  beforeAll: setupContext,
  beforeEach: resetContext,
  afterEach: rollbackContext,
  afterAll: cleanupContext,
} = TestContext.createHelpers();

let context: TestContext;
const scoped = () => tenantDb(context.db, context.tenantId);

beforeAll(async () => {
  context = await setupContext({
    runSeeds: true,
    cleanupTables: ['comment_reactions', 'comments', 'comment_threads', 'tickets'],
  });
}, HOOK_TIMEOUT);

afterAll(async () => {
  await cleanupContext();
}, HOOK_TIMEOUT);

describe('REST comment reaction POST authorization', () => {
  let ticketA: string;
  let ticketB: string;
  let commentA: string;
  let commentB: string;

  async function createTicketWithComment(title: string, statusId: string) {
    const ticketId = uuidv4();
    const commentId = uuidv4();
    const threadId = uuidv4();
    await scoped().table('tickets').insert({
      ticket_id: ticketId,
      tenant: context.tenantId,
      ticket_number: `T-${uuidv4().slice(0, 8)}`,
      title,
      status_id: statusId,
      client_id: context.clientId,
      entered_by: context.userId,
    });
    await scoped().table('comment_threads').insert({
      tenant: context.tenantId, thread_id: threadId, ticket_id: ticketId, root_comment_id: commentId, is_internal: false,
    });
    await scoped().table('comments').insert({
      comment_id: commentId, tenant: context.tenantId, ticket_id: ticketId, thread_id: threadId,
      user_id: context.userId, note: '[]', is_internal: false, is_resolution: false, author_type: 'internal',
    });
    return { ticketId, commentId };
  }

  async function post(ticketId: string, commentId: string, body: unknown = { emoji: EMOJI }) {
    const req = new NextRequest(`http://localhost/api/v1/tickets/${ticketId}/comments/${commentId}/reactions`, {
      method: 'POST',
      headers: { 'x-api-key': 'test', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const res = await POST(req, { params: Promise.resolve({ id: ticketId, commentId }) });
    return { status: res.status, body: await res.json() };
  }

  const reactionRows = (commentId: string) =>
    scoped().table('comment_reactions').where({ comment_id: commentId, user_id: context.userId, emoji: EMOJI });

  beforeEach(async () => {
    context = await resetContext();
    setupCommonMocks({ tenantId: context.tenantId, userId: context.userId, user: context.user, permissionCheck: () => true });
    ref.knex = context.db;
    ref.tenant = context.tenantId;
    ref.user = context.user;
    ref.deniedTicketIds.clear();

    let status = await scoped().table('statuses').where({ status_type: 'ticket' }).first();
    if (!status) {
      [status] = await scoped().table('statuses').insert({
        tenant: context.tenantId, name: 'Open', status_type: 'ticket', order_number: 1,
        created_by: context.userId, is_closed: false, is_default: true,
      }).returning('status_id');
    }
    ({ ticketId: ticketA, commentId: commentA } = await createTicketWithComment('A', status.status_id));
    ({ ticketId: ticketB, commentId: commentB } = await createTicketWithComment('B', status.status_id));
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    await rollbackContext();
  }, HOOK_TIMEOUT);

  it("404s and writes nothing for ticket B's comment posted under ticket A", async () => {
    const res = await post(ticketA, commentB);
    expect(res.status).toBe(404);
    expect(await reactionRows(commentB)).toHaveLength(0);
  });

  it('403s and writes nothing when the caller cannot update the record', async () => {
    ref.deniedTicketIds.add(ticketA);
    const res = await post(ticketA, commentA);
    expect(res.status).toBe(403);
    expect(await reactionRows(commentA)).toHaveLength(0);
  });

  it('toggles a reaction on a comment under its own ticket', async () => {
    const first = await post(ticketA, commentA);
    expect(first.status).toBe(200);
    expect(first.body.data).toEqual({ added: true });
    expect(await reactionRows(commentA)).toHaveLength(1);

    const second = await post(ticketA, commentA);
    expect(second.status).toBe(200);
    expect(second.body.data).toEqual({ added: false });
    expect(await reactionRows(commentA)).toHaveLength(0);
  });

  it('returns identical status and body for an unknown comment and a wrong-ticket comment', async () => {
    const unknown = await post(ticketA, uuidv4());
    const wrongTicket = await post(ticketA, commentB);
    expect(unknown.status).toBe(404);
    expect(wrongTicket.status).toBe(unknown.status);
    expect(wrongTicket.body).toEqual(unknown.body);
  });

  it('400s on a malformed id', async () => {
    expect((await post('not-a-uuid', commentA)).status).toBe(400);
    expect((await post(ticketA, 'not-a-uuid')).status).toBe(400);
  });
});
