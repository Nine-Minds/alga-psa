/**
 * Integration tests for "Batch duplicate" (plan docs/plans/2026-10-13-batch-duplicate-plan.md).
 * Real database, real RBAC, real authorization kernel; only the session seam is mocked
 * (same harness as ticketDuplicate.integration.test.ts).
 *
 * Covers: one copy per contact with provenance and a shared batch_id, per-copy failure
 * isolation (other-client contact, unresolved token, a copy rolled back after its ticket
 * row was written), permission/authorization refusals (nothing written), request
 * validation, a source deleted mid-batch, and the checklist opt-out.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { setupCommonMocks, createMockUser } from '../../../test-utils/testMocks';
import * as auth from '@alga-psa/auth';
import * as rbac from '@alga-psa/auth/rbac';
import * as ticketActions from '@alga-psa/tickets/actions/ticketActions';
import {
  createAuthorizationBundle,
  createBundleAssignment,
  publishBundleRevision,
  upsertBundleRule,
} from '@alga-psa/authorization/bundles/service';
import { TestContext } from '../../../test-utils/testContext';
import { createUser, createClient } from '../../../test-utils/testDataFactory';
import * as pkgDb from '@alga-psa/db';
import { tenantDb } from '@alga-psa/db';
import { TICKET_ACTIVITY_EVENT } from '../../../../shared/lib/ticketActivity';

vi.mock('@alga-psa/auth', async () => {
  const { createAuthModuleMock } = await import('../../../test-utils/authModuleMock');
  // ticketBulkFailureMessage localizes expected errors; the shared mock has no such export.
  return { ...createAuthModuleMock(), localizeActionError: async (error: unknown) => error };
});

// Lets a test run code right after the Nth copy's provenance write (inside that copy's
// transaction), i.e. between copy N and copy N+1 of the same batch.
const duplicateHook: { afterCall: number | null; calls: number; run: (() => Promise<void>) | null } = {
  afterCall: null,
  calls: 0,
  run: null,
};
vi.mock('@alga-psa/tickets/lib/ticketDuplicate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/tickets/lib/ticketDuplicate')>();
  return {
    ...actual,
    recordDuplicateCopy: async (...args: Parameters<typeof actual.recordDuplicateCopy>) => {
      const result = await actual.recordDuplicateCopy(...args);
      duplicateHook.calls += 1;
      if (duplicateHook.afterCall === duplicateHook.calls && duplicateHook.run) {
        await duplicateHook.run();
      }
      return result;
    },
  };
});

const HOOK_TIMEOUT = 900_000;

type Outcome = { threw: Error | null; value: any };

async function attempt(fn: () => Promise<unknown>): Promise<Outcome> {
  try {
    return { threw: null, value: await fn() };
  } catch (error) {
    return { threw: error as Error, value: undefined };
  }
}

function refusalMessage(outcome: Outcome): string {
  if (outcome.threw) return outcome.threw.message;
  const v = outcome.value;
  if (v && typeof v === 'object') {
    if (typeof v.permissionError === 'string') return v.permissionError;
    if (typeof v.actionError === 'string') return v.actionError;
  }
  return '';
}

const parse = (value: unknown) => (typeof value === 'string' ? JSON.parse(value) : value) as any;

describe('Batch duplicate ticket (integration)', () => {
  const context = new TestContext({ runSeeds: true });
  let realPermissionCheck: typeof rbac.hasPermission;

  let tenantId: string;
  let clientId: string;
  let otherClientId: string;
  let boardId: string;
  let statusId: string;
  let priorityId: string;
  let ownerUser: string;
  let creator: any;
  let noCreateUser: any;
  let narrowedUser: any;
  let clientPortalUser: any;
  let sourceTicketId: string;
  let contactIds: string[];
  let otherClientContactId: string;
  let teamId: string;
  let agentIds: string[];

  const tt = (table: string) => tenantDb(context.db, tenantId).table(table);

  beforeAll(async () => {
    await context.initialize();
    realPermissionCheck = (await vi.importActual<typeof rbac>('@alga-psa/auth/rbac')).hasPermission;
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await context.cleanup();
  }, HOOK_TIMEOUT);

  async function grantTicketRole(userId: string, actions: string[]) {
    const roleId = uuidv4();
    await tt('roles').insert({ tenant: tenantId, role_id: roleId, role_name: `Batch dup ${roleId}`, msp: true, client: false });
    const permissions = await tt('permissions')
      .where({ resource: 'ticket', msp: true })
      .whereIn('action', actions)
      .select('permission_id', 'action');
    expect(new Set(permissions.map((p: any) => p.action))).toEqual(new Set(actions));
    await tt('role_permissions').insert(
      permissions.map((p: any) => ({ tenant: tenantId, role_id: roleId, permission_id: p.permission_id }))
    );
    await tt('user_roles').insert({ tenant: tenantId, role_id: roleId, user_id: userId });
  }

  async function loadUser(userId: string) {
    const query = tt('users').select('users.*').where('users.user_id', userId);
    tenantDb(context.db, tenantId).tenantJoin(query, 'user_roles', 'users.user_id', 'user_roles.user_id', { type: 'left' });
    tenantDb(context.db, tenantId).tenantJoin(query, 'roles', 'user_roles.role_id', 'roles.role_id', { type: 'left' });
    return query.first();
  }

  const actAs = (user: any) => vi.mocked(auth.getCurrentUser).mockResolvedValue(user);

  async function countTickets(): Promise<number> {
    const row = await tt('tickets').count('* as n').first();
    return Number((row as any).n);
  }

  async function countAudit(): Promise<number> {
    const row = await tt('ticket_audit_logs').count('* as n').first();
    return Number((row as any).n);
  }

  const copiesFor = (ids: string[], prefix = 'Onboard') =>
    ids.map((contactId, i) => ({ key: `k${i}`, contactId, title: `${prefix} ${i}` }));

  beforeEach(async () => {
    await context.reset();
    tenantId = context.tenantId;
    clientId = context.clientId;

    const creatorId = await createUser(context.db, tenantId, {
      username: 'bd-creator', first_name: 'Dana', last_name: 'Creator', email: 'dana@example.com', user_type: 'internal',
    });
    const noCreateId = await createUser(context.db, tenantId, {
      username: 'bd-reader', first_name: 'Rory', last_name: 'Reader', email: 'rory@example.com', user_type: 'internal',
    });
    const narrowedId = await createUser(context.db, tenantId, {
      username: 'bd-narrowed', first_name: 'Nora', last_name: 'Narrowed', email: 'nora@example.com', user_type: 'internal',
    });
    const portalId = await createUser(context.db, tenantId, {
      username: 'bd-portal', first_name: 'Pia', last_name: 'Portal', email: 'pia@example.com', user_type: 'client',
    });
    ownerUser = await createUser(context.db, tenantId, {
      username: 'bd-owner', first_name: 'Owen', last_name: 'Owner', email: 'owen@example.com', user_type: 'internal',
    });

    boardId = uuidv4();
    await tt('boards').insert({ tenant: tenantId, board_id: boardId, board_name: 'Batch Board' });
    statusId = uuidv4();
    await tt('statuses').insert({
      tenant: tenantId, status_id: statusId, name: 'Batch Open', board_id: boardId, status_type: 'ticket',
      is_closed: false, is_default: true, order_number: 9001, created_by: creatorId,
    });
    priorityId = (await tt('priorities').where({ item_type: 'ticket' }).first()).priority_id;

    contactIds = [];
    for (let i = 0; i < 12; i += 1) {
      const id = uuidv4();
      contactIds.push(id);
      await tt('contacts').insert({
        tenant: tenantId, contact_name_id: id, full_name: `Batch Contact ${i}`, email: `c${i}@example.com`, client_id: clientId,
      });
    }
    otherClientId = await createClient(context.db, tenantId, 'Other Client');
    otherClientContactId = uuidv4();
    await tt('contacts').insert({
      tenant: tenantId, contact_name_id: otherClientContactId, full_name: 'Elsewhere Contact', email: 'else@example.com', client_id: otherClientId,
    });

    setupCommonMocks({ tenantId, user: createMockUser('internal') });
    vi.mocked(rbac.hasPermission).mockImplementation(realPermissionCheck);
    vi.mocked(auth.hasPermission).mockImplementation(realPermissionCheck);

    await grantTicketRole(creatorId, ['read', 'update', 'create']);
    await grantTicketRole(noCreateId, ['read']);
    await grantTicketRole(narrowedId, ['read', 'create']);
    creator = await loadUser(creatorId);
    noCreateUser = await loadUser(noCreateId);
    narrowedUser = await loadUser(narrowedId);
    clientPortalUser = await loadUser(portalId);

    teamId = uuidv4();
    await tt('teams').insert({ tenant: tenantId, team_id: teamId, team_name: 'Batch Team', manager_id: ownerUser });
    agentIds = [
      await createUser(context.db, tenantId, { username: 'bd-agent-a', first_name: 'Ada', last_name: 'Agent', email: 'ada@example.com', user_type: 'internal' }),
      await createUser(context.db, tenantId, { username: 'bd-agent-b', first_name: 'Bo', last_name: 'Agent', email: 'bo@example.com', user_type: 'internal' }),
    ];

    sourceTicketId = uuidv4();
    await tt('tickets').insert({
      tenant: tenantId, ticket_id: sourceTicketId, ticket_number: 'BD-SOURCE', title: 'Onboard template',
      board_id: boardId, client_id: clientId, contact_name_id: contactIds[0], status_id: statusId, priority_id: priorityId,
      assigned_to: ownerUser, assigned_team_id: teamId, entered_by: ownerUser, entered_at: new Date().toISOString(), is_closed: false,
      attributes: JSON.stringify({
        description: 'Original description',
        custom_fields: { shirt_size: 'L' },
        watch_list: [{ email: 'watcher@example.com' }],
        sla_last_response_threshold_notified: 80,
        source_reference: { message_id: 'm-1' },
      }),
    });
    await tt('ticket_resources').insert(
      agentIds.map((agentId) => ({
        tenant: tenantId, assignment_id: uuidv4(), ticket_id: sourceTicketId, assigned_to: ownerUser, additional_user_id: agentId, role: 'support',
      }))
    );
    const tagIds = [uuidv4(), uuidv4()];
    await tt('tag_definitions').insert([
      { tenant: tenantId, tag_id: tagIds[0], tag_text: 'onboarding', tagged_type: 'ticket', background_color: '#112233', text_color: '#ffffff' },
      { tenant: tenantId, tag_id: tagIds[1], tag_text: 'hardware', tagged_type: 'ticket', background_color: '#445566', text_color: '#000000' },
    ]);
    await tt('tag_mappings').insert(
      tagIds.map((tagId) => ({ tenant: tenantId, mapping_id: uuidv4(), tag_id: tagId, tagged_id: sourceTicketId, tagged_type: 'ticket' }))
    );
    // Three checklist items; the first is completed on the source and must be copied unchecked.
    await tt('ticket_checklist_items').insert([
      {
        tenant: tenantId, ticket_id: sourceTicketId, item_name: 'Order laptop', order_number: 0, is_required: true,
        completed: true, completed_by: ownerUser, completed_at: new Date().toISOString(), source: 'manual', created_by: ownerUser,
      },
      { tenant: tenantId, ticket_id: sourceTicketId, item_name: 'Create accounts', order_number: 1, is_required: false, source: 'manual', created_by: ownerUser },
      { tenant: tenantId, ticket_id: sourceTicketId, item_name: 'Print badge', order_number: 2, is_required: true, source: 'manual', created_by: ownerUser },
    ]);

    actAs(creator);
  }, HOOK_TIMEOUT);

  describe('happy path', () => {
    it('creates one copy per contact with provenance and a shared batch_id', async () => {
      const before = await countTickets();
      const result: any = await ticketActions.duplicateTicketBatch(sourceTicketId, copiesFor(contactIds), { copyChecklist: true });

      expect(result.failed).toEqual([]);
      expect(result.created).toHaveLength(12);
      expect(await countTickets()).toBe(before + 12);
      expect(new Set(result.created.map((c: any) => c.ticketNumber)).size).toBe(12);

      for (const [i, entry] of result.created.entries()) {
        expect(entry.key).toBe(`k${i}`);
        const copy = await tt('tickets').where({ ticket_id: entry.ticketId }).first();
        expect(copy.title).toBe(`Onboard ${i}`);
        expect(copy.contact_name_id).toBe(contactIds[i]);
        expect(copy.client_id).toBe(clientId);
        expect(copy.board_id).toBe(boardId);
        expect(copy.duplicated_from_ticket_id).toBe(sourceTicketId);
        expect(copy.ticket_origin).toBe('internal');
        expect(parse(copy.attributes).custom_fields).toEqual({ shirt_size: 'L' });
        expect(copy.status_id).toBe(statusId);
        expect(copy.assigned_to).toBe(ownerUser);
        expect(copy.assigned_team_id).toBe(teamId);
        expect(parse(copy.attributes).description).toBe('Original description');
        for (const denied of ['watch_list', 'sla_last_response_threshold_notified', 'source_reference']) {
          expect(parse(copy.attributes), `attributes.${denied} must not be copied`).not.toHaveProperty(denied);
        }

        const items = await tt('ticket_checklist_items').where({ ticket_id: entry.ticketId }).orderBy('order_number', 'asc');
        expect(items.map((item: any) => item.item_name)).toEqual(['Order laptop', 'Create accounts', 'Print badge']);
        expect(items.every((item: any) => item.completed === false && item.completed_at === null)).toBe(true);

        const agents = await tt('ticket_resources').where({ ticket_id: entry.ticketId }).select('additional_user_id');
        expect(agents.map((row: any) => row.additional_user_id).sort()).toEqual([...agentIds].sort());
        const tagRows = await tt('tag_mappings as tm')
          .join('tag_definitions as td', function (this: any) {
            this.on('td.tag_id', 'tm.tag_id').andOn('td.tenant', 'tm.tenant');
          })
          .where({ 'tm.tagged_id': entry.ticketId, 'tm.tagged_type': 'ticket' })
          .select('td.tag_text');
        expect(tagRows.map((row: any) => row.tag_text).sort()).toEqual(['hardware', 'onboarding']);

        const [from] = await tt('ticket_audit_logs').where({ ticket_id: entry.ticketId, event_type: TICKET_ACTIVITY_EVENT.DUPLICATED_FROM });
        expect(parse(from.details)).toMatchObject({ source_ticket_id: sourceTicketId, batch_id: result.batchId });
      }

      const toRows = await tt('ticket_audit_logs').where({ ticket_id: sourceTicketId, event_type: TICKET_ACTIVITY_EVENT.DUPLICATED_TO });
      expect(toRows).toHaveLength(12);
      expect(new Set(toRows.map((r: any) => parse(r.details).batch_id))).toEqual(new Set([result.batchId]));
    });

    it('copyChecklist: false copies no checklist items', async () => {
      const result: any = await ticketActions.duplicateTicketBatch(sourceTicketId, copiesFor(contactIds.slice(0, 2)), { copyChecklist: false });
      expect(result.created).toHaveLength(2);
      for (const entry of result.created) {
        expect(await tt('ticket_checklist_items').where({ ticket_id: entry.ticketId })).toHaveLength(0);
      }
    });

    it('accepts a copy without a contact', async () => {
      const result: any = await ticketActions.duplicateTicketBatch(sourceTicketId, [{ key: 'a', contactId: null, title: 'No contact' }], { copyChecklist: true });
      expect(result.created).toHaveLength(1);
      const copy = await tt('tickets').where({ ticket_id: result.created[0].ticketId }).first();
      expect(copy.contact_name_id).toBeNull();
    });
  });

  describe('partial failure', () => {
    it('fails only the other-client contact and the leftover token; the rest are created', async () => {
      const copies = [
        { key: 'ok1', contactId: contactIds[1], title: 'Fine 1' },
        { key: 'foreign', contactId: otherClientContactId, title: 'Wrong client' },
        { key: 'token', contactId: contactIds[2], title: 'Hello {{contact}}' },
        { key: 'blank', contactId: contactIds[3], title: '   ' },
        { key: 'ok2', contactId: contactIds[4], title: 'Fine 2' },
      ];
      const before = await countTickets();
      const result: any = await ticketActions.duplicateTicketBatch(sourceTicketId, copies, { copyChecklist: true });

      expect(result.created.map((c: any) => c.key)).toEqual(['ok1', 'ok2']);
      expect(result.failed.map((f: any) => f.key)).toEqual(['foreign', 'token', 'blank']);
      expect(result.failed[0].message).toMatch(/contact does not belong/i);
      expect(result.failed[1].message).toMatch(/unresolved/i);
      expect(await countTickets()).toBe(before + 2);
    });

    it('rolls a copy back completely when it fails after its ticket row was written', async () => {
      // Fails the DUPLICATED_FROM activity insert for one title, i.e. after the ticket,
      // its CREATED activity and its checklist copy exist in that copy's transaction.
      const fn = `bd_fail_${uuidv4().replace(/-/g, '')}`;
      await context.db.raw(`
        CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger AS $$
        BEGIN
          IF EXISTS (SELECT 1 FROM tickets WHERE tenant = NEW.tenant AND ticket_id = NEW.ticket_id AND title = 'ROLL ME BACK') THEN
            RAISE EXCEPTION 'forced batch duplicate failure';
          END IF;
          RETURN NEW;
        END $$ LANGUAGE plpgsql`);
      await context.db.raw(`
        CREATE TRIGGER ${fn} BEFORE INSERT ON ticket_audit_logs
        FOR EACH ROW WHEN (NEW.event_type = '${TICKET_ACTIVITY_EVENT.DUPLICATED_FROM}') EXECUTE FUNCTION ${fn}()`);
      // TestContext runs everything inside one outer transaction and withTransaction reuses
      // a transaction it is handed, so a failed copy would poison the rest. Hand the action a
      // view of the connection that hides commit/rollback: each copy then opens its own
      // savepoint, the closest in-harness equivalent of production's per-copy transaction.
      const base = context.db;
      const savepointDb = new Proxy(base as any, {
        get: (target, prop) => (prop === 'commit' || prop === 'rollback' ? undefined : Reflect.get(target, prop, target)),
      });
      const spy = vi.spyOn(pkgDb, 'createTenantKnex').mockImplementation(async () => ({ knex: savepointDb, tenant: tenantId }) as any);
      try {
        const copies = [
          { key: 'a', contactId: contactIds[1], title: 'First' },
          { key: 'b', contactId: contactIds[2], title: 'Second' },
          { key: 'c', contactId: contactIds[3], title: 'ROLL ME BACK' },
          { key: 'd', contactId: contactIds[4], title: 'Fourth' },
        ];
        const before = await countTickets();
        const result: any = await ticketActions.duplicateTicketBatch(sourceTicketId, copies, { copyChecklist: true });

        expect(result.created.map((c: any) => c.key)).toEqual(['a', 'b', 'd']);
        expect(result.failed.map((f: any) => f.key)).toEqual(['c']);
        expect(await countTickets()).toBe(before + 3);
        expect(await tt('tickets').where({ title: 'ROLL ME BACK' })).toHaveLength(0);
        // No orphaned activity for the rolled-back copy; the source records exactly the three that exist.
        expect(
          await tt('ticket_audit_logs').where({ ticket_id: sourceTicketId, event_type: TICKET_ACTIVITY_EVENT.DUPLICATED_TO })
        ).toHaveLength(3);
      } finally {
        spy.mockRestore();
        await context.db.raw(`DROP TRIGGER IF EXISTS ${fn} ON ticket_audit_logs`);
        await context.db.raw(`DROP FUNCTION IF EXISTS ${fn}()`);
      }
    });

    async function deleteSourceTicket() {
      await tt('ticket_audit_logs').where({ ticket_id: sourceTicketId }).delete();
      await tt('ticket_checklist_items').where({ ticket_id: sourceTicketId }).delete();
      await tt('ticket_resources').where({ ticket_id: sourceTicketId }).delete();
      await tt('tag_mappings').where({ tagged_id: sourceTicketId, tagged_type: 'ticket' }).delete();
      await tt('tickets').where({ duplicated_from_ticket_id: sourceTicketId }).update({ duplicated_from_ticket_id: null });
      await tt('tickets').where({ ticket_id: sourceTicketId }).delete();
    }

    it('keeps the copies already made and fails the rest cleanly when the source is deleted mid-batch', async () => {
      // Delete the source from inside copy 2 (right after its provenance write), so copies 3..4
      // find no source when they re-authorize inside their own transaction.
      const base = context.db;
      const savepointDb = new Proxy(base as any, {
        get: (target, prop) => (prop === 'commit' || prop === 'rollback' ? undefined : Reflect.get(target, prop, target)),
      });
      const spy = vi.spyOn(pkgDb, 'createTenantKnex').mockImplementation(async () => ({ knex: savepointDb, tenant: tenantId }) as any);
      duplicateHook.calls = 0;
      duplicateHook.afterCall = 2;
      duplicateHook.run = deleteSourceTicket;
      try {
        const copies = copiesFor(contactIds.slice(0, 4));
        const before = await countTickets();
        const result: any = await ticketActions.duplicateTicketBatch(sourceTicketId, copies, { copyChecklist: true });

        expect(result.created.map((c: any) => c.key)).toEqual(copies.slice(0, 2).map((c) => c.key));
        expect(result.failed.map((f: any) => f.key)).toEqual(copies.slice(2).map((c) => c.key));
        for (const failure of result.failed) expect(failure.message).toMatch(/Source ticket not found/);
        // +2 copies, -1 for the source the hook deleted.
        expect(await countTickets()).toBe(before + 2 - 1);
        for (const created of result.created) {
          expect(await tt('tickets').where({ ticket_id: created.ticketId })).toHaveLength(1);
        }
      } finally {
        duplicateHook.afterCall = null;
        duplicateHook.run = null;
        spy.mockRestore();
      }
    });

    it('refuses the whole request, creating nothing, when the source is already gone (retry after deletion)', async () => {
      const copies = copiesFor(contactIds.slice(0, 3));
      const first: any = await ticketActions.duplicateTicketBatch(sourceTicketId, [copies[0]], { copyChecklist: true });
      expect(first.created).toHaveLength(1);
      await deleteSourceTicket();

      const before = await countTickets();
      const rest = await attempt(() => ticketActions.duplicateTicketBatch(sourceTicketId, copies.slice(1), { copyChecklist: true }));
      expect(refusalMessage(rest)).toMatch(/not found|cannot view/i);
      expect(await countTickets()).toBe(before);
    });
  });

  describe('refusals create nothing', () => {
    async function expectRefused(run: () => Promise<unknown>, pattern: RegExp) {
      const tickets = await countTickets();
      const audit = await countAudit();
      const outcome = await attempt(run);
      expect(refusalMessage(outcome)).toMatch(pattern);
      expect(await countTickets()).toBe(tickets);
      expect(await countAudit()).toBe(audit);
    }

    it('refuses a user without ticket create', async () => {
      actAs(noCreateUser);
      await expectRefused(
        () => ticketActions.duplicateTicketBatch(sourceTicketId, copiesFor(contactIds.slice(0, 2)), { copyChecklist: true }),
        /permission denied|cannot create/i
      );
    });

    it('refuses a user who can create but has no row-level read on the source', async () => {
      const bundle = await createAuthorizationBundle(context.db, {
        tenant: tenantId, name: `own-only-${uuidv4()}`, actorUserId: creator.user_id,
      });
      await upsertBundleRule(context.db, {
        tenant: tenantId, bundleId: bundle.bundleId, revisionId: bundle.revisionId,
        resourceType: 'ticket', action: 'read', templateKey: 'own', config: {}, actorUserId: creator.user_id,
      });
      await publishBundleRevision(context.db as any, {
        tenant: tenantId, bundleId: bundle.bundleId, revisionId: bundle.revisionId, actorUserId: creator.user_id,
      });
      await createBundleAssignment(context.db, {
        tenant: tenantId, bundleId: bundle.bundleId, targetType: 'user', targetId: narrowedUser.user_id,
        actorUserId: creator.user_id,
      });
      actAs(narrowedUser);
      await expectRefused(
        () => ticketActions.duplicateTicketBatch(sourceTicketId, copiesFor(contactIds.slice(0, 2)), { copyChecklist: true }),
        /cannot view ticket/i
      );
    });

    it('refuses a client-portal user', async () => {
      actAs(clientPortalUser);
      await expectRefused(
        () => ticketActions.duplicateTicketBatch(sourceTicketId, copiesFor(contactIds.slice(0, 2)), { copyChecklist: true }),
        /client portal|permission denied/i
      );
    });

    it('refuses a missing source and a source from another tenant', async () => {
      await expectRefused(
        () => ticketActions.duplicateTicketBatch(uuidv4(), copiesFor(contactIds.slice(0, 2)), { copyChecklist: true }),
        /not found|cannot view/i
      );
    });

    it('refuses 0, 51 and duplicate-key requests', async () => {
      await expectRefused(() => ticketActions.duplicateTicketBatch(sourceTicketId, [], { copyChecklist: true }), /at least one/i);
      const many = Array.from({ length: 51 }, (_, i) => ({ key: `k${i}`, contactId: contactIds[i % 12], title: `T ${i}` }));
      await expectRefused(() => ticketActions.duplicateTicketBatch(sourceTicketId, many, { copyChecklist: true }), /at most 50/i);
      await expectRefused(
        () => ticketActions.duplicateTicketBatch(sourceTicketId, [
          { key: 'same', contactId: contactIds[1], title: 'A' },
          { key: 'same', contactId: contactIds[2], title: 'B' },
        ], { copyChecklist: true }),
        /unique key/i
      );
    });
  });
});
