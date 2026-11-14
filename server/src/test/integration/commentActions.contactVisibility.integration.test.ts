/**
 * alga-2026-0002993 F1/F2: contact-scoped portal users and ticket comments, on the REAL authorization kernel.
 *
 * Contact A and contact B share one client and one portal-visible board. Contact A's portal user sits in a
 * visibility group with ticket_scope = 'contact' (the same setting production uses to make a portal user
 * contact-scoped rather than client-wide; see getClientContactVisibilityContext). Ticket TA belongs to A, TB to B.
 *
 * Only the portal session seam (withAuth), the DB handle and the coarse RBAC grant are stood in for.
 * authorizeTicketRecordAccess, getClientContactVisibilityContext and the kernel are real.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createTenant, createUser } from '../../../test-utils/testDataFactory';

const ref = vi.hoisted(() => ({ knex: null as Knex | null, tenant: '', user: null as any }));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: ref.knex, tenant: ref.tenant })),
  getConnection: vi.fn(async () => ref.knex),
}));

// A client role's real coarse grant is ticket:read (and ticket:update for replying); the record-level decision
// under test must come from the real kernel, so nothing else is faked.
vi.mock('@alga-psa/auth', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  withAuth: (action: any) => (...args: any[]) => action(ref.user, { tenant: ref.tenant }, ...args),
  hasPermission: vi.fn(async (_user: any, resource: string, action: string) =>
    resource === 'ticket' && (action === 'read' || action === 'update')),
}));

vi.mock('@alga-psa/event-bus/publishers', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  publishEvent: vi.fn(),
  publishWorkflowEvent: vi.fn(),
  publishStoredWorkflowEvent: vi.fn(),
}));
vi.mock('@alga-psa/tickets/actions/ticketBundleUtils', () => ({
  maybeReopenBundleMasterFromChildReply: vi.fn(),
  revertBundlePropagationForChild: vi.fn(),
}));
vi.mock('../../../../packages/tickets/src/lib/liveUpdates', () => ({ publishTicketUpdate: vi.fn() }));

import {
  createComment,
  findCommentById,
  findCommentsByTicketId,
} from '../../../../packages/tickets/src/actions/comment-actions/commentActions';
import Comment from '../../../../packages/tickets/src/models/comment';

const note = (text: string) => JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text, styles: {} }] }]);

/** The observable outcome of an action: its resolved value or the thrown error message. */
async function outcome<T>(run: () => Promise<T>): Promise<{ value: T } | { threw: string }> {
  try {
    return { value: await run() };
  } catch (error) {
    return { threw: error instanceof Error ? error.message : String(error) };
  }
}

describe('commentActions contact-scoped visibility (real authorization kernel)', () => {
  let db: Knex;
  let tenant: string;
  const mark = uuidv4().slice(0, 8);
  const ids = {
    client: uuidv4(), board: uuidv4(), status: uuidv4(), priority: uuidv4(), group: uuidv4(),
    contactA: uuidv4(), contactB: uuidv4(), ticketA: uuidv4(), ticketB: uuidv4(),
    commentA: '', commentB: '', techId: '', portalUserA: '',
  };

  beforeAll(async () => {
    db = await createTestDbConnection();
    ref.knex = db;
    tenant = await createTenant(db, `Contact visibility ${mark}`);
    ref.tenant = tenant;
    ids.techId = await createUser(db, tenant, { first_name: 'Morgan', last_name: 'Tech' });

    await db('clients').insert({ tenant, client_id: ids.client, client_name: `Vis Client ${mark}`, billing_cycle: 'monthly', is_tax_exempt: false });
    await db('boards').insert({ tenant, board_id: ids.board, board_name: 'Support', is_default: true, is_inactive: false, client_portal_visible: true });
    await db('priorities').insert({ tenant, priority_id: ids.priority, priority_name: 'High', item_type: 'ticket', color: '#EF4444', order_number: 10, created_by: ids.techId });
    await db('statuses').insert({ tenant, status_id: ids.status, board_id: ids.board, name: 'Open', status_type: 'ticket', is_closed: false, is_default: true, order_number: 10, created_by: ids.techId });

    // Contact-scoped visibility: a group with ticket_scope='contact' (not a client admin), the board granted to it,
    // and contact A assigned to it. Without the group the resolver returns client scope for the whole client.
    await db('client_portal_visibility_groups').insert({ tenant, group_id: ids.group, client_id: ids.client, name: `Own tickets ${mark}`, ticket_scope: 'contact' });
    await db('client_portal_visibility_group_boards').insert({ tenant, group_id: ids.group, board_id: ids.board });
    await db('contacts').insert([
      { tenant, contact_name_id: ids.contactA, full_name: 'Contact A', email: `a-${mark}@example.com`, client_id: ids.client, portal_visibility_group_id: ids.group, is_client_admin: false },
      { tenant, contact_name_id: ids.contactB, full_name: 'Contact B', email: `b-${mark}@example.com`, client_id: ids.client },
    ]);
    ids.portalUserA = await createUser(db, tenant, { user_type: 'client', contact_id: ids.contactA, first_name: 'Contact', last_name: 'A' });

    for (const [ticketId, contactId, label] of [[ids.ticketA, ids.contactA, 'A'], [ids.ticketB, ids.contactB, 'B']] as const) {
      await db('tickets').insert({
        tenant, ticket_id: ticketId, ticket_number: `T-${mark}-${label}`, title: `Ticket ${label} ${mark}`,
        client_id: ids.client, contact_name_id: contactId, board_id: ids.board,
        status_id: ids.status, priority_id: ids.priority, entered_by: ids.techId,
      });
    }
    ids.commentA = await Comment.insert(db, tenant, { ticket_id: ids.ticketA, user_id: ids.techId, author_type: 'internal', is_internal: false, note: `public-A-${mark}`, markdown_content: `public-A-${mark}`, is_resolution: false } as any);
    ids.commentB = await Comment.insert(db, tenant, { ticket_id: ids.ticketB, user_id: ids.techId, author_type: 'internal', is_internal: false, note: `public-B-${mark}`, markdown_content: `public-B-${mark}`, is_resolution: false } as any);

    ref.user = { user_id: ids.portalUserA, user_type: 'client', tenant, contact_id: ids.contactA, email: `a-${mark}@example.com` };
  });

  afterAll(async () => {
    if (db) {
      try {
        const { rows } = await db.raw(`SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t
          ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
          WHERE c.table_schema = 'public' AND c.column_name = 'tenant'`);
        let pending: string[] = rows.map((r: any) => r.table_name);
        for (let pass = 0; pass < 12 && pending.length; pass++) {
          const blocked: string[] = [];
          for (const table of pending) {
            try { await db.raw('DELETE FROM ?? WHERE tenant = ?::uuid', [table, tenant]); } catch { blocked.push(table); }
          }
          if (blocked.length === pending.length) break;
          pending = blocked;
        }
        if (pending.length) process.stderr.write(`contact visibility cleanup left tables: ${pending.join(', ')}\n`);
      } catch (error) {
        process.stderr.write(`contact visibility cleanup skipped: ${error instanceof Error ? error.message : String(error)}\n`);
      }
      await db.destroy();
    }
  });

  it('fixture: the seeded portal user resolves to contact scope, not client scope', async () => {
    const { getClientContactVisibilityContext } = await import('../../../../packages/authorization/src/portal/visibility.server');
    const context = await db.transaction((trx) => getClientContactVisibilityContext(trx, tenant, ids.contactA));
    expect(context.effectiveTicketScope).toBe('contact');
    expect(context.visibleContactIds).toEqual([ids.contactA]);
  });

  it('F1: findCommentsByTicketId on a sibling contact\'s ticket is denied exactly like a nonexistent ticket', async () => {
    const sibling = await outcome(() => findCommentsByTicketId(ids.ticketB));
    const missing = await outcome(() => findCommentsByTicketId(uuidv4()));

    expect(sibling).toEqual(missing);
    expect(JSON.stringify(sibling)).not.toContain(`public-B-${mark}`);
    expect(JSON.stringify(sibling)).not.toContain(ids.commentB);
    expect('value' in sibling && Array.isArray(sibling.value)).toBe(false);
  });

  it('F1: findCommentById for a comment on a sibling contact\'s ticket is denied exactly like a nonexistent comment', async () => {
    const sibling = await outcome(() => findCommentById(ids.commentB));
    const missing = await outcome(() => findCommentById(uuidv4()));

    expect(sibling).toEqual(missing);
    expect(JSON.stringify(sibling)).not.toContain(`public-B-${mark}`);
    expect('value' in sibling && sibling.value && (sibling.value as any).comment_id).toBeFalsy();
  });

  it('control: the contact still reads comments on their own ticket', async () => {
    const list = await findCommentsByTicketId(ids.ticketA);
    expect(Array.isArray(list)).toBe(true);
    expect((list as any[]).map((c) => c.comment_id)).toEqual([ids.commentA]);

    const single = await findCommentById(ids.commentA);
    expect((single as any)?.comment_id).toBe(ids.commentA);
  });

  it('F2: createComment on a sibling contact\'s ticket is rejected and inserts nothing', async () => {
    const before = await db('comments').where({ tenant, ticket_id: ids.ticketB }).count<{ count: string }[]>('* as count');
    const attempt = await outcome(() => createComment({
      ticket_id: ids.ticketB, user_id: ids.portalUserA, note: note(`intrusion-${mark}`), is_internal: false, is_resolution: false,
    } as any));
    const after = await db('comments').where({ tenant, ticket_id: ids.ticketB }).count<{ count: string }[]>('* as count');

    expect(after[0].count).toBe(before[0].count);
    const returned = 'value' in attempt ? attempt.value : undefined;
    expect(typeof returned === 'string' && returned.length > 0 && !(returned as any).error).toBe(false);
    expect(await db('comments').where({ tenant, ticket_id: ids.ticketB }).whereRaw('note::text ILIKE ?', [`%intrusion-${mark}%`])).toHaveLength(0);
  });
});
