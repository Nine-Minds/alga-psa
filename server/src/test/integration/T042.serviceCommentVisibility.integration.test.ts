import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createServiceUser } from '../../../test-utils/serviceUserFixtures';
import Comment from '../../../../packages/tickets/src/models/comment';
import { HumanWorkOwnerRequiredError } from '../../../../shared/lib/humanWork/HumanWorkOwnerRequiredError';

// T042 (F101/F016): CE rule for non-interactive comment authors.
describe('T042 service-author ticket comment visibility (CE rule)', () => {
  let knex: Knex;
  let tenant: string;
  let ticketId: string;
  let internalUserId: string;
  let serviceUserId: string;
  let clientUserId: string;
  const createdCommentIds: string[] = [];

  const table = (name: string) => tenantDb(knex, tenant).table(name);

  const insert = async (userId: string | undefined, extra: Record<string, unknown>) => {
    const id = await Comment.insert(knex, tenant, {
      ticket_id: ticketId,
      ...(userId ? { user_id: userId } : {}),
      author_type: 'internal',
      note: 'T042 comment',
      markdown_content: 'T042 comment',
      is_resolution: false,
      ...extra,
    } as any);
    createdCommentIds.push(id);
    return id;
  };

  const commentCount = async () =>
    Number((await table('comments').where({ tenant, ticket_id: ticketId }).count('* as c').first())?.c);
  const threadCount = async () =>
    Number((await table('comment_threads').where({ tenant, ticket_id: ticketId }).count('* as c').first())?.c);
  const row = (id: string) => table('comments').where({ tenant, comment_id: id }).first();

  beforeAll(async () => {
    knex = await createTestDbConnection();
    const discovery = tenantDb(knex, '__test_discovery__');
    const q = discovery.unscoped('tickets as t', 'T042 discovery of seeded ticket/user context');
    discovery.tenantJoin(q, 'users as u', 'u.tenant', 't.tenant');
    const ctx = await q.select('t.tenant', 't.ticket_id', 'u.user_id').first();
    tenant = ctx.tenant;
    ticketId = ctx.ticket_id;
    internalUserId = ctx.user_id;
    serviceUserId = (await createServiceUser(knex, tenant)).userId;
    clientUserId = uuidv4();
    await table('users').insert({
      tenant,
      user_id: clientUserId,
      username: `t042-client-${clientUserId.slice(0, 8)}`,
      email: `t042-${clientUserId.slice(0, 8)}@client.test`,
      first_name: 'Portal',
      last_name: 'Client',
      hashed_password: 'x',
      user_type: 'client',
    });
  });

  afterAll(async () => {
    const rows = createdCommentIds.length
      ? await table('comments').select('thread_id').whereIn('comment_id', createdCommentIds)
      : [];
    if (createdCommentIds.length) await table('comments').whereIn('comment_id', createdCommentIds).delete();
    const threadIds = rows.map((r: any) => r.thread_id).filter(Boolean);
    if (threadIds.length) await table('comment_threads').whereIn('thread_id', threadIds).delete();
    await table('users').whereIn('user_id', [serviceUserId, clientUserId]).delete();
    await knex.destroy();
  });

  it('stores a service author comment with unspecified visibility as internal', async () => {
    const id = await insert(serviceUserId, {});
    const stored = await row(id);
    expect(stored.is_internal).toBe(true);
    expect(stored.user_id).toBe(serviceUserId);
    expect(stored.author_type).toBe('internal'); // enum unchanged; kind is recovered from users.user_type
    expect((await table('comment_threads').where({ tenant, thread_id: stored.thread_id }).first()).is_internal).toBe(true);
  });

  it('allows explicit is_internal=true for a service author', async () => {
    const id = await insert(serviceUserId, { is_internal: true });
    expect((await row(id)).is_internal).toBe(true);
  });

  it('throws HumanWorkOwnerRequiredError(is_internal) for explicit public and stores nothing', async () => {
    const comments = await commentCount();
    const threads = await threadCount();
    let error: unknown;
    try {
      await insert(serviceUserId, { is_internal: false });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(HumanWorkOwnerRequiredError);
    expect((error as HumanWorkOwnerRequiredError).field).toBe('is_internal');
    expect((error as HumanWorkOwnerRequiredError).code).toBe('HUMAN_WORK_OWNER_REQUIRED');
    expect(await commentCount()).toBe(comments);
    expect(await threadCount()).toBe(threads);
  });

  it('leaves internal authors unchanged (public stays public, unspecified stays non-internal)', async () => {
    const publicId = await insert(internalUserId, { is_internal: false });
    expect((await row(publicId)).is_internal).toBe(false);
    const internalId = await insert(internalUserId, { is_internal: true });
    expect((await row(internalId)).is_internal).toBe(true);
  });

  it('leaves client-portal (client user) comments unchanged', async () => {
    const id = await insert(clientUserId, { author_type: 'client', is_internal: false });
    const stored = await row(id);
    expect(stored.is_internal).toBe(false);
    expect(stored.author_type).toBe('client');
  });

  it('leaves inbound-email style comments (no user) unchanged', async () => {
    const id = await insert(undefined, { author_type: 'unknown', is_internal: false });
    const stored = await row(id);
    expect(stored.is_internal).toBe(false);
    expect(stored.author_type).toBe('unknown');
  });
});
