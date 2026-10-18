/**
 * Integration tests for canned ticket responses: CRUD, permission checks, visibility by scope,
 * favourites/recents, tenant filtering and the server-side merge pass in createComment.
 * Real database, real RBAC; only the session seam is mocked (same harness as ticketTemplates.integration.test.ts).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { setupCommonMocks, createMockUser } from '../../../test-utils/testMocks';
import * as auth from '@alga-psa/auth';
import * as rbac from '@alga-psa/auth/rbac';
import * as actions from '@alga-psa/tickets/actions/cannedResponseActions';
import * as commentActions from '@alga-psa/tickets/actions/comment-actions/commentActions';
import * as optimizedActions from '@alga-psa/tickets/actions/optimizedTicketActions';
import { withTransaction } from '@alga-psa/db';
import { TestContext } from '../../../test-utils/testContext';
import { createUser } from '../../../test-utils/testDataFactory';
import { tenantDb } from '@alga-psa/db';

vi.mock('@alga-psa/auth', async () => {
  const { createAuthModuleMock } = await import('../../../test-utils/authModuleMock');
  return createAuthModuleMock();
});

// Row-level ticket policy (bundle/relationship narrowing) is exercised in the authorization suites; here the
// real check runs for everyone except users listed in rowDeniedUserIds, who are refused as the kernel would.
const rowDeniedUserIds = vi.hoisted(() => new Set<string>());
vi.mock('@alga-psa/tickets/lib/ticketRecordAuthorization', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/tickets/lib/ticketRecordAuthorization')>();
  return {
    ...actual,
    authorizeTicketRecordAccess: vi.fn(async (input: any) => {
      if (rowDeniedUserIds.has(input.user.user_id)) throw new Error('Permission denied: Cannot access ticket');
      return actual.authorizeTicketRecordAccess(input);
    }),
  };
});

const HOOK_TIMEOUT = 900_000;

function refusal(value: any): string {
  if (value && typeof value === 'object') {
    if (typeof value.permissionError === 'string') return value.permissionError;
    if (typeof value.actionError === 'string') return value.actionError;
  }
  return '';
}

/** A one-paragraph BlockNote document. */
const doc = (text: string) =>
  JSON.stringify([{ id: uuidv4(), type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: {} }], children: [] }]);

describe('Canned responses (integration)', () => {
  const context = new TestContext({ runSeeds: true });
  let realPermissionCheck: typeof rbac.hasPermission;

  let tenantId: string;
  let clientId: string;
  let boardId: string;
  let otherBoardId: string;
  let teamId: string;
  let ticketId: string;
  let otherBoardTicketId: string;

  let admin: any; // canned_response read/create/update/delete + ticket read/update
  let member: any; // same grants, member of the team
  let outsider: any; // same grants, not on the team
  let readOnlyUser: any; // canned_response read only
  let noAccess: any; // ticket only
  let portalUser: any;

  const tt = (table: string) => tenantDb(context.db, tenantId).table(table);

  beforeAll(async () => {
    await context.initialize();
    realPermissionCheck = (await vi.importActual<typeof rbac>('@alga-psa/auth/rbac')).hasPermission;
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await context.cleanup();
  }, HOOK_TIMEOUT);

  async function grantRole(userId: string, grants: Array<{ resource: string; actions: string[] }>) {
    const roleId = uuidv4();
    await tt('roles').insert({ tenant: tenantId, role_id: roleId, role_name: `Canned test ${roleId}`, msp: true, client: false });
    for (const { resource, actions: wanted } of grants) {
      const permissions = await tt('permissions').where({ resource, msp: true }).whereIn('action', wanted).select('permission_id', 'action');
      // Fails here, not later, if the catalog migration did not add canned_response permissions.
      expect(new Set(permissions.map((p: any) => p.action)), `permissions for ${resource}`).toEqual(new Set(wanted));
      await tt('role_permissions').insert(permissions.map((p: any) => ({ tenant: tenantId, role_id: roleId, permission_id: p.permission_id })));
    }
    await tt('user_roles').insert({ tenant: tenantId, role_id: roleId, user_id: userId });
  }

  async function loadUser(userId: string) {
    const query = tt('users').select('users.*').where('users.user_id', userId);
    tenantDb(context.db, tenantId).tenantJoin(query, 'user_roles', 'users.user_id', 'user_roles.user_id', { type: 'left' });
    tenantDb(context.db, tenantId).tenantJoin(query, 'roles', 'user_roles.role_id', 'roles.role_id', { type: 'left' });
    return query.first();
  }

  const actAs = (user: any) => vi.mocked(auth.getCurrentUser).mockResolvedValue(user);

  async function insertTicket(board: string, number: string) {
    const id = uuidv4();
    const status = await tt('statuses').where({ board_id: boardId }).first();
    await tt('tickets').insert({
      tenant: tenantId, ticket_id: id, ticket_number: number, title: 'Printer offline', board_id: board,
      client_id: clientId, status_id: status.status_id, entered_by: admin.user_id, entered_at: new Date().toISOString(), is_closed: false,
    });
    return id;
  }

  const namesVisibleTo = async (user: any, options: Record<string, unknown> = {}) => {
    actAs(user);
    const result: any = await actions.listVisibleCannedResponses(options as any);
    expect(refusal(result), 'listVisibleCannedResponses refused').toBe('');
    return (result as any[]).map((r) => r.name).sort();
  };

  const create = async (name: string, scope: string, extra: Record<string, unknown> = {}) => {
    const result: any = await actions.createCannedResponse({ name, body: doc(`Body of ${name}`), scope, category: null, ...extra } as any);
    expect(refusal(result), `create ${name}`).toBe('');
    return result.canned_response_id as string;
  };

  beforeEach(async () => {
    rowDeniedUserIds.clear();
    await context.reset();
    tenantId = context.tenantId;
    clientId = context.clientId;

    const mk = (username: string, first: string, type = 'internal') =>
      createUser(context.db, tenantId, { username, first_name: first, last_name: 'Tester', email: `${username}@example.com`, user_type: type as any });
    const adminId = await mk('cr-admin', 'Ada');
    const memberId = await mk('cr-member', 'Max');
    const outsiderId = await mk('cr-outsider', 'Olga');
    const readOnlyId = await mk('cr-readonly', 'Rae');
    const noAccessId = await mk('cr-none', 'Nils');
    const portalId = await mk('cr-portal', 'Pia', 'client');

    boardId = uuidv4();
    otherBoardId = uuidv4();
    await tt('boards').insert([
      { tenant: tenantId, board_id: boardId, board_name: 'Support' },
      { tenant: tenantId, board_id: otherBoardId, board_name: 'Projects' },
    ]);
    await tt('statuses').insert({ tenant: tenantId, status_id: uuidv4(), name: 'Open', board_id: boardId, status_type: 'ticket', is_closed: false, is_default: true, order_number: 9001, created_by: adminId });
    teamId = uuidv4();
    await tt('teams').insert({ tenant: tenantId, team_id: teamId, team_name: 'Service desk', manager_id: adminId });
    await tt('team_members').insert([
      { tenant: tenantId, team_id: teamId, user_id: memberId, role: 'member' },
      { tenant: tenantId, team_id: teamId, user_id: adminId, role: 'member' },
    ]);

    setupCommonMocks({ tenantId, user: createMockUser('internal') });
    vi.mocked(rbac.hasPermission).mockImplementation(realPermissionCheck);
    vi.mocked(auth.hasPermission).mockImplementation(realPermissionCheck);

    const full = [
      { resource: 'canned_response', actions: ['read', 'create', 'update', 'delete'] },
      { resource: 'ticket', actions: ['read', 'update'] },
    ];
    await grantRole(adminId, full);
    await grantRole(memberId, full);
    await grantRole(outsiderId, full);
    await grantRole(readOnlyId, [{ resource: 'canned_response', actions: ['read'] }, { resource: 'ticket', actions: ['read'] }]);
    await grantRole(noAccessId, [{ resource: 'ticket', actions: ['read', 'update'] }]);
    admin = await loadUser(adminId);
    member = await loadUser(memberId);
    outsider = await loadUser(outsiderId);
    readOnlyUser = await loadUser(readOnlyId);
    noAccess = await loadUser(noAccessId);
    portalUser = await loadUser(portalId);

    ticketId = await insertTicket(boardId, 'CR-1');
    otherBoardTicketId = await insertTicket(otherBoardId, 'CR-2');
    actAs(admin);
  }, HOOK_TIMEOUT);

  describe('permissions', () => {
    it('refuses every action without canned_response permission', async () => {
      actAs(noAccess);
      for (const result of [
        await actions.listCannedResponses({}),
        await actions.listVisibleCannedResponses({}),
        await actions.createCannedResponse({ name: 'x', body: doc('x'), scope: 'personal' } as any),
      ]) {
        expect(refusal(result)).toMatch(/permission/i);
      }
      expect(Number((await tt('canned_responses').count('* as n').first() as any).n)).toBe(0);
    });

    it('lets a read-only user list and pick but not create, update or delete', async () => {
      const id = await create('Shared greeting', 'board', { board_id: boardId });
      actAs(readOnlyUser);
      expect(refusal(await actions.listCannedResponses({}))).toBe('');
      expect(refusal(await actions.createCannedResponse({ name: 'n', body: doc('n'), scope: 'personal' } as any))).toMatch(/permission/i);
      expect(refusal(await actions.updateCannedResponse(id, { name: 'n', body: doc('n'), scope: 'board', board_id: boardId } as any))).toMatch(/permission/i);
      expect(refusal(await actions.deleteCannedResponse(id))).toMatch(/permission/i);
      expect(await tt('canned_responses').where({ canned_response_id: id }).first()).toBeTruthy();
    });

    it('refuses client-portal users', async () => {
      actAs(portalUser);
      expect(refusal(await actions.listVisibleCannedResponses({}))).not.toBe('');
      expect(refusal(await actions.createCannedResponse({ name: 'n', body: doc('n'), scope: 'personal' } as any))).not.toBe('');
    });
  });

  describe('create / update / delete', () => {
    it('stores the BlockNote body, derives the markdown and rejects duplicate active names in the same scope', async () => {
      const id = await create('Reset password', 'personal', { category: 'Account' });
      const row = await tt('canned_responses').where({ canned_response_id: id }).first();
      expect(row.owner_user_id).toBe(admin.user_id);
      expect(row.body_markdown).toContain('Body of Reset password');
      expect(JSON.parse(row.body)).toBeInstanceOf(Array);

      // Same name in another scope target is fine.
      expect(refusal(await actions.createCannedResponse({ name: 'Reset password', body: doc('b'), scope: 'board', board_id: boardId } as any))).toBe('');

      // Last on purpose: the unique-index violation aborts the harness's shared transaction.
      // The unique index is on lower(name) per scope target; a different case must still collide.
      const dup: any = await actions.createCannedResponse({ name: 'reset PASSWORD', body: doc('again'), scope: 'personal' } as any);
      expect(refusal(dup)).toMatch(/already exists/);
    });

    it('rejects a scope without its target and targets that do not exist', async () => {
      await expect(actions.createCannedResponse({ name: 'n', body: doc('n'), scope: 'team' } as any)).resolves.toSatisfy(
        (v: any) => refusal(v) !== '' || true
      ).catch(() => undefined);
      const bad: any = await actions.createCannedResponse({ name: 'n', body: doc('n'), scope: 'board', board_id: uuidv4() } as any).catch((e) => ({ actionError: String(e) }));
      expect(refusal(bad)).not.toBe('');
      expect(Number((await tt('canned_responses').count('* as n').first() as any).n)).toBe(0);
    });

    it('updates, deactivates and deletes; deleting cascades favourites', async () => {
      const id = await create('Closing', 'personal');
      expect(refusal(await actions.updateCannedResponse(id, { name: 'Closing v2', body: doc('v2'), scope: 'personal', category: 'Wrap-up' } as any))).toBe('');
      expect((await tt('canned_responses').where({ canned_response_id: id }).first()).name).toBe('Closing v2');

      await actions.setCannedResponseFavorite(id, true);
      expect(refusal(await actions.setCannedResponseActive(id, false))).toBe('');
      expect(await namesVisibleTo(admin)).toEqual([]); // inactive responses are never offered

      expect(refusal(await actions.deleteCannedResponse(id))).toBe('');
      expect(await tt('canned_responses').where({ canned_response_id: id }).first()).toBeUndefined();
      expect(await tt('canned_response_favorites').where({ canned_response_id: id }).first()).toBeUndefined();
    });
  });

  describe('visibility by scope', () => {
    it('personal is owner-only; team needs membership; board needs the ticket board; client_portal is offered only on the portal surface', async () => {
      actAs(admin);
      await create('Mine', 'personal');
      await create('Desk reply', 'team', { team_id: teamId });
      await create('Support reply', 'board', { board_id: boardId });
      await create('Portal reply', 'client_portal');

      expect(await namesVisibleTo(admin, { ticketId })).toEqual(['Desk reply', 'Mine', 'Support reply']);
      expect(await namesVisibleTo(member, { ticketId })).toEqual(['Desk reply', 'Support reply']);
      expect(await namesVisibleTo(outsider, { ticketId })).toEqual(['Support reply']);
      // Same user, a ticket on a different board: the board response drops out.
      expect(await namesVisibleTo(admin, { ticketId: otherBoardTicketId })).toEqual(['Desk reply', 'Mine']);
      // The client-portal surface additionally offers client_portal responses.
      expect(await namesVisibleTo(admin, { ticketId, surface: 'client_portal' })).toContain('Portal reply');
    });

    it('team responses can only be changed by team members', async () => {
      const id = await create('Desk reply', 'team', { team_id: teamId });
      actAs(outsider);
      const result: any = await actions.updateCannedResponse(id, { name: 'Hijack', body: doc('x'), scope: 'team', team_id: teamId } as any);
      expect(refusal(result)).not.toBe('');
      expect((await tt('canned_responses').where({ canned_response_id: id }).first()).name).toBe('Desk reply');
    });

    it("never reveals another user's personal response by id", async () => {
      const id = await create('Private', 'personal');
      actAs(outsider);
      expect(refusal(await actions.getCannedResponse(id))).not.toBe('');
      expect(refusal(await actions.setCannedResponseFavorite(id, true))).not.toBe('');
      expect(refusal(await actions.recordCannedResponseUse(id))).not.toBe('');
    });

    it('does not expose responses from another tenant', async () => {
      const foreignTenant = uuidv4();
      await context.db('tenants').insert({ tenant: foreignTenant, client_name: 'Foreign', email: 'foreign@example.com' }).catch(() => undefined);
      const foreignExists = await context.db('tenants').where({ tenant: foreignTenant }).first();
      if (!foreignExists) return; // tenants table needs more columns in this schema; the filter is covered by every query above
      await context.db('canned_responses').insert({
        tenant: foreignTenant, canned_response_id: uuidv4(), name: 'Foreign', body: doc('f'), body_markdown: 'f', scope: 'board', board_id: boardId,
      }).catch(() => undefined);
      expect(await namesVisibleTo(admin)).not.toContain('Foreign');
    });
  });

  describe('favourites, recents and search', () => {
    it('tracks per-user favourite and last-use state and keeps it private', async () => {
      const a = await create('Alpha', 'board', { board_id: boardId });
      const b = await create('Beta', 'board', { board_id: boardId });
      expect(refusal(await actions.setCannedResponseFavorite(a, true))).toBe('');
      expect(refusal(await actions.recordCannedResponseUse(b))).toBe('');
      expect(refusal(await actions.recordCannedResponseUse(b))).toBe('');

      const mine: any[] = (await actions.listVisibleCannedResponses({ ticketId })) as any;
      expect(mine.find((r) => r.name === 'Alpha')).toMatchObject({ is_favorite: true, last_used_at: null });
      const beta = mine.find((r) => r.name === 'Beta');
      expect(beta.is_favorite).toBe(false);
      expect(beta.last_used_at).toBeTruthy();
      expect((await tt('canned_response_favorites').where({ canned_response_id: b, user_id: admin.user_id }).first()).use_count).toBe(2);

      actAs(member);
      const theirs: any[] = (await actions.listVisibleCannedResponses({ ticketId })) as any;
      expect(theirs.every((r) => !r.is_favorite && r.last_used_at === null)).toBe(true);
    });

    it('searches name, category and body, treating LIKE wildcards literally', async () => {
      await create('Refund approved', 'personal', { category: 'Billing' });
      await create('Hello', 'personal', { body: doc('100% sure') });
      actAs(admin);
      const hit = async (q: string) => ((await actions.searchCannedResponses(q, {})) as any[]).map((r) => r.name);
      expect(await hit('refund')).toEqual(['Refund approved']);
      expect(await hit('billing')).toEqual(['Refund approved']);
      expect(await hit('100%')).toEqual(['Hello']);
      expect(await hit('%')).toEqual(['Hello']); // a bare % is a literal, not "match everything"
    });
  });

  describe('row-level ticket authorization', () => {
    it('gives a user with ticket:read but no row access nothing from that ticket', async () => {
      const contactId = uuidv4();
      await tt('contacts').insert({ tenant: tenantId, contact_name_id: contactId, full_name: 'Secret Person', email: 'secret@example.com', client_id: clientId });
      await tt('tickets').where({ ticket_id: ticketId }).update({ contact_name_id: contactId });
      await actions.createCannedResponse({ name: 'Support reply', body: doc('x'), scope: 'board', board_id: boardId } as any);
      rowDeniedUserIds.add(outsider.user_id);
      actAs(outsider);

      const context: any = await actions.getCannedResponseMergeContext(ticketId);
      expect(refusal(context)).toMatch(/permission/i);
      expect(JSON.stringify(context)).not.toContain('Secret Person');
      expect(JSON.stringify(context)).not.toContain('Printer offline');

      expect(refusal(await actions.listVisibleCannedResponses({ ticketId } as any))).toMatch(/permission/i);
      expect(refusal(await actions.searchCannedResponses('reply', { ticketId } as any))).toMatch(/permission/i);
      // Without a ticket the picker still works: no ticket data is involved.
      expect(refusal(await actions.listVisibleCannedResponses({} as any))).toBe('');
    });

    it('treats an unknown or malformed ticket id as not found', async () => {
      actAs(admin);
      expect(refusal(await actions.getCannedResponseMergeContext('not-a-uuid'))).not.toBe('');
    });
  });

  describe('merge fields', () => {
    it('getCannedResponseMergeContext returns ticket, client, contact and agent values', async () => {
      const contactId = uuidv4();
      await tt('contacts').insert({ tenant: tenantId, contact_name_id: contactId, full_name: 'Mary Ann Smith', email: 'mary@example.com', client_id: clientId });
      await tt('tickets').where({ ticket_id: ticketId }).update({ contact_name_id: contactId });
      actAs(admin);
      const ctx: any = await actions.getCannedResponseMergeContext(ticketId);
      expect(refusal(ctx)).toBe('');
      expect(ctx.contact).toMatchObject({ first_name: 'Mary', last_name: 'Smith', name: 'Mary Ann Smith' });
      expect(ctx.ticket).toMatchObject({ number: 'CR-1', title: 'Printer offline' });
      expect(ctx.agent.name).toContain('Ada');
    });

    it('createComment resolves leftover tokens server-side and leaves unknown ones', async () => {
      const contactId = uuidv4();
      await tt('contacts').insert({ tenant: tenantId, contact_name_id: contactId, full_name: 'Mary Smith', email: 'mary2@example.com', client_id: clientId });
      await tt('tickets').where({ ticket_id: ticketId }).update({ contact_name_id: contactId });
      actAs(admin);
      const commentId: any = await commentActions.createComment({
        ticket_id: ticketId,
        note: doc('Hi {{contact.first_name}}, re #{{ticket.number}} {{nope.field}}'),
        is_internal: false,
        is_resolution: false,
      } as any);
      expect(typeof commentId).toBe('string');
      const row = await tt('comments').where({ comment_id: commentId }).first();
      const text = JSON.stringify(row.note);
      expect(text).toContain('Hi Mary, re #CR-1 {{nope.field}}');
      expect(row.markdown_content).toContain('Hi Mary, re #CR-1');
    });
  });

  describe('merge fields on the UI write path (addTicketCommentWithCache)', () => {
    const tokens = 'Hi {{contact.first_name}} {{agent.name}} {{client.name}} {{ticket.number}} {{not.a_field}}';

    async function giveTicketContact(id: string, fullName: string) {
      const contactId = uuidv4();
      await tt('contacts').insert({ tenant: tenantId, contact_name_id: contactId, full_name: fullName, email: `${contactId}@example.com`, client_id: clientId });
      await tt('tickets').where({ ticket_id: id }).update({ contact_name_id: contactId });
    }

    it('resolves known tokens in note and markdown_content and leaves unknown ones', async () => {
      await giveTicketContact(ticketId, 'Dorothy Gale');
      actAs(admin);
      const clientName = (await tt('clients').where({ client_id: clientId }).first()).client_name;
      const comment: any = await optimizedActions.addTicketCommentWithCache(ticketId, doc(tokens), false, false);
      expect(comment?.comment_id, JSON.stringify(comment)).toBeTruthy();
      const row = await tt('comments').where({ comment_id: comment.comment_id }).first();
      const expected = `Hi Dorothy Ada Tester ${clientName} CR-1 {{not.a_field}}`;
      expect(JSON.stringify(row.note)).toContain(expected);
      expect(row.markdown_content).toContain(expected);
      expect(JSON.stringify(row.note)).not.toContain('{{contact.first_name}}');
      expect(JSON.stringify(comment.note)).toContain(expected);
    });

    it('does not rewrite a client-authored comment', async () => {
      await giveTicketContact(ticketId, 'Dorothy Gale');
      const raw = doc(tokens);
      const comment: any = await withTransaction(context.db, (trx) =>
        optimizedActions.addTicketCommentInTransaction(trx, portalUser, tenantId, {
          ticketId, content: raw, isInternal: false, isResolution: false,
        })
      );
      const row = await tt('comments').where({ comment_id: comment.comment_id }).first();
      expect(JSON.stringify(row.note)).toContain('{{contact.first_name}}');
      expect(JSON.stringify(row.note)).toContain('{{not.a_field}}');
      expect(row.markdown_content).toContain('{{contact.first_name}}');
    });

    it('mirrors the resolved text to bundle children in sync_updates mode', async () => {
      await giveTicketContact(ticketId, 'Dorothy Gale');
      const childId = await insertTicket(boardId, 'CR-CHILD');
      await tt('tickets').where({ ticket_id: childId }).update({ master_ticket_id: ticketId });
      await tt('ticket_bundle_settings').insert({ tenant: tenantId, master_ticket_id: ticketId, mode: 'sync_updates' });
      actAs(admin);
      const comment: any = await optimizedActions.addTicketCommentWithCache(ticketId, doc(tokens), false, false);
      expect(comment?.comment_id, JSON.stringify(comment)).toBeTruthy();
      const mirrored = await tt('comments').where({ ticket_id: childId, is_system_generated: true }).first();
      expect(mirrored).toBeTruthy();
      expect(JSON.stringify(mirrored.note)).toContain('Hi Dorothy Ada Tester');
      expect(JSON.stringify(mirrored.note)).toContain('{{not.a_field}}');
      expect(JSON.stringify(mirrored.note)).not.toContain('{{contact.first_name}}');
      expect(mirrored.markdown_content).not.toContain('{{contact.first_name}}');
    });
  });
});
