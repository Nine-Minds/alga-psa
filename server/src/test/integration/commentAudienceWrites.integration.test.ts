import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { retainBuiltinResolverSubject } from '@alga-psa/authorization/subject';
import { CO_MANAGED_SEAT_RESOLVER_ID } from '@alga-psa/co-managed/seatAuthority';
import { randomUUID } from 'node:crypto';
import {
  changeThreadAudience, commentAudienceSql, resolveCommentAudienceReader, type CommentAudienceReader,
} from '@alga-psa/shared/lib/commentAudience';
import { TicketModel } from '@alga-psa/shared/models/ticketModel';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import Comment from '../../../../packages/tickets/src/models/comment';

/**
 * S17 (T024, T025): comment audiences enforced on native WRITES, against the real schema.
 *
 * One tenant, two tickets of two clients. Client A has a live seat arrangement with one seat
 * technician (a real internal user holding an active assignment, written directly: no invitation
 * command is on main). Client B has none. Every case goes through a real native writer:
 * `Comment.insert` (the server-action path) and `TicketModel.createComment` (the shared model).
 */
describe('comment audiences on native writes (integration)', () => {
  let knex: Knex;
  let tenant: string;
  let ticketA: string;
  let ticketB: string;
  let mspUser: string;
  let seatUser: string;
  let staff: CommentAudienceReader;
  let seat: CommentAudienceReader;
  let arrangementId: string;
  const created: string[] = [];
  const INVALID = { code: 'COMMENT_AUDIENCE_INVALID' };

  const t = (table: string) => tenantDb(knex, tenant).table(table);

  type Write = { ticket: string; user?: string; author?: CommentAudienceReader | null } & Record<string, unknown>;

  /** `Comment.insert`: the model behind the createComment server action. */
  async function viaModel({ ticket, user = mspUser, author, ...fields }: Write) {
    const id = await Comment.insert(knex, tenant, {
      ticket_id: ticket, user_id: user, author_type: 'internal',
      note: 'n', markdown_content: 'n', is_resolution: false, ...fields,
    } as any, undefined, author);
    created.push(id);
    return id;
  }

  /** `TicketModel.createComment`: the shared model used by workflows, email and the portal. */
  async function viaShared({ ticket, user = mspUser, author, ...fields }: Write) {
    const id = await knex.transaction(async trx => (await TicketModel.createComment({
      ticket_id: ticket, content: 'n', author_type: 'internal', author_id: user,
      ...(author !== undefined ? { audience_author: author } : {}), ...fields,
    } as any, tenant, trx)).comment_id);
    created.push(id);
    return id;
  }

  const WRITERS = { 'Comment.insert': viaModel, 'TicketModel.createComment': viaShared };

  async function threadOf(commentId: string) {
    const c = await t('comments').where({ comment_id: commentId }).first('thread_id');
    return t('comment_threads').where({ thread_id: c.thread_id }).first();
  }

  async function commentRow(commentId: string) {
    return t('comments').where({ comment_id: commentId }).first('thread_id', 'is_internal', 'parent_comment_id');
  }

  async function audienceOf(commentId: string) {
    const row = await tenantDb(knex, tenant).table('comments as c')
      .join('comment_threads as th', function () { this.on('th.thread_id', 'c.thread_id').andOn('th.tenant', 'c.tenant'); })
      .join('comments as root', function () { this.on('root.comment_id', 'th.root_comment_id').andOn('root.tenant', 'th.tenant'); })
      .where('c.comment_id', commentId).where('c.tenant', tenant)
      .select(knex.raw('(?) as audience', [commentAudienceSql(knex, 'th', 'root', 'c')])).first();
    return row?.audience;
  }

  const change = (threadId: string, audience: string, author: CommentAudienceReader | null, confirmDisclosure?: boolean) =>
    knex.transaction(trx => changeThreadAudience(trx, tenant, { threadId, audience, author, confirmDisclosure }));

  beforeAll(async () => {
    knex = await createTestDbConnection();
    (globalThis as any).__algaWriteAdmissionState = undefined;
    (globalThis as any).__algaWriteAdmissionResolver = undefined;
    // A tenant with tickets of two clients and two internal users, neither client arranged yet.
    const d = tenantDb(knex, '__test_discovery__');
    const found = (await d.unscoped('tickets as t', 'test discovery')
      .whereNotNull('t.client_id')
      .whereRaw(`NOT EXISTS (SELECT 1 FROM co_managed_seat_arrangements ar WHERE ar.tenant = t.tenant AND ar.client_id = t.client_id AND ar.state <> 'ended')`)
      .whereRaw(`(SELECT count(*) FROM users u WHERE u.tenant = t.tenant AND u.user_type = 'internal') >= 2`)
      .groupBy('t.tenant').havingRaw('count(DISTINCT t.client_id) >= 2')
      .select('t.tenant').first()) as { tenant: string } | undefined;
    if (!found) throw new Error('fixture: need a tenant with tickets of two clients and two internal users');
    tenant = found.tenant;
    const tickets = await t('tickets').whereNotNull('client_id').distinctOn('client_id').orderBy('client_id').limit(2).select('ticket_id', 'client_id');
    const users = await t('users').where({ user_type: 'internal' })
      .whereRaw(`NOT EXISTS (SELECT 1 FROM co_managed_seat_assignments sa WHERE sa.tenant = users.tenant AND sa.user_id = users.user_id AND sa.state <> 'revoked')`)
      .orderBy('user_id').limit(2).select('user_id');
    if (tickets.length < 2 || users.length < 2) throw new Error('fixture: two client tickets and two free internal users are required');
    [ticketA, ticketB] = tickets.map(row => row.ticket_id);
    [mspUser, seatUser] = users.map(row => row.user_id);

    arrangementId = randomUUID();
    await t('co_managed_seat_arrangements').insert({ tenant, arrangement_id: arrangementId, client_id: tickets[0].client_id, allocation_id: randomUUID(), state: 'active' });
    await knex.transaction(async trx => {
      await retainBuiltinResolverSubject(trx, { tenant, userId: seatUser }, CO_MANAGED_SEAT_RESOLVER_ID);
      await tenantDb(trx, tenant).table('co_managed_seat_assignments').insert({ tenant, assignment_id: randomUUID(), arrangement_id: arrangementId, user_id: seatUser, state: 'active' });
    });

    // Organizations come from the real resolver, exactly as an entry point would obtain them.
    staff = (await resolveCommentAudienceReader(knex, tenant, { userId: mspUser, userType: 'internal' }))!;
    seat = (await resolveCommentAudienceReader(knex, tenant, { userId: seatUser, userType: 'internal' }))!;
    expect(staff).toEqual({ kind: 'staff', tenant });
    expect(seat).toEqual({ kind: 'seat', tenant, clientId: tickets[0].client_id });
  });

  afterAll(async () => {
    if (!knex) return;
    if (tenant) {
      for (const id of [...created].reverse()) {
        const c = await t('comments').where({ comment_id: id }).first('thread_id', 'parent_comment_id');
        if (!c) continue;
        if (c.parent_comment_id) { await t('comments').where({ comment_id: id }).delete(); continue; }
        await t('comments').where({ thread_id: c.thread_id }).whereNotNull('parent_comment_id').delete();
        await t('comment_threads').where({ thread_id: c.thread_id }).delete().catch(() => undefined);
        await t('comments').where({ comment_id: id }).delete();
        await t('comment_threads').where({ thread_id: c.thread_id }).delete().catch(() => undefined);
      }
      if (arrangementId) {
        await t('co_managed_seat_assignments').where({ arrangement_id: arrangementId }).delete();
        await t('authorization_resolver_subjects').where({ resolver_id: CO_MANAGED_SEAT_RESOLVER_ID, user_id: seatUser }).delete();
        await t('co_managed_seat_arrangements').where({ arrangement_id: arrangementId }).delete();
      }
    }
    await knex.destroy();
  });

  describe.each(Object.entries(WRITERS))('T024 through %s', (_name, write) => {
    it('MSP staff post shared IT on the arrangement client\'s ticket (F039)', async () => {
      for (const author of [undefined, staff]) {
        const id = await write({ ticket: ticketA, author, is_internal: true, collaboration_audience: 'shared_it' });
        expect(await threadOf(id)).toMatchObject({ collaboration_audience: 'shared_it', is_internal: true });
        expect((await commentRow(id)).is_internal).toBe(true);
        expect(await audienceOf(id)).toBe('shared_it');
      }
    });

    it('MSP staff are refused shared IT on another client\'s ticket (F039)', async () => {
      const before = await t('comments').where({ ticket_id: ticketB }).count('* as n').first();
      for (const author of [undefined, staff]) {
        await expect(write({ ticket: ticketB, author, is_internal: true, collaboration_audience: 'shared_it' })).rejects.toMatchObject(INVALID);
      }
      // shared_it is internal by definition: it can never be stored as a public comment.
      await expect(write({ ticket: ticketA, is_internal: false, collaboration_audience: 'shared_it' })).rejects.toBeTruthy();
      expect(await t('comments').where({ ticket_id: ticketB }).count('* as n').first()).toEqual(before);
    });

    it('a seat technician posts requester and shared IT on their client\'s ticket (F040)', async () => {
      const pub = await write({ ticket: ticketA, user: seatUser, author: seat, is_internal: false });
      expect(await audienceOf(pub)).toBe('requester');
      const named = await write({ ticket: ticketA, user: seatUser, author: seat, is_internal: false, collaboration_audience: 'requester' });
      expect(await audienceOf(named)).toBe('requester');
      const shared = await write({ ticket: ticketA, user: seatUser, author: seat, is_internal: true, collaboration_audience: 'shared_it' });
      expect(await threadOf(shared)).toMatchObject({ collaboration_audience: 'shared_it', is_internal: true });
    });

    it('a seat technician is refused a private note and a legacy internal note (F040)', async () => {
      const before = await t('comments').where({ user_id: seatUser }).whereIn('ticket_id', [ticketA, ticketB]).count('* as n').first();
      await expect(write({ ticket: ticketA, user: seatUser, author: seat, is_internal: true, collaboration_audience: 'organization_private' })).rejects.toMatchObject(INVALID);
      await expect(write({ ticket: ticketA, user: seatUser, author: seat, is_internal: true })).rejects.toMatchObject(INVALID);
      // Another client's ticket is not theirs to write on, whatever the audience.
      await expect(write({ ticket: ticketB, user: seatUser, author: seat, is_internal: false })).rejects.toMatchObject(INVALID);
      await expect(write({ ticket: ticketB, user: seatUser, author: seat, is_internal: true, collaboration_audience: 'shared_it' })).rejects.toMatchObject(INVALID);
      // A principal with no live organization writes nothing.
      await expect(write({ ticket: ticketA, user: seatUser, author: null, is_internal: false })).rejects.toMatchObject(INVALID);
      expect(await t('comments').where({ user_id: seatUser }).whereIn('ticket_id', [ticketA, ticketB]).count('* as n').first()).toEqual(before);
    });

    it('an ended arrangement refuses the next resolved seat author despite retained resolver membership', async () => {
      const before = await t('comments').where({ ticket_id: ticketA, user_id: seatUser }).count('* as n').first();
      await t('co_managed_seat_arrangements').where({ arrangement_id: arrangementId }).update({ state: 'ended', ended_at: new Date() });
      try {
        expect(await t('authorization_resolver_subjects')
          .where({ resolver_id: CO_MANAGED_SEAT_RESOLVER_ID, user_id: seatUser }).first()).toBeDefined();
        const author = await resolveCommentAudienceReader(knex, tenant, { userId: seatUser, userType: 'internal' });
        expect(author).toBeNull();
        await expect(write({ ticket: ticketA, user: seatUser, author, is_internal: false })).rejects.toMatchObject(INVALID);
        await expect(write({ ticket: ticketA, user: seatUser, author, is_internal: true, collaboration_audience: 'shared_it' })).rejects.toMatchObject(INVALID);
        expect(await t('comments').where({ ticket_id: ticketA, user_id: seatUser }).count('* as n').first()).toEqual(before);
      } finally {
        await t('co_managed_seat_arrangements').where({ arrangement_id: arrangementId }).update({ state: 'active', ended_at: null });
      }
    });

    it('MSP writes that name no seat audience store what they always stored', async () => {
      for (const ticket of [ticketA, ticketB]) {
        const pub = await write({ ticket, is_internal: false });
        const note = await write({ ticket, is_internal: true });
        expect(await threadOf(pub)).toMatchObject({ collaboration_audience: null, is_internal: false });
        expect(await threadOf(note)).toMatchObject({ collaboration_audience: null, is_internal: true });
        expect(await audienceOf(note)).toBe('organization_private');
      }
    });
  });

  describe.each(Object.entries(WRITERS))('T025 replies through %s', (_name, write) => {
    it('a reply inherits its thread\'s audience for both organizations (F041)', async () => {
      const root = await write({ ticket: ticketA, is_internal: true, collaboration_audience: 'shared_it' });
      const thread = await threadOf(root);
      const fromSeat = await write({ ticket: ticketA, user: seatUser, author: seat, parent_comment_id: root });
      const fromMsp = await write({ ticket: ticketA, author: staff, parent_comment_id: root });
      const fromMspUnnamed = await write({ ticket: ticketA, parent_comment_id: root });
      for (const reply of [fromSeat, fromMsp, fromMspUnnamed]) {
        expect(await commentRow(reply)).toMatchObject({ thread_id: thread.thread_id, is_internal: true, parent_comment_id: root });
        expect(await audienceOf(reply)).toBe('shared_it');
      }
      // A reply cannot name another audience than its thread's.
      await expect(write({ ticket: ticketA, parent_comment_id: root, collaboration_audience: 'organization_private' })).rejects.toMatchObject(INVALID);
      await expect(write({ ticket: ticketA, user: seatUser, author: seat, parent_comment_id: root, collaboration_audience: 'requester' })).rejects.toMatchObject(INVALID);
      expect((await threadOf(root)).collaboration_audience).toBe('shared_it');
    });

    it('a seat technician replies into a public thread and never into a private or legacy internal one (F041)', async () => {
      const pub = await write({ ticket: ticketA, is_internal: false });
      const reply = await write({ ticket: ticketA, user: seatUser, author: seat, parent_comment_id: pub });
      expect(await commentRow(reply)).toMatchObject({ is_internal: false, parent_comment_id: pub });
      const legacyNote = await write({ ticket: ticketA, is_internal: true });
      await expect(write({ ticket: ticketA, user: seatUser, author: seat, parent_comment_id: legacyNote })).rejects.toMatchObject(INVALID);
      expect((await threadOf(legacyNote)).reply_count).toBe(0);
    });
  });

  describe('T025 changing a thread\'s audience (F042)', () => {
    it('a seat technician, a requester and nobody cannot change audience, in either direction', async () => {
      const shared = await viaModel({ ticket: ticketA, is_internal: true, collaboration_audience: 'shared_it' });
      const { thread_id: threadId } = await threadOf(shared);
      for (const author of [seat, { kind: 'requester', tenant } as CommentAudienceReader, null, { kind: 'staff', tenant: randomUUID() } as CommentAudienceReader]) {
        await expect(change(threadId, 'requester', author, true)).rejects.toMatchObject(INVALID);
        await expect(change(threadId, 'organization_private', author, true)).rejects.toMatchObject(INVALID);
      }
      expect(await threadOf(shared)).toMatchObject({ collaboration_audience: 'shared_it', is_internal: true });
    });

    it('an MSP widening without confirmation is refused and changes nothing', async () => {
      const note = await viaModel({ ticket: ticketA, is_internal: true });
      const reply = await viaModel({ ticket: ticketA, parent_comment_id: note });
      const { thread_id: threadId } = await threadOf(note);
      const CONFIRM = { code: 'COMMENT_AUDIENCE_CONFIRMATION_REQUIRED' };
      await expect(change(threadId, 'shared_it', staff)).rejects.toMatchObject(CONFIRM);
      await expect(change(threadId, 'shared_it', staff, false)).rejects.toMatchObject(CONFIRM);
      await expect(change(threadId, 'requester', staff)).rejects.toMatchObject(CONFIRM);
      expect(await threadOf(note)).toMatchObject({ collaboration_audience: null, is_internal: true });
      expect(await audienceOf(reply)).toBe('organization_private');

      // Confirmed: the legacy thread is labelled and every comment in it moves with it.
      await expect(change(threadId, 'shared_it', staff, true)).resolves.toEqual({ previous: 'organization_private', audience: 'shared_it', changed: true });
      expect(await threadOf(note)).toMatchObject({ collaboration_audience: 'shared_it', is_internal: true });
      expect(await audienceOf(reply)).toBe('shared_it');
      await expect(change(threadId, 'requester', staff)).rejects.toMatchObject(CONFIRM);
      await change(threadId, 'requester', staff, true);
      expect(await threadOf(note)).toMatchObject({ collaboration_audience: 'requester', is_internal: false });
      expect(await commentRow(reply)).toMatchObject({ is_internal: false });
      expect(await audienceOf(reply)).toBe('requester');

      // Narrowing discloses nothing and needs no confirmation; the same audience is a no-op.
      await expect(change(threadId, 'organization_private', staff)).resolves.toMatchObject({ previous: 'requester', changed: true });
      expect(await audienceOf(reply)).toBe('organization_private');
      await expect(change(threadId, 'organization_private', staff)).resolves.toMatchObject({ changed: false });
    });

    it('shared IT is not a destination on a ticket whose client has no live arrangement', async () => {
      const note = await viaModel({ ticket: ticketB, is_internal: true });
      const { thread_id: threadId } = await threadOf(note);
      await expect(change(threadId, 'shared_it', staff, true)).rejects.toMatchObject(INVALID);
      await expect(change(randomUUID(), 'requester', staff, true)).rejects.toMatchObject(INVALID);
      expect(await threadOf(note)).toMatchObject({ collaboration_audience: null, is_internal: true });
    });
  });
});
