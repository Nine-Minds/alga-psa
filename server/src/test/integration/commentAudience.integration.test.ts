import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { commentAudienceSql } from '@alga-psa/shared/lib/commentAudience';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import Comment from '../../../../packages/tickets/src/models/comment';

/**
 * CM L4a: audience on the thread. Exercises the real schema (migrations applied by the
 * vitest global setup): native neutrality, fail-closed co_managed writes, the shared SQL
 * facet across a persona matrix, tombstones, and replies inheriting the thread audience.
 */
describe('conversation audiences (integration)', () => {
  let knex: Knex;
  let tenant: string;
  let ticketId: string;
  let userId: string;
  let originalProduct: string | null;
  const created: string[] = [];

  const t = (table: string) => tenantDb(knex, tenant).table(table);

  function resetAdmission(coManaged: boolean) {
    (globalThis as any).__algaWriteAdmissionState = undefined;
    (globalThis as any).__algaWriteAdmissionResolver = coManaged ? async () => ({ canWrite: true }) : undefined;
  }

  async function setProduct(code: string | null) {
    await tenantDb(knex, '__test__').unscoped('tenants', 'test product toggle').where('tenant', tenant).update({ product_code: code });
  }

  async function insert(fields: Record<string, unknown>) {
    const id = await Comment.insert(knex, tenant, {
      ticket_id: ticketId, user_id: userId, author_type: 'internal',
      note: 'n', markdown_content: 'n', is_resolution: false, ...fields,
    } as any);
    created.push(id);
    return id;
  }

  async function threadOf(commentId: string) {
    const c = await t('comments').where({ comment_id: commentId }).first('thread_id');
    return t('comment_threads').where({ thread_id: c.thread_id }).first();
  }

  async function audienceOf(commentId: string) {
    const row = await tenantDb(knex, tenant).table('comments as c')
      .join('comment_threads as th', function () { this.on('th.thread_id', 'c.thread_id').andOn('th.tenant', 'c.tenant'); })
      .where('c.comment_id', commentId).where('c.tenant', tenant)
      .select(knex.raw('(?) as audience', [commentAudienceSql(knex, 'th', 'c')])).first();
    return row?.audience;
  }

  beforeAll(async () => {
    knex = await createTestDbConnection();
    const d = tenantDb(knex, '__test_discovery__');
    const q = d.unscoped('tickets as t', 'test discovery');
    d.tenantJoin(q, 'users as u', 'u.tenant', 't.tenant');
    const ctx = await q.select('t.tenant', 't.ticket_id', 'u.user_id').first();
    ({ tenant, ticket_id: ticketId, user_id: userId } = ctx as any);
    const row = await tenantDb(knex, '__test__').unscoped('tenants', 'read product').where('tenant', tenant).first('product_code');
    originalProduct = row?.product_code ?? null;
  });

  afterEach(async () => {
    await setProduct(originalProduct);
    resetAdmission(false);
  });

  afterAll(async () => {
    for (const id of created.reverse()) {
      const c = await t('comments').where({ comment_id: id }).first('thread_id');
      await t('comments').where({ comment_id: id }).delete();
      if (c?.thread_id) await t('comment_threads').where({ thread_id: c.thread_id }).delete().catch(() => undefined);
    }
    await knex.destroy();
  });

  it('native psa tenant: threads keep a NULL audience, public and internal alike', async () => {
    resetAdmission(true);
    await setProduct('psa');
    const pub = await insert({ is_internal: false });
    const note = await insert({ is_internal: true });
    expect((await threadOf(pub)).collaboration_audience).toBeNull();
    expect((await threadOf(note)).collaboration_audience).toBeNull();
    expect(await audienceOf(pub)).toBe('requester');
    // A legacy internal note is private, never shared_it.
    expect(await audienceOf(note)).toBe('organization_private');
  });

  it('co_managed workspace: a staff public comment without an audience fails closed', async () => {
    resetAdmission(true);
    await setProduct('co_managed');
    await expect(insert({ is_internal: false })).rejects.toMatchObject({ code: 'CO_MANAGED_AUDIENCE_REQUIRED' });
  });

  it('co_managed workspace: named audiences are stored on the thread and resolved by the shared facet', async () => {
    resetAdmission(true);
    await setProduct('co_managed');
    const pub = await insert({ is_internal: false, collaboration_audience: 'requester' });
    const priv = await insert({ is_internal: true, collaboration_audience: 'organization_private' });
    expect((await threadOf(pub)).collaboration_audience).toBe('requester');
    expect((await threadOf(priv)).collaboration_audience).toBe('organization_private');
    expect(await audienceOf(pub)).toBe('requester');
    expect(await audienceOf(priv)).toBe('organization_private');
  });

  it('rejects an audience that contradicts the visibility flag', async () => {
    resetAdmission(true);
    await setProduct('co_managed');
    await expect(insert({ is_internal: false, collaboration_audience: 'organization_private' })).rejects.toMatchObject({ code: 'COMMENT_AUDIENCE_INVALID' });
    await expect(insert({ is_internal: true, collaboration_audience: 'requester' })).rejects.toMatchObject({ code: 'COMMENT_AUDIENCE_INVALID' });
  });

  it('DB CHECK ties collaboration_audience to is_internal', async () => {
    const root = await insert({ is_internal: true });
    const thread = await threadOf(root);
    await expect(t('comment_threads').where({ thread_id: thread.thread_id }).update({ collaboration_audience: 'requester' })).rejects.toThrow();
  });

  it('a reply inherits the thread audience and refuses a different one', async () => {
    resetAdmission(true);
    await setProduct('co_managed');
    const root = await insert({ is_internal: true, collaboration_audience: 'organization_private' });
    const reply = await insert({ is_internal: true, parent_comment_id: root });
    expect(await audienceOf(reply)).toBe('organization_private');
    await expect(insert({ is_internal: false, parent_comment_id: root })).rejects.toBeTruthy();
  });

  it('deleting a root with replies leaves a tombstone, keeps replies and the audience', async () => {
    resetAdmission(true);
    await setProduct('co_managed');
    const root = await insert({ is_internal: false, collaboration_audience: 'requester', note: 'secret body', markdown_content: 'secret body' });
    const reply = await insert({ is_internal: false, parent_comment_id: root });
    await Comment.delete(knex, tenant, root);
    const tomb = await t('comments').where({ comment_id: root }).first();
    expect(tomb.deleted_at).toBeTruthy();
    expect(JSON.stringify(tomb)).not.toContain('secret body');
    expect(await t('comments').where({ comment_id: reply }).first()).toBeTruthy();
    expect((await threadOf(root)).collaboration_audience).toBe('requester');
  });

  it('inconsistent legacy rows resolve private', async () => {
    const root = await insert({ is_internal: false });
    await t('comments').where({ comment_id: root }).update({ is_internal: true });
    expect(await audienceOf(root)).toBe('organization_private');
  });
});
