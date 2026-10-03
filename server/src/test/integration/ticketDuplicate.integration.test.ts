/**
 * Integration tests for "Duplicate ticket" (plan docs/plans/2026-10-02-duplicate-ticket-plan.md,
 * test items 5-10). Real database, real RBAC, real authorization kernel; only the session
 * seam is mocked (as in infrastructure/tickets/ticketPermissions.test.ts).
 *
 * Covers: the copy set and what is never copied, the checklist opt-out, template
 * interplay, permission/authorization refusals (nothing written on refusal), provenance
 * being create-only, and the migration's final shape.
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
import { createUser } from '../../../test-utils/testDataFactory';
import { tenantDb } from '@alga-psa/db';
import { TICKET_ACTIVITY_EVENT } from '../../../../shared/lib/ticketActivity';

// Every ticket action is withAuth-wrapped, so the acting user comes from the session.
vi.mock('@alga-psa/auth', async () => {
  const { createAuthModuleMock } = await import('../../../test-utils/authModuleMock');
  return createAuthModuleMock();
});

const HOOK_TIMEOUT = 900_000;

type Outcome = { threw: Error | null; value: any };

/** Runs an action that may refuse by throwing or by returning an action-error payload. */
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

describe('Duplicate ticket (integration)', () => {
  const context = new TestContext({ runSeeds: true });
  let realPermissionCheck: typeof rbac.hasPermission;

  let tenantId: string;
  let clientId: string;
  let boardId: string;
  let statusId: string;
  let priorityId: string;
  let categoryId: string;
  let subcategoryId: string;
  let contactId: string;
  let teamId: string;

  let creator: any; // ticket read/create/update
  let noCreateUser: any; // ticket read only
  let narrowedUser: any; // ticket read/create + bundle narrowing ('own') on ticket read
  let clientPortalUser: any;
  let agentA: string;
  let agentB: string;
  let ownerUser: string;

  let sourceTicketId: string;
  let otherTicketId: string;

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
    await tt('roles').insert({
      tenant: tenantId,
      role_id: roleId,
      role_name: `Duplicate test ${roleId}`,
      msp: true,
      client: false,
    });
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

  function actAs(user: any) {
    vi.mocked(auth.getCurrentUser).mockResolvedValue(user);
  }

  function duplicateForm(overrides: Record<string, string> = {}): FormData {
    const form = new FormData();
    const fields: Record<string, string> = {
      title: 'Onboard new employee',
      description: 'Fresh description typed in the form',
      board_id: boardId,
      client_id: clientId,
      status_id: statusId,
      priority_id: priorityId,
      contact_name_id: contactId,
      category_id: categoryId,
      subcategory_id: subcategoryId,
      assigned_to: ownerUser,
      duplicate_of_ticket_id: sourceTicketId,
      ...overrides,
    };
    for (const [key, value] of Object.entries(fields)) {
      form.append(key, value);
    }
    return form;
  }

  async function createdTicket(result: any) {
    if (!result || !('ticket_id' in result)) {
      throw new Error(`addTicket did not create a ticket: ${JSON.stringify(result)}`);
    }
    return tt('tickets').where({ ticket_id: result.ticket_id }).first();
  }

  async function checklistOf(ticketId: string) {
    return tt('ticket_checklist_items').where({ ticket_id: ticketId }).orderBy('order_number', 'asc');
  }

  async function countTickets(): Promise<number> {
    const row = await tt('tickets').count('* as n').first();
    return Number((row as any).n);
  }

  async function addChecklistTemplate(opts: { name: string; items: { name: string; required?: boolean }[] }) {
    const templateId = uuidv4();
    await tt('checklist_templates').insert({ tenant: tenantId, template_id: templateId, name: opts.name, is_active: true });
    await tt('checklist_template_items').insert(
      opts.items.map((item, index) => ({
        tenant: tenantId,
        template_item_id: uuidv4(),
        template_id: templateId,
        item_name: item.name,
        order_number: index,
        is_required: item.required ?? true,
      }))
    );
    await tt('checklist_template_apply_rules').insert({
      tenant: tenantId,
      apply_rule_id: uuidv4(),
      template_id: templateId,
      board_id: boardId, // scoped to this test's board so no other data is affected
      is_enabled: true,
    });
    return templateId;
  }

  beforeEach(async () => {
    await context.reset();
    tenantId = context.tenantId;
    clientId = context.clientId;

    const creatorId = await createUser(context.db, tenantId, {
      username: 'dup-creator', first_name: 'Dana', last_name: 'Creator', email: 'dana@example.com', user_type: 'internal',
    });
    const noCreateId = await createUser(context.db, tenantId, {
      username: 'dup-reader', first_name: 'Rory', last_name: 'Reader', email: 'rory@example.com', user_type: 'internal',
    });
    const narrowedId = await createUser(context.db, tenantId, {
      username: 'dup-narrowed', first_name: 'Nora', last_name: 'Narrowed', email: 'nora@example.com', user_type: 'internal',
    });
    const portalId = await createUser(context.db, tenantId, {
      username: 'dup-portal', first_name: 'Pia', last_name: 'Portal', email: 'pia@example.com', user_type: 'client',
    });
    ownerUser = await createUser(context.db, tenantId, {
      username: 'dup-owner', first_name: 'Owen', last_name: 'Owner', email: 'owen@example.com', user_type: 'internal',
    });
    agentA = await createUser(context.db, tenantId, {
      username: 'dup-agent-a', first_name: 'Ada', last_name: 'Agent', email: 'ada@example.com', user_type: 'internal',
    });
    agentB = await createUser(context.db, tenantId, {
      username: 'dup-agent-b', first_name: 'Bob', last_name: 'Agent', email: 'bob@example.com', user_type: 'internal',
    });

    boardId = uuidv4();
    await tt('boards').insert({ tenant: tenantId, board_id: boardId, board_name: 'Dup Board' });

    contactId = uuidv4();
    await tt('contacts').insert({
      tenant: tenantId, contact_name_id: contactId, full_name: 'Dup Contact', email: 'contact@example.com', client_id: clientId,
    });

    priorityId = (await tt('priorities').where({ item_type: 'ticket' }).first()).priority_id;

    categoryId = uuidv4();
    subcategoryId = uuidv4();
    await tt('categories').insert({
      tenant: tenantId, category_id: categoryId, category_name: 'Dup Category', board_id: boardId, created_by: creatorId,
    });
    await tt('categories').insert({
      tenant: tenantId, category_id: subcategoryId, category_name: 'Dup Subcategory', board_id: boardId,
      parent_category: categoryId, created_by: creatorId,
    });

    statusId = uuidv4();
    await tt('statuses').insert({
      tenant: tenantId, status_id: statusId, name: 'Dup Open', board_id: boardId, status_type: 'ticket',
      is_closed: false, is_default: true, order_number: 9001, created_by: creatorId,
    });

    teamId = uuidv4();
    await tt('teams').insert({ tenant: tenantId, team_id: teamId, team_name: 'Dup Team', manager_id: ownerUser });

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

    // A second ticket, used as the master of the source and as an update-test target.
    otherTicketId = uuidv4();
    await tt('tickets').insert({
      tenant: tenantId, ticket_id: otherTicketId, ticket_number: 'DUP-OTHER', title: 'Other ticket',
      board_id: boardId, client_id: clientId, status_id: statusId, priority_id: priorityId,
      entered_by: creatorId, entered_at: new Date().toISOString(), is_closed: false,
    });

    // The source: everything the copy set mentions, plus everything it must never carry.
    sourceTicketId = uuidv4();
    await tt('tickets').insert({
      tenant: tenantId,
      ticket_id: sourceTicketId,
      ticket_number: 'DUP-SOURCE',
      title: 'Onboard new employee',
      board_id: boardId,
      client_id: clientId,
      contact_name_id: contactId,
      status_id: statusId,
      category_id: categoryId,
      subcategory_id: subcategoryId,
      priority_id: priorityId,
      assigned_to: ownerUser,
      assigned_team_id: teamId,
      entered_by: ownerUser, // not the narrowed user, so the 'own' bundle rule hides it
      entered_at: new Date().toISOString(),
      is_closed: false,
      due_date: new Date('2030-01-01T00:00:00Z').toISOString(),
      master_ticket_id: otherTicketId,
      source: 'email',
      ticket_origin: 'inbound_email',
      email_metadata: JSON.stringify({ message_id: 'm-1', from: 'someone@example.com' }),
      attributes: JSON.stringify({
        description: 'Original description',
        custom_fields: { shirt_size: 'L', start_date: '2026-11-01' },
        watch_list: [{ email: 'watcher@example.com' }],
        sla_last_response_threshold_notified: 80,
        sla_last_resolution_threshold_notified: 50,
        source_reference: { message_id: 'm-1' },
        teams_guest_intake: { guest: true },
        tags: ['legacy-tag'],
        due_date: '2030-01-01',
      }),
    });

    await tt('ticket_resources').insert([
      { tenant: tenantId, assignment_id: uuidv4(), ticket_id: sourceTicketId, assigned_to: ownerUser, additional_user_id: agentA, role: 'support' },
      { tenant: tenantId, assignment_id: uuidv4(), ticket_id: sourceTicketId, assigned_to: ownerUser, additional_user_id: agentB, role: 'support' },
    ]);

    const tagIds = [uuidv4(), uuidv4()];
    await tt('tag_definitions').insert([
      { tenant: tenantId, tag_id: tagIds[0], tag_text: 'onboarding', tagged_type: 'ticket', background_color: '#112233', text_color: '#ffffff' },
      { tenant: tenantId, tag_id: tagIds[1], tag_text: 'hardware', tagged_type: 'ticket', background_color: '#445566', text_color: '#000000' },
    ]);
    await tt('tag_mappings').insert(
      tagIds.map((tagId) => ({ tenant: tenantId, mapping_id: uuidv4(), tag_id: tagId, tagged_id: sourceTicketId, tagged_type: 'ticket' }))
    );

    // Three checklist items; one completed.
    await tt('ticket_checklist_items').insert([
      {
        tenant: tenantId, ticket_id: sourceTicketId, item_name: 'Order laptop', order_number: 0, is_required: true,
        completed: true, completed_by: ownerUser, completed_at: new Date().toISOString(), source: 'manual', created_by: ownerUser,
      },
      { tenant: tenantId, ticket_id: sourceTicketId, item_name: 'Create accounts', description: 'AD + email', order_number: 1, is_required: false, source: 'manual', created_by: ownerUser },
      { tenant: tenantId, ticket_id: sourceTicketId, item_name: 'Print badge', order_number: 2, is_required: true, source: 'manual', created_by: ownerUser },
    ]);

    // Things a duplicate must never carry: a comment, a time entry and a document link.
    const commentId = uuidv4();
    const threadId = uuidv4();
    await context.db.raw('SET CONSTRAINTS ALL DEFERRED'); // thread <-> root comment reference each other
    await tt('comment_threads').insert({
      tenant: tenantId, thread_id: threadId, ticket_id: sourceTicketId, root_comment_id: commentId, is_internal: false,
    });
    await tt('comments').insert({
      tenant: tenantId, comment_id: commentId, ticket_id: sourceTicketId, user_id: ownerUser, note: 'Source comment',
      is_internal: false, is_resolution: false, thread_id: threadId,
    });
    await tt('time_entries').insert({
      tenant: tenantId, entry_id: uuidv4(), user_id: ownerUser, work_item_id: sourceTicketId, work_item_type: 'ticket',
      start_time: new Date('2026-09-01T10:00:00Z').toISOString(), end_time: new Date('2026-09-01T11:00:00Z').toISOString(),
      work_date: '2026-09-01', work_timezone: 'UTC', billable_duration: 60, notes: 'Source time',
    });
    const documentId = uuidv4();
    await tt('documents').insert({
      tenant: tenantId, document_id: documentId, document_name: 'source.pdf', user_id: ownerUser, created_by: ownerUser,
    });
    await tt('document_associations').insert({
      tenant: tenantId, association_id: uuidv4(), document_id: documentId, entity_id: sourceTicketId, entity_type: 'ticket',
    });

    actAs(creator);
  }, HOOK_TIMEOUT);

  // ---------------------------------------------------------------- plan item 5
  describe('copy set', () => {
    it('getTicketDuplicateSource returns the copy set and nothing else', async () => {
      const source: any = await ticketActions.getTicketDuplicateSource(sourceTicketId);
      expect(source.actionError ?? source.permissionError).toBeUndefined();

      expect(source.ticket_id).toBe(sourceTicketId);
      expect(source.ticket_number).toBe('DUP-SOURCE');
      expect(source.title).toBe('Onboard new employee');
      expect(source.description).toBe('Original description');
      expect(source.client).toMatchObject({ id: clientId });
      expect(source.contact).toMatchObject({ id: contactId, name: 'Dup Contact' });
      expect(source.board_id).toBe(boardId);
      expect(source.category_id).toBe(categoryId);
      expect(source.subcategory_id).toBe(subcategoryId);
      expect(source.priority_id).toBe(priorityId);
      expect(source.assigned_to).toBe(ownerUser);
      expect(source.assigned_team_id).toBe(teamId);
      expect(source.additional_agents.map((a: any) => a.user_id).sort()).toEqual([agentA, agentB].sort());
      expect(source.tags.map((t: any) => t.tag_text).sort()).toEqual(['hardware', 'onboarding']);
      expect(source.checklist).toEqual([
        { item_name: 'Order laptop', is_required: true },
        { item_name: 'Create accounts', is_required: false },
        { item_name: 'Print badge', is_required: true },
      ]);
      expect(source.custom_field_count).toBe(2);

      // Nothing system-owned leaks into what the form receives.
      for (const denied of ['status_id', 'due_date', 'email_metadata', 'master_ticket_id', 'attributes', 'source', 'ticket_origin']) {
        expect(source).not.toHaveProperty(denied);
      }
    });

    it('addTicket copies the allowed set and records provenance', async () => {
      const before = await countTickets();
      const result: any = await ticketActions.addTicket(duplicateForm());
      const copy = await createdTicket(result);

      expect(await countTickets()).toBe(before + 1);
      expect(copy.ticket_id).not.toBe(sourceTicketId);
      expect(copy.ticket_number).not.toBe('DUP-SOURCE');
      expect(copy.duplicated_from_ticket_id).toBe(sourceTicketId);
      expect(copy.title).toBe('Onboard new employee'); // verbatim, no "(Copy)" suffix
      expect(copy.client_id).toBe(clientId);
      expect(copy.board_id).toBe(boardId);
      expect(copy.ticket_origin).toBe('internal');

      const attributes = typeof copy.attributes === 'string' ? JSON.parse(copy.attributes) : copy.attributes;
      expect(attributes.custom_fields).toEqual({ shirt_size: 'L', start_date: '2026-11-01' });
      expect(attributes.description).toBe('Fresh description typed in the form');
      for (const denied of [
        'watch_list',
        'sla_last_response_threshold_notified',
        'sla_last_resolution_threshold_notified',
        'source_reference',
        'teams_guest_intake',
        'tags',
        'due_date',
      ]) {
        expect(attributes, `attributes.${denied} must not be copied`).not.toHaveProperty(denied);
      }
    });

    it('never copies number, status, comments, time, documents, SLA, master link, email metadata or due date', async () => {
      const result: any = await ticketActions.addTicket(duplicateForm());
      const copy = await createdTicket(result);

      expect(copy.status_id).toBe(statusId); // from the form (board default), not copied server-side
      expect(copy.email_metadata).toBeNull();
      expect(copy.master_ticket_id).toBeNull();
      expect(copy.due_date).toBeNull();
      expect(copy.source).not.toBe('email');
      expect(copy.ticket_origin).toBe('internal');
      expect(copy.sla_response_at).toBeNull();
      expect(copy.sla_resolution_at).toBeNull();

      expect(await tt('comments').where({ ticket_id: copy.ticket_id })).toHaveLength(0);
      expect(await tt('time_entries').where({ work_item_id: copy.ticket_id })).toHaveLength(0);
      expect(
        await tt('document_associations').where({ entity_id: copy.ticket_id, entity_type: 'ticket' })
      ).toHaveLength(0);

      // The source is untouched.
      const source = await tt('tickets').where({ ticket_id: sourceTicketId }).first();
      expect(source.master_ticket_id).toBe(otherTicketId);
      expect(source.duplicated_from_ticket_id).toBeNull();
      expect(await tt('comments').where({ ticket_id: sourceTicketId })).toHaveLength(1);
    });

    it('copies checklist items unchecked, in the same order, keeping name/description/required', async () => {
      const result: any = await ticketActions.addTicket(duplicateForm());
      const copy = await createdTicket(result);

      const items = await checklistOf(copy.ticket_id);
      expect(items.map((i: any) => i.item_name)).toEqual(['Order laptop', 'Create accounts', 'Print badge']);
      expect(items.map((i: any) => i.is_required)).toEqual([true, false, true]);
      expect(items[1].description).toBe('AD + email');
      for (const item of items) {
        expect(item.completed).toBe(false);
        expect(item.completed_by).toBeNull();
        expect(item.completed_at).toBeNull();
        expect(item.created_by).toBe(creator.user_id);
      }
      const orders = items.map((i: any) => i.order_number);
      expect([...orders].sort((a, b) => a - b)).toEqual(orders);

      // The source's completed item stays completed.
      const sourceItems = await checklistOf(sourceTicketId);
      expect(sourceItems[0].completed).toBe(true);
    });

    it('writes TICKET_DUPLICATED_FROM on the copy and TICKET_DUPLICATED_TO on the source', async () => {
      const result: any = await ticketActions.addTicket(duplicateForm());
      const copy = await createdTicket(result);

      const fromRows = await tt('ticket_audit_logs').where({
        ticket_id: copy.ticket_id,
        event_type: TICKET_ACTIVITY_EVENT.DUPLICATED_FROM,
      });
      expect(fromRows).toHaveLength(1);
      const fromDetails = typeof fromRows[0].details === 'string' ? JSON.parse(fromRows[0].details) : fromRows[0].details;
      expect(fromDetails).toMatchObject({
        source_ticket_id: sourceTicketId,
        source_ticket_number: 'DUP-SOURCE',
        checklist_items_copied: 3,
        custom_fields_copied: 2,
      });

      const toRows = await tt('ticket_audit_logs').where({
        ticket_id: sourceTicketId,
        event_type: TICKET_ACTIVITY_EVENT.DUPLICATED_TO,
      });
      expect(toRows).toHaveLength(1);
      const toDetails = typeof toRows[0].details === 'string' ? JSON.parse(toRows[0].details) : toRows[0].details;
      expect(toDetails).toMatchObject({ duplicate_ticket_id: copy.ticket_id, duplicate_ticket_number: copy.ticket_number });

      // The copy is also a normally-created ticket.
      expect(
        await tt('ticket_audit_logs').where({ ticket_id: copy.ticket_id, event_type: TICKET_ACTIVITY_EVENT.CREATED })
      ).toHaveLength(1);
    });

    it('a normal (non-duplicate) create leaves provenance null and writes no duplicate events', async () => {
      const result: any = await ticketActions.addTicket(duplicateForm({ duplicate_of_ticket_id: '' }));
      const copy = await createdTicket(result);

      expect(copy.duplicated_from_ticket_id).toBeNull();
      const attributes = typeof copy.attributes === 'string' ? JSON.parse(copy.attributes) : copy.attributes;
      expect(attributes?.custom_fields).toBeUndefined();
      expect(await checklistOf(copy.ticket_id)).toHaveLength(0);
      expect(
        await tt('ticket_audit_logs').where({ event_type: TICKET_ACTIVITY_EVENT.DUPLICATED_TO })
      ).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------- plan item 6
  describe('checklist opt-out', () => {
    it('duplicate_copy_checklist=false copies no source items but auto-applied templates still apply', async () => {
      const templateId = await addChecklistTemplate({
        name: 'Board default',
        items: [{ name: 'Auto step 1' }, { name: 'Auto step 2', required: false }],
      });

      const form = duplicateForm();
      form.append('duplicate_copy_checklist', 'false');
      const result: any = await ticketActions.addTicket(form);
      const copy = await createdTicket(result);

      const items = await checklistOf(copy.ticket_id);
      expect(items.map((i: any) => i.item_name)).toEqual(['Auto step 1', 'Auto step 2']);
      expect(items.every((i: any) => i.template_id === templateId && i.source === 'template')).toBe(true);

      const fromRow = await tt('ticket_audit_logs')
        .where({ ticket_id: copy.ticket_id, event_type: TICKET_ACTIVITY_EVENT.DUPLICATED_FROM })
        .first();
      const details = typeof fromRow.details === 'string' ? JSON.parse(fromRow.details) : fromRow.details;
      expect(details.checklist_items_copied).toBe(0);
    });
  });

  // ---------------------------------------------------------------- plan item 7
  describe('template interplay', () => {
    it("the source's version of a template wins, and a newly matching template is still applied", async () => {
      const templateA = await addChecklistTemplate({ name: 'Template A', items: [{ name: 'A1' }, { name: 'A2' }] });
      const templateB = await addChecklistTemplate({ name: 'Template B', items: [{ name: 'B1' }] });

      // The source carries template A's items, one renamed, plus a manual item. It has no B.
      await tt('ticket_checklist_items').where({ ticket_id: sourceTicketId }).delete();
      await tt('ticket_checklist_items').insert([
        { tenant: tenantId, ticket_id: sourceTicketId, item_name: 'A1 (edited)', order_number: 0, is_required: true, source: 'template', template_id: templateA, completed: true, completed_by: ownerUser, completed_at: new Date().toISOString() },
        { tenant: tenantId, ticket_id: sourceTicketId, item_name: 'A2', order_number: 1, is_required: true, source: 'template', template_id: templateA },
        { tenant: tenantId, ticket_id: sourceTicketId, item_name: 'Manual item', order_number: 2, is_required: true, source: 'manual' },
      ]);

      const result: any = await ticketActions.addTicket(duplicateForm());
      const copy = await createdTicket(result);
      const items = await checklistOf(copy.ticket_id);

      const fromA = items.filter((i: any) => i.template_id === templateA);
      expect(fromA.map((i: any) => i.item_name).sort()).toEqual(['A1 (edited)', 'A2']); // exactly one set, the source's
      expect(fromA.every((i: any) => i.completed === false)).toBe(true);

      const fromB = items.filter((i: any) => i.template_id === templateB);
      expect(fromB.map((i: any) => i.item_name)).toEqual(['B1']); // newly matching template still auto-applied

      expect(items.filter((i: any) => i.item_name === 'Manual item')).toHaveLength(1);
      expect(items.filter((i: any) => i.item_name === 'A1')).toHaveLength(0); // the auto-applied A1 was replaced
      expect(items).toHaveLength(4);

      // Template provenance is kept, so the idempotency key still blocks a re-apply.
      const keyed = items.filter((i: any) => i.template_id).length;
      expect(keyed).toBe(3);
    });
  });

  // ---------------------------------------------------------------- plan item 8
  describe('permissions', () => {
    it('refuses a user without ticket:create, in both addTicket and getTicketDuplicateSource', async () => {
      actAs(noCreateUser);

      const before = await countTickets();
      const add = await attempt(() => ticketActions.addTicket(duplicateForm()));
      expect(refusalMessage(add)).toMatch(/permission denied|cannot create/i);
      expect(await countTickets()).toBe(before);

      const load = await attempt(() => ticketActions.getTicketDuplicateSource(sourceTicketId));
      expect(refusalMessage(load)).toMatch(/permission denied|cannot create/i);
    });

    it('refuses a user who can create but has no row-level read on the source, and writes nothing', async () => {
      // Narrow the user to tickets they own; the source is owned by someone else.
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
      const ticketsBefore = await countTickets();
      const auditBefore = await tt('ticket_audit_logs').count('* as n').first();

      const add = await attempt(() => ticketActions.addTicket(duplicateForm()));
      expect(refusalMessage(add)).toMatch(/cannot view ticket/i);

      const load = await attempt(() => ticketActions.getTicketDuplicateSource(sourceTicketId));
      expect(refusalMessage(load)).toMatch(/cannot view ticket/i);

      // Rolled back: no ticket, no checklist copy, no activity rows.
      expect(await countTickets()).toBe(ticketsBefore);
      const auditAfter = await tt('ticket_audit_logs').count('* as n').first();
      expect(Number((auditAfter as any).n)).toBe(Number((auditBefore as any).n));
      expect(await tt('ticket_audit_logs').where({ event_type: TICKET_ACTIVITY_EVENT.DUPLICATED_TO })).toHaveLength(0);
    });

    it('refuses a client-portal user', async () => {
      actAs(clientPortalUser);

      const load = await attempt(() => ticketActions.getTicketDuplicateSource(sourceTicketId));
      expect(refusalMessage(load)).toMatch(/permission denied|not available in client portal/i);

      const before = await countTickets();
      const add = await attempt(() => ticketActions.addTicket(duplicateForm()));
      expect(refusalMessage(add)).toMatch(/permission denied|not available in client portal/i);
      expect(await countTickets()).toBe(before);
    });

    it('reports "Source ticket not found" for a missing, malformed or other-tenant source id', async () => {
      // Another tenant's ticket: the id is real but tenant-scoped lookup must not find it.
      const otherTenant = uuidv4();
      const otherClient = uuidv4();
      const otherTicket = uuidv4();
      await tenantDb(context.db, otherTenant).table('tenants').insert({
        tenant: otherTenant, client_name: 'Other Tenant', email: `other-${otherTenant.slice(0, 6)}@example.com`,
      });
      await tenantDb(context.db, otherTenant).table('clients').insert({
        tenant: otherTenant, client_id: otherClient, client_name: 'Other Client',
      });
      await tenantDb(context.db, otherTenant).table('tickets').insert({
        tenant: otherTenant, ticket_id: otherTicket, ticket_number: 'OTHER-1', title: 'Other tenant ticket',
        client_id: otherClient, entered_at: new Date().toISOString(), is_closed: false,
      });

      for (const id of [uuidv4(), 'not-a-uuid', otherTicket]) {
        const before = await countTickets();
        const load = await attempt(() => ticketActions.getTicketDuplicateSource(id));
        expect(refusalMessage(load)).toMatch(/source ticket not found/i);

        const add = await attempt(() => ticketActions.addTicket(duplicateForm({ duplicate_of_ticket_id: id })));
        expect(refusalMessage(add)).toMatch(/source ticket not found/i);
        expect(await countTickets()).toBe(before);
      }
    });
  });

  // ---------------------------------------------------------------- plan item 9
  describe('provenance is create-only', () => {
    it('updateTicket cannot change duplicated_from_ticket_id', async () => {
      const created: any = await ticketActions.addTicket(duplicateForm());
      const copy = await createdTicket(created);
      expect(copy.duplicated_from_ticket_id).toBe(sourceTicketId);

      // Re-pointing, and clearing, are both ignored; the rest of the update still applies.
      await attempt(() =>
        ticketActions.updateTicket(copy.ticket_id, {
          title: 'Retitled copy',
          duplicated_from_ticket_id: otherTicketId,
        } as any)
      );
      await attempt(() =>
        ticketActions.updateTicket(copy.ticket_id, { duplicated_from_ticket_id: null } as any)
      );

      const after = await tt('tickets').where({ ticket_id: copy.ticket_id }).first();
      expect(after.duplicated_from_ticket_id).toBe(sourceTicketId);
    });

    it('updateTicket cannot set provenance on a ticket that has none', async () => {
      await attempt(() =>
        ticketActions.updateTicket(otherTicketId, { duplicated_from_ticket_id: sourceTicketId } as any)
      );
      const after = await tt('tickets').where({ ticket_id: otherTicketId }).first();
      expect(after.duplicated_from_ticket_id).toBeNull();
    });
  });

  // --------------------------------------------------------------- plan item 10
  describe('migration', () => {
    it('leaves a nullable uuid column with no foreign key and no index', async () => {
      const column = await context.db.raw(
        `SELECT data_type, is_nullable FROM information_schema.columns
          WHERE table_name = 'tickets' AND column_name = 'duplicated_from_ticket_id'`
      );
      expect(column.rows).toEqual([{ data_type: 'uuid', is_nullable: 'YES' }]);

      const fks = await context.db.raw(
        `SELECT c.conname FROM pg_constraint c
           JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
          WHERE c.conrelid = 'tickets'::regclass AND c.contype = 'f' AND a.attname = 'duplicated_from_ticket_id'`
      );
      expect(fks.rows).toEqual([]);

      const indexes = await context.db.raw(
        `SELECT indexname FROM pg_indexes WHERE tablename = 'tickets' AND indexdef ILIKE '%duplicated_from_ticket_id%'`
      );
      expect(indexes.rows).toEqual([]);
    });

    it('up is idempotent when the column already exists', async () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const migration = require('../../../migrations/20261003001628_add_duplicated_from_ticket_id_to_tickets.cjs');
      await expect(migration.up(context.db)).resolves.not.toThrow();
      const column = await context.db.raw(
        `SELECT 1 FROM information_schema.columns WHERE table_name = 'tickets' AND column_name = 'duplicated_from_ticket_id'`
      );
      expect(column.rows).toHaveLength(1);
    });
  });
});
