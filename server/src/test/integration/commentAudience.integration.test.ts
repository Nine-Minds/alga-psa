import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { retainBuiltinResolverSubject } from '@alga-psa/authorization/subject';
import { CO_MANAGED_SEAT_RESOLVER_ID } from '@alga-psa/co-managed/seatAuthority';
import { randomUUID } from 'node:crypto';
import {
  commentAudienceSql, commentAudienceVisibleSql, isCommentAudienceVisible, resolveCommentAudienceForRead,
  resolveCommentAudienceReader, type CommentAudienceReader,
} from '@alga-psa/shared/lib/commentAudience';
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
  const seatArrangements: string[] = [];
  const seatUsers: string[] = [];

  /** A seat arrangement row for a client, written directly: no command creates assignments yet. */
  async function seatArrangement(clientId: string, state: 'active' | 'ended' = 'active') {
    const arrangementId = randomUUID();
    seatArrangements.push(arrangementId);
    await t('co_managed_seat_arrangements').insert({ tenant, arrangement_id: arrangementId, client_id: clientId, allocation_id: randomUUID(),
      state, ended_at: state === 'ended' ? new Date() : null });
    return arrangementId;
  }

  /** An assignment binds a real user (foreign key to `users`), so the default is a new internal user. */
  async function seatAssignment(arrangementId: string, state: 'invited' | 'active' | 'revoked', seatUserId?: string | null) {
    if (seatUserId === undefined) {
      seatUserId = randomUUID();
      await t('users').insert({ tenant, user_id: seatUserId, username: `seat.${seatUserId.slice(0, 8)}`, email: `seat.${seatUserId.slice(0, 8)}@example.test`,
        hashed_password: 'not-used', user_type: 'internal', is_inactive: false });
      seatUsers.push(seatUserId);
    }
    await knex.transaction(async trx => {
      if (seatUserId !== null) {
        await retainBuiltinResolverSubject(trx, { tenant, userId: seatUserId as string }, CO_MANAGED_SEAT_RESOLVER_ID);
      }
      await tenantDb(trx, tenant).table('co_managed_seat_assignments').insert({ tenant, assignment_id: randomUUID(), arrangement_id: arrangementId, user_id: seatUserId,
        state, revoked_at: state === 'revoked' ? new Date() : null });
    });
    return seatUserId as string;
  }

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
    for (const id of seatArrangements) {
      await t('co_managed_seat_assignments').where({ arrangement_id: id }).delete();
      await t('co_managed_seat_arrangements').where({ arrangement_id: id }).delete();
    }
    await t('authorization_resolver_subjects').where({ resolver_id: CO_MANAGED_SEAT_RESOLVER_ID }).whereIn('user_id', seatUsers).delete();
    if (seatUsers.length > 0) await t('users').whereIn('user_id', seatUsers).delete();
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

  // T022 (F035-F038): the SQL form agrees with the TypeScript form on the same rows.
  it('the SQL visibility form agrees with the TypeScript predicate for every reader organization', async () => {
    resetAdmission(true);
    await setProduct('psa');
    const { client_id: clientId } = await t('tickets').where({ ticket_id: ticketId }).first('client_id');
    expect(clientId).toBeTruthy();

    const relabel = async (commentId: string, audience: string) =>
      t('comment_threads').where({ thread_id: (await threadOf(commentId)).thread_id }).update({ collaboration_audience: audience });
    const publicLegacy = await insert({ is_internal: false });
    const internalLegacy = await insert({ is_internal: true });
    const shared = await insert({ is_internal: true });
    await relabel(shared, 'shared_it');
    const sharedReply = await insert({ is_internal: true, parent_comment_id: shared });
    const privateNote = await insert({ is_internal: true });
    await relabel(privateNote, 'organization_private');
    const requesterNamed = await insert({ is_internal: false });
    await relabel(requesterNamed, 'requester');
    // Damaged rows: the comment disagrees with its thread.
    const damagedPublic = await insert({ is_internal: false });
    await t('comments').where({ comment_id: damagedPublic }).update({ is_internal: true });
    const damagedShared = await insert({ is_internal: true });
    await relabel(damagedShared, 'shared_it');
    await t('comments').where({ comment_id: damagedShared }).update({ is_internal: false });
    const ids = [publicLegacy, internalLegacy, shared, sharedReply, privateNote, requesterNamed, damagedPublic, damagedShared];

    const readers: Record<string, CommentAudienceReader | null> = {
      'MSP staff': { kind: 'staff', tenant },
      'staff of another tenant': { kind: 'staff', tenant: randomUUID() },
      "the client's seat technician": { kind: 'seat', tenant, clientId },
      "another client's seat technician": { kind: 'seat', tenant, clientId: randomUUID() },
      "another tenant's seat technician": { kind: 'seat', tenant: randomUUID(), clientId },
      requester: { kind: 'requester', tenant },
      'nobody': null,
    };
    const seen: Record<string, string[]> = {};
    for (const [name, reader] of Object.entries(readers)) {
      const db = tenantDb(knex, tenant);
      const query = db.table('comments as c').whereIn('c.comment_id', ids);
      db.tenantJoin(query, 'comment_threads as th', 'c.thread_id', 'th.thread_id');
      db.tenantJoin(query, 'comments as root', 'th.root_comment_id', 'root.comment_id');
      db.tenantJoin(query, 'tickets as tk', 'c.ticket_id', 'tk.ticket_id');
      const rows = await query.select({
        comment_id: 'c.comment_id', owner_tenant: 'c.tenant', owner_client: 'tk.client_id',
        collaboration_audience: 'th.collaboration_audience', is_internal: 'th.is_internal',
        root_is_internal: 'root.is_internal', comment_is_internal: 'c.is_internal',
        audience: commentAudienceSql(knex, 'th', 'root', 'c'),
        visible: commentAudienceVisibleSql(knex, reader, { thread: 'th', root: 'root', comment: 'c', ownerTenant: 'c.tenant', ownerClient: 'tk.client_id' }),
      });
      expect(rows).toHaveLength(ids.length);
      for (const row of rows) {
        const audience = resolveCommentAudienceForRead(row);
        expect(row.audience, `${name} audience of ${row.comment_id}`).toBe(audience);
        expect(row.visible, `${name} sees ${row.comment_id} (${audience})`)
          .toBe(isCommentAudienceVisible(audience, { tenant: row.owner_tenant, clientId: row.owner_client }, reader));
      }
      seen[name] = rows.filter(row => row.visible).map(row => row.comment_id).sort();
    }
    const sorted = (...list: string[]) => [...list].sort();
    expect(seen['MSP staff']).toEqual(sorted(...ids));
    // F036/F037/F038: shared_it and requester threads, never a private or legacy internal one.
    expect(seen["the client's seat technician"]).toEqual(sorted(publicLegacy, shared, sharedReply, requesterNamed));
    expect(seen['staff of another tenant']).toEqual(sorted(publicLegacy, shared, sharedReply, requesterNamed));
    expect(seen.requester).toEqual(sorted(publicLegacy, requesterNamed));
    expect(seen["another client's seat technician"]).toEqual([]);
    expect(seen["another tenant's seat technician"]).toEqual([]);
    expect(seen.nobody).toEqual([]);
  });

  // F035: a seat technician's organization comes from the seat assignment.
  it('resolves the reader organization from the live seat assignment', async () => {
    const resolve = (id: string, userType = 'internal') => resolveCommentAudienceReader(knex, tenant, { userId: id, userType });
    // No assignment: an internal user is MSP staff, a client user the requester. This is every user today.
    expect(await resolve(randomUUID())).toEqual({ kind: 'staff', tenant });
    expect(await resolve(randomUUID(), 'client')).toEqual({ kind: 'requester', tenant });
    expect(await resolve(randomUUID(), 'something_else')).toBeNull();
    expect(await resolve('')).toBeNull();

    const clientId = randomUUID();
    const live = await seatArrangement(clientId);
    const active = await seatAssignment(live, 'active');
    expect(await resolve(active)).toEqual({ kind: 'seat', tenant, clientId });
    // Not live and not revoked: sees nothing, and is never promoted to MSP staff.
    const invited = await seatAssignment(live, 'invited');
    expect(await resolve(invited)).toBeNull();
    const ended = await seatArrangement(randomUUID(), 'ended');
    const stranded = await seatAssignment(ended, 'active');
    expect(await resolve(stranded)).toBeNull();
    const orphan = await seatAssignment(randomUUID(), 'active');
    seatArrangements.push((await t('co_managed_seat_assignments').where({ user_id: orphan }).first('arrangement_id')).arrangement_id);
    expect(await resolve(orphan)).toBeNull();
    // Revoked no longer binds the user (a converted technician is an MSP user).
    const revoked = await seatAssignment(live, 'revoked');
    expect(await resolve(revoked)).toEqual({ kind: 'staff', tenant });
    // Another tenant's assignment is not this tenant's.
    expect(await resolveCommentAudienceReader(knex, randomUUID(), { userId: active, userType: 'internal' })).toMatchObject({ kind: 'staff' });
  });
});
