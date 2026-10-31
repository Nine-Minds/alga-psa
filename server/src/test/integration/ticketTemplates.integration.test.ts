/**
 * Integration tests for ticket templates + "Create template from ticket"
 * (plan docs/plans/2026-10-13-create-template-from-ticket-plan.md, test items 8-13).
 * Real database, real RBAC; only the session seam is mocked (same harness as
 * ticketDuplicate.integration.test.ts).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { setupCommonMocks, createMockUser } from '../../../test-utils/testMocks';
import * as auth from '@alga-psa/auth';
import * as rbac from '@alga-psa/auth/rbac';
import * as ticketActions from '@alga-psa/tickets/actions/ticketActions';
import * as templateActions from '@alga-psa/tickets/actions/ticketTemplateActions';
import { TestContext } from '../../../test-utils/testContext';
import { createUser } from '../../../test-utils/testDataFactory';
import { tenantDb } from '@alga-psa/db';
import { TICKET_ACTIVITY_EVENT } from '../../../../shared/lib/ticketActivity';

vi.mock('@alga-psa/auth', async () => {
  const { createAuthModuleMock } = await import('../../../test-utils/authModuleMock');
  return createAuthModuleMock();
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

const json = (value: unknown) => (typeof value === 'string' ? JSON.parse(value) : value);

describe('Ticket templates (integration)', () => {
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
  let checklistTemplateX: string;

  let admin: any; // ticket read/create/update + every ticket_template action
  let technician: any; // ticket read/create + ticket_template read
  let noTemplateReadUser: any; // ticket read/create, no ticket_template permission
  let draftOnlyUser: any; // ticket read + ticket_template create, but row-level read narrowed away
  let clientPortalUser: any;
  let ownerUser: string;
  let sourceTicketId: string;

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
    await tt('roles').insert({ tenant: tenantId, role_id: roleId, role_name: `Template test ${roleId}`, msp: true, client: false });
    for (const { resource, actions } of grants) {
      const permissions = await tt('permissions').where({ resource, msp: true }).whereIn('action', actions).select('permission_id', 'action');
      expect(new Set(permissions.map((p: any) => p.action)), `permissions for ${resource}`).toEqual(new Set(actions));
      await tt('role_permissions').insert(
        permissions.map((p: any) => ({ tenant: tenantId, role_id: roleId, permission_id: p.permission_id }))
      );
    }
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

  function ticketForm(templateId: string | null, overrides: Record<string, string> = {}): FormData {
    const form = new FormData();
    const fields: Record<string, string> = {
      title: 'Employee department change',
      description: 'Typed in the form',
      board_id: boardId,
      client_id: clientId,
      status_id: statusId,
      priority_id: priorityId,
      contact_name_id: contactId,
      category_id: categoryId,
      subcategory_id: subcategoryId,
      assigned_to: ownerUser,
      ...(templateId ? { ticket_template_id: templateId } : {}),
      ...overrides,
    };
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    return form;
  }

  async function createdTicket(result: any) {
    if (!result || !('ticket_id' in result)) {
      throw new Error(`addTicket did not create a ticket: ${JSON.stringify(result)}`);
    }
    return tt('tickets').where({ ticket_id: result.ticket_id }).first();
  }

  const checklistOf = (ticketId: string) =>
    tt('ticket_checklist_items').where({ ticket_id: ticketId }).orderBy('order_number', 'asc');

  async function countTickets(): Promise<number> {
    const row = await tt('tickets').count('* as n').first();
    return Number((row as any).n);
  }

  /** Inserts a template straight into the table, so create-flow tests do not depend on the editor actions. */
  async function insertTemplate(opts: {
    name?: string;
    isActive?: boolean;
    offerForManualUse?: boolean;
    boardId?: string | null;
    items?: Array<{ name: string; required?: boolean; checklistTemplateId?: string | null }>;
    customFields?: Record<string, unknown>;
  } = {}) {
    const templateId = uuidv4();
    await tt('ticket_templates').insert({
      tenant: tenantId,
      template_id: templateId,
      name: opts.name ?? `Template ${templateId.slice(0, 6)}`,
      title: 'Employee department change',
      board_id: opts.boardId === undefined ? boardId : opts.boardId,
      category_id: categoryId,
      subcategory_id: subcategoryId,
      priority_id: priorityId,
      tags: JSON.stringify([]),
      custom_fields: JSON.stringify(opts.customFields ?? { department: 'Sales', shirt_size: 'M' }),
      is_active: opts.isActive ?? true,
      offer_for_manual_use: opts.offerForManualUse ?? true,
    });
    const items = opts.items ?? [{ name: 'Create accounts' }, { name: 'Order laptop', required: false }];
    if (items.length) {
      await tt('ticket_template_checklist_items').insert(
        items.map((item, index) => ({
          tenant: tenantId,
          template_item_id: uuidv4(),
          template_id: templateId,
          item_name: item.name,
          order_number: index,
          is_required: item.required ?? true,
          checklist_template_id: item.checklistTemplateId ?? null,
        }))
      );
    }
    return templateId;
  }

  beforeEach(async () => {
    await context.reset();
    tenantId = context.tenantId;
    clientId = context.clientId;

    const adminId = await createUser(context.db, tenantId, { username: 'tpl-admin', first_name: 'Ada', last_name: 'Admin', email: 'ada@example.com', user_type: 'internal' });
    const techId = await createUser(context.db, tenantId, { username: 'tpl-tech', first_name: 'Tess', last_name: 'Tech', email: 'tess@example.com', user_type: 'internal' });
    const noTplId = await createUser(context.db, tenantId, { username: 'tpl-none', first_name: 'Nils', last_name: 'None', email: 'nils@example.com', user_type: 'internal' });
    const draftOnlyId = await createUser(context.db, tenantId, { username: 'tpl-draft', first_name: 'Dru', last_name: 'Draft', email: 'dru@example.com', user_type: 'internal' });
    const portalId = await createUser(context.db, tenantId, { username: 'tpl-portal', first_name: 'Pia', last_name: 'Portal', email: 'pia@example.com', user_type: 'client' });
    ownerUser = await createUser(context.db, tenantId, { username: 'tpl-owner', first_name: 'Owen', last_name: 'Owner', email: 'owen@example.com', user_type: 'internal' });

    boardId = uuidv4();
    await tt('boards').insert({ tenant: tenantId, board_id: boardId, board_name: 'Tpl Board' });
    contactId = uuidv4();
    await tt('contacts').insert({ tenant: tenantId, contact_name_id: contactId, full_name: 'Tpl Contact', email: 'contact@example.com', client_id: clientId });
    priorityId = (await tt('priorities').where({ item_type: 'ticket' }).first()).priority_id;
    categoryId = uuidv4();
    subcategoryId = uuidv4();
    await tt('categories').insert({ tenant: tenantId, category_id: categoryId, category_name: 'Tpl Category', board_id: boardId, created_by: adminId });
    await tt('categories').insert({ tenant: tenantId, category_id: subcategoryId, category_name: 'Tpl Subcategory', board_id: boardId, parent_category: categoryId, created_by: adminId });
    statusId = uuidv4();
    await tt('statuses').insert({ tenant: tenantId, status_id: statusId, name: 'Tpl Open', board_id: boardId, status_type: 'ticket', is_closed: false, is_default: true, order_number: 9001, created_by: adminId });

    // Checklist template X, auto-applied on this board.
    checklistTemplateX = uuidv4();
    await tt('checklist_templates').insert({ tenant: tenantId, template_id: checklistTemplateX, name: 'Template X', is_active: true });
    await tt('checklist_template_items').insert([
      { tenant: tenantId, template_item_id: uuidv4(), template_id: checklistTemplateX, item_name: 'X1', order_number: 0, is_required: true },
      { tenant: tenantId, template_item_id: uuidv4(), template_id: checklistTemplateX, item_name: 'X2', order_number: 1, is_required: true },
    ]);

    setupCommonMocks({ tenantId, user: createMockUser('internal') });
    vi.mocked(rbac.hasPermission).mockImplementation(realPermissionCheck);
    vi.mocked(auth.hasPermission).mockImplementation(realPermissionCheck);

    await grantRole(adminId, [
      { resource: 'ticket', actions: ['read', 'update', 'create'] },
      { resource: 'ticket_template', actions: ['read', 'create', 'update', 'delete'] },
    ]);
    await grantRole(techId, [
      { resource: 'ticket', actions: ['read', 'create'] },
      { resource: 'ticket_template', actions: ['read'] },
    ]);
    await grantRole(noTplId, [{ resource: 'ticket', actions: ['read', 'create'] }]);
    await grantRole(draftOnlyId, [
      { resource: 'ticket', actions: ['read'] },
      { resource: 'ticket_template', actions: ['create'] },
    ]);
    admin = await loadUser(adminId);
    technician = await loadUser(techId);
    noTemplateReadUser = await loadUser(noTplId);
    draftOnlyUser = await loadUser(draftOnlyId);
    clientPortalUser = await loadUser(portalId);

    // The source ticket for "create template from ticket".
    sourceTicketId = uuidv4();
    await tt('tickets').insert({
      tenant: tenantId,
      ticket_id: sourceTicketId,
      ticket_number: 'TPL-SOURCE',
      title: 'Jane Smith moved to Sales',
      board_id: boardId,
      client_id: clientId,
      contact_name_id: contactId,
      status_id: statusId,
      category_id: categoryId,
      subcategory_id: subcategoryId,
      priority_id: priorityId,
      assigned_to: ownerUser,
      entered_by: adminId,
      entered_at: new Date().toISOString(),
      is_closed: false,
      attributes: JSON.stringify({
        description: 'Original description',
        custom_fields: { department: 'Sales', shirt_size: 'L' },
        watch_list: [{ email: 'watcher@example.com' }],
        sla_last_response_threshold_notified: 80,
        sla_last_resolution_threshold_notified: 50,
      }),
    });

    const tagIds = [uuidv4(), uuidv4()];
    await tt('tag_definitions').insert([
      { tenant: tenantId, tag_id: tagIds[0], tag_text: 'onboarding', tagged_type: 'ticket', background_color: '#112233', text_color: '#ffffff' },
      { tenant: tenantId, tag_id: tagIds[1], tag_text: 'hardware', tagged_type: 'ticket', background_color: '#445566', text_color: '#000000' },
    ]);
    await tt('tag_mappings').insert(
      tagIds.map((tagId) => ({ tenant: tenantId, mapping_id: uuidv4(), tag_id: tagId, tagged_id: sourceTicketId, tagged_type: 'ticket' }))
    );

    await tt('ticket_checklist_items').insert([
      { tenant: tenantId, ticket_id: sourceTicketId, item_name: 'Order laptop', order_number: 0, is_required: true, completed: true, completed_by: ownerUser, completed_at: new Date().toISOString(), source: 'manual', created_by: ownerUser },
      { tenant: tenantId, ticket_id: sourceTicketId, item_name: 'Create accounts', description: 'AD + email', order_number: 1, is_required: false, source: 'manual', created_by: ownerUser },
      { tenant: tenantId, ticket_id: sourceTicketId, item_name: 'X1', order_number: 2, is_required: true, source: 'template', template_id: checklistTemplateX, created_by: ownerUser },
    ]);

    actAs(admin);
  }, HOOK_TIMEOUT);

  async function addBoardApplyRule() {
    await tt('checklist_template_apply_rules').insert({
      tenant: tenantId, apply_rule_id: uuidv4(), template_id: checklistTemplateX, where: JSON.stringify({ join: 'and', clauses: [{ path: 'board_id', operator: 'equals', value: boardId }] }), is_enabled: true,
    });
  }

  // ------------------------------------------------------------------ item 8
  describe('from ticket -> template', () => {
    it('getTicketTemplateDraftFromTicket returns the copy set and drops everything else', async () => {
      const result: any = await ticketActions.getTicketTemplateDraftFromTicket(sourceTicketId);
      expect(result.actionError ?? result.permissionError).toBeUndefined();
      expect(result.source_ticket_id).toBe(sourceTicketId);
      const draft = result.draft;

      expect(draft.name).toBe('Jane Smith moved to Sales');
      expect(draft.title).toBe('Jane Smith moved to Sales');
      expect(draft.board_id).toBe(boardId);
      expect(draft.category_id).toBe(categoryId);
      expect(draft.subcategory_id).toBe(subcategoryId);
      expect(draft.priority_id).toBe(priorityId);
      expect([...draft.tags].sort()).toEqual(['hardware', 'onboarding']);
      expect(draft.custom_fields).toEqual({ department: 'Sales', shirt_size: 'L' });
      expect(draft.checklist.map((i: any) => i.item_name)).toEqual(['Order laptop', 'Create accounts', 'X1']);
      expect(draft.checklist.map((i: any) => i.is_required)).toEqual([true, false, true]);
      expect(draft.checklist[2].checklist_template_id).toBe(checklistTemplateX);

      const serialized = JSON.stringify(draft);
      for (const denied of ['completed', 'completed_by', 'client_id', 'contact_name_id', 'assigned_to', 'watch_list', 'sla_last']) {
        expect(serialized, `${denied} must not leak into the draft`).not.toContain(denied);
      }
    });

    it('createTicketTemplate persists exactly the edited draft', async () => {
      const draft: any = (await ticketActions.getTicketTemplateDraftFromTicket(sourceTicketId) as any).draft;
      const input = {
        name: 'Microsoft 365 Employee Department Change',
        notes: null,
        title: 'Employee department change',
        description: draft.description ?? null,
        board_id: draft.board_id,
        category_id: draft.category_id,
        subcategory_id: draft.subcategory_id,
        priority_id: draft.priority_id,
        itil_impact: null,
        itil_urgency: null,
        tags: draft.tags,
        custom_fields: { department: 'Sales' }, // shirt_size removed
        checklist: draft.checklist.slice(1), // 'Order laptop' removed
      };
      const created: any = await templateActions.createTicketTemplate(input, sourceTicketId);
      expect(created.template_id).toBeTruthy();

      const row = await tt('ticket_templates').where({ template_id: created.template_id }).first();
      expect(row.name).toBe('Microsoft 365 Employee Department Change');
      expect(row.title).toBe('Employee department change');
      expect(json(row.custom_fields)).toEqual({ department: 'Sales' });
      expect(row.is_active).toBe(true);
      expect(row.source_ticket_id).toBe(sourceTicketId);
      expect(row.created_by).toBe(admin.user_id);

      const items = await tt('ticket_template_checklist_items').where({ template_id: created.template_id }).orderBy('order_number');
      expect(items.map((i: any) => i.item_name)).toEqual(['Create accounts', 'X1']);
      expect(items[1].checklist_template_id).toBe(checklistTemplateX);

      // Nothing is written to the source ticket.
      const source = await tt('tickets').where({ ticket_id: sourceTicketId }).first();
      expect(source.created_from_template_id ?? null).toBeNull();

      expect(Number(((await tt('ticket_templates').count('* as n').first()) as any).n)).toBe(1);

      // Active names are unique per tenant, case-insensitively.
      const again: any = await templateActions.createTicketTemplate({ ...input, name: 'microsoft 365 employee department change' });
      expect(refusalMessage({ threw: null, value: again })).toBeTruthy();
      // (no further queries: the unique violation aborts the shared test transaction)
    });
  });

  // ------------------------------------------------------------------ item 9
  describe('template -> ticket (acceptance path)', () => {
    it('creates a ticket from a template: provenance, custom fields, unchecked checklist, activity', async () => {
      await addBoardApplyRule(); // X also auto-applies on this board
      const templateId = await insertTemplate({
        name: 'Dept change',
        items: [
          { name: 'Create accounts' },
          { name: 'X1 (template edit)', checklistTemplateId: checklistTemplateX },
          { name: 'X2', checklistTemplateId: checklistTemplateX },
          { name: 'Order laptop', required: false },
        ],
      });
      actAs(technician);

      const result: any = await ticketActions.addTicket(ticketForm(templateId));
      const ticket = await createdTicket(result);

      expect(ticket.created_from_template_id).toBe(templateId);
      expect(ticket.ticket_origin).toBe('internal');
      expect(ticket.status_id).toBe(statusId); // the board default, never copied from the template
      const attributes = json(ticket.attributes);
      expect(attributes.custom_fields).toEqual({ department: 'Sales', shirt_size: 'M' });
      for (const denied of ['watch_list', 'sla_last_response_threshold_notified', 'tags', 'source_reference']) {
        expect(attributes).not.toHaveProperty(denied);
      }

      const items = await checklistOf(ticket.ticket_id);
      expect(items.every((i: any) => i.completed === false && i.completed_by === null)).toBe(true);
      expect(items.map((i: any) => i.item_name)).toEqual(
        expect.arrayContaining(['Create accounts', 'X1 (template edit)', 'X2', 'Order laptop'])
      );
      const order = items.filter((i: any) => i.source !== 'template' || i.item_name !== 'X1' ).map((i: any) => i.item_name);
      expect(order.indexOf('Create accounts')).toBeLessThan(order.indexOf('Order laptop'));

      // Exactly one set of X items: the template's version replaced the auto-applied one.
      const xItems = items.filter((i: any) => i.template_id === checklistTemplateX);
      expect(xItems.map((i: any) => i.item_name).sort()).toEqual(['X1 (template edit)', 'X2']);
      expect(items.filter((i: any) => i.item_name === 'X1')).toHaveLength(0);

      const rows = await tt('ticket_audit_logs').where({
        ticket_id: ticket.ticket_id,
        event_type: TICKET_ACTIVITY_EVENT.CREATED_FROM_TEMPLATE,
      });
      expect(rows).toHaveLength(1);
      expect(json(rows[0].details)).toMatchObject({
        template_id: templateId,
        template_name: 'Dept change',
        checklist_items_copied: 4,
        custom_fields_copied: 2,
      });
    });

    it('template_copy_checklist=false omits the template items but auto-applied templates still apply', async () => {
      await addBoardApplyRule();
      const templateId = await insertTemplate({ items: [{ name: 'Only on template' }] });
      actAs(technician);

      const form = ticketForm(templateId);
      form.append('template_copy_checklist', 'false');
      const ticket = await createdTicket(await ticketActions.addTicket(form));

      const items = await checklistOf(ticket.ticket_id);
      expect(items.map((i: any) => i.item_name)).toEqual(['X1', 'X2']);
      expect(ticket.created_from_template_id).toBe(templateId);
      const row = await tt('ticket_audit_logs').where({ ticket_id: ticket.ticket_id, event_type: TICKET_ACTIVITY_EVENT.CREATED_FROM_TEMPLATE }).first();
      expect(json(row.details).checklist_items_copied).toBe(0);
    });

    it('ignores client-supplied attributes: custom fields come from the template only', async () => {
      const templateId = await insertTemplate({ customFields: { department: 'Sales' } });
      const form = ticketForm(templateId);
      form.append('attributes', JSON.stringify({ custom_fields: { evil: 'x' }, watch_list: [{ email: 'a@b.c' }] }));
      const ticket = await createdTicket(await ticketActions.addTicket(form));
      expect(json(ticket.attributes).custom_fields).toEqual({ department: 'Sales' });
      expect(json(ticket.attributes)).not.toHaveProperty('watch_list');
    });

    it('a normal create leaves created_from_template_id null and writes no template activity', async () => {
      const ticket = await createdTicket(await ticketActions.addTicket(ticketForm(null)));
      expect(ticket.created_from_template_id ?? null).toBeNull();
      expect(await tt('ticket_audit_logs').where({ event_type: TICKET_ACTIVITY_EVENT.CREATED_FROM_TEMPLATE })).toHaveLength(0);
    });

    it('getTicketById reports the template name for the header', async () => {
      const templateId = await insertTemplate({ name: 'Header template' });
      const ticket = await createdTicket(await ticketActions.addTicket(ticketForm(templateId)));
      const loaded: any = await ticketActions.getTicketById(ticket.ticket_id);
      expect(loaded.created_from_template_id).toBe(templateId);
      expect(loaded.created_from_template_name).toBe('Header template');

      // Deleting the template neither fails nor cascades; the ticket keeps its id, the name goes.
      await tt('ticket_templates').where({ template_id: templateId }).delete();
      const after: any = await ticketActions.getTicketById(ticket.ticket_id);
      expect(after.created_from_template_id).toBe(templateId);
      expect(after.created_from_template_name ?? null).toBeNull();
    });
  });

  // ----------------------------------------------------------------- item 10
  describe('permission gating', () => {
    it('refuses a Technician-level user on every template management action', async () => {
      const templateId = await insertTemplate();
      actAs(technician);

      const draft = await attempt(() => ticketActions.getTicketTemplateDraftFromTicket(sourceTicketId));
      expect(refusalMessage(draft)).toMatch(/permission denied|cannot/i);

      const input = { name: 'T', title: 'T' };
      const create = await attempt(() => templateActions.createTicketTemplate(input as any));
      expect(refusalMessage(create)).toMatch(/permission denied|cannot/i);
      const update = await attempt(() => templateActions.updateTicketTemplate(templateId, input as any));
      expect(refusalMessage(update)).toMatch(/permission denied|cannot/i);
      const setActive = await attempt(() => templateActions.setTicketTemplateActive(templateId, false));
      expect(refusalMessage(setActive)).toMatch(/permission denied|cannot/i);
      const del = await attempt(() => templateActions.deleteTicketTemplate(templateId));
      expect(refusalMessage(del)).toMatch(/permission denied|cannot/i);
      expect(await tt('ticket_templates').where({ template_id: templateId })).toHaveLength(1);
      expect((await tt('ticket_templates').where({ template_id: templateId }).first()).is_active).toBe(true);
    });

    it('lets a Technician list templates for create, load one, and create a ticket from it', async () => {
      const templateId = await insertTemplate({ name: 'Usable' });
      await insertTemplate({ name: 'Retired', isActive: false });
      actAs(technician);

      const options: any = await templateActions.listTicketTemplatesForCreate();
      expect(options.map((o: any) => o.name)).toEqual(['Usable']);
      const forCreate: any = await templateActions.getTicketTemplateForCreate(templateId);
      expect(forCreate.template_id).toBe(templateId);
      const ticket = await createdTicket(await ticketActions.addTicket(ticketForm(templateId)));
      expect(ticket.created_from_template_id).toBe(templateId);
    });

    it('allows an Admin everywhere', async () => {
      const draft: any = (await ticketActions.getTicketTemplateDraftFromTicket(sourceTicketId) as any).draft;
      expect(draft.title).toBeTruthy();
      const created: any = await templateActions.createTicketTemplate({ name: 'A', title: 'A' } as any);
      expect(created.template_id).toBeTruthy();
      const updated: any = await templateActions.updateTicketTemplate(created.template_id, { name: 'A2', title: 'A' } as any);
      expect(updated.template_id).toBe(created.template_id);
      const toggled: any = await templateActions.setTicketTemplateActive(created.template_id, false);
      expect(toggled.template_id).toBe(created.template_id);
      const list: any = await templateActions.listTicketTemplates({ includeInactive: true });
      expect(list.map((t: any) => t.name)).toContain('A2');
      const deleted: any = await templateActions.deleteTicketTemplate(created.template_id);
      expect(deleted.template_id).toBe(created.template_id);
      expect(await tt('ticket_templates').where({ template_id: created.template_id })).toHaveLength(0);
    });

    it('refuses template:create without row-level read of the source ticket ("Cannot view ticket")', async () => {
      const { createAuthorizationBundle, createBundleAssignment, publishBundleRevision, upsertBundleRule } =
        await import('@alga-psa/authorization/bundles/service');
      const bundle = await createAuthorizationBundle(context.db, {
        tenant: tenantId, name: `own-only-${uuidv4()}`, actorUserId: admin.user_id,
      });
      await upsertBundleRule(context.db, {
        tenant: tenantId, bundleId: bundle.bundleId, revisionId: bundle.revisionId,
        resourceType: 'ticket', action: 'read', templateKey: 'own', config: {}, actorUserId: admin.user_id,
      });
      await publishBundleRevision(context.db as any, {
        tenant: tenantId, bundleId: bundle.bundleId, revisionId: bundle.revisionId, actorUserId: admin.user_id,
      });
      await createBundleAssignment(context.db, {
        tenant: tenantId, bundleId: bundle.bundleId, targetType: 'user', targetId: draftOnlyUser.user_id, actorUserId: admin.user_id,
      });

      actAs(draftOnlyUser);
      const draft = await attempt(() => ticketActions.getTicketTemplateDraftFromTicket(sourceTicketId));
      expect(refusalMessage(draft)).toMatch(/cannot view ticket/i);
    });

    it('refuses addTicket with a template for a user without ticket_template:read, writing nothing', async () => {
      const templateId = await insertTemplate();
      actAs(noTemplateReadUser);
      const before = await countTickets();
      const add = await attempt(() => ticketActions.addTicket(ticketForm(templateId)));
      expect(refusalMessage(add)).toMatch(/permission denied|cannot use ticket templates/i);
      expect(await countTickets()).toBe(before);
      expect(await tt('ticket_audit_logs').where({ event_type: TICKET_ACTIVITY_EVENT.CREATED_FROM_TEMPLATE })).toHaveLength(0);

      const list = await attempt(() => templateActions.listTicketTemplatesForCreate());
      expect(refusalMessage(list)).toMatch(/permission denied|cannot/i);

      // The same user can still create an ordinary ticket.
      const plain = await createdTicket(await ticketActions.addTicket(ticketForm(null)));
      expect(plain.created_from_template_id ?? null).toBeNull();
    });

    it('refuses a client-portal user everywhere', async () => {
      const templateId = await insertTemplate();
      actAs(clientPortalUser);
      const before = await countTickets();
      for (const fn of [
        () => ticketActions.getTicketTemplateDraftFromTicket(sourceTicketId),
        () => templateActions.listTicketTemplates(),
        () => templateActions.getTicketTemplate(templateId),
        () => templateActions.listTicketTemplatesForCreate(),
        () => templateActions.getTicketTemplateForCreate(templateId),
        () => templateActions.createTicketTemplate({ name: 'x', title: 'x' } as any),
        () => ticketActions.addTicket(ticketForm(templateId)),
      ]) {
        const outcome = await attempt(fn);
        expect(refusalMessage(outcome)).toMatch(/permission denied|not available|cannot/i);
      }
      expect(await countTickets()).toBe(before);
    });

    it('Duplicate is unchanged: a Technician (ticket:create) can still duplicate', async () => {
      actAs(technician);
      const form = ticketForm(null, { duplicate_of_ticket_id: sourceTicketId });
      const copy = await createdTicket(await ticketActions.addTicket(form));
      expect(copy.duplicated_from_ticket_id).toBe(sourceTicketId);
      expect(copy.created_from_template_id ?? null).toBeNull();
    });
  });

  // ----------------------------------------------------------------- item 11
  describe('request validation', () => {
    it('rejects a request naming both a duplicate source and a template, writing nothing', async () => {
      const templateId = await insertTemplate();
      const before = await countTickets();
      const add = await attempt(() =>
        ticketActions.addTicket(ticketForm(templateId, { duplicate_of_ticket_id: sourceTicketId }))
      );
      expect(refusalMessage(add)).toMatch(/template and a duplicate at once/i);
      expect(await countTickets()).toBe(before);
    });

    it('reports "Ticket template not found" for inactive, scheduled-only, missing, malformed and other-tenant templates', async () => {
      const inactive = await insertTemplate({ isActive: false });
      const otherTenant = uuidv4();
      const otherTemplate = uuidv4();
      await tenantDb(context.db, otherTenant).table('tenants').insert({
        tenant: otherTenant, client_name: 'Other Tenant', email: `other-${otherTenant.slice(0, 6)}@example.com`,
      });
      await tenantDb(context.db, otherTenant).table('ticket_templates').insert({
        tenant: otherTenant, template_id: otherTemplate, name: 'Foreign', title: 'Foreign',
      });

      // R5: a template kept for schedules only (offer_for_manual_use = false) is not offered for manual create either.
      const scheduledOnly = await insertTemplate({ offerForManualUse: false });

      for (const id of [inactive, scheduledOnly, uuidv4(), 'not-a-uuid', otherTemplate]) {
        const before = await countTickets();
        const add = await attempt(() => ticketActions.addTicket(ticketForm(id)));
        expect(refusalMessage(add)).toMatch(/ticket template not found/i);
        expect(await countTickets()).toBe(before);
      }
    });
  });

  // ----------------------------------------------------------------- item 12
  describe('reference validation', () => {
    it('reports a deleted board from getTicketTemplate and nulls it in getTicketTemplateForCreate', async () => {
      const goneBoard = uuidv4();
      await tt('boards').insert({ tenant: tenantId, board_id: goneBoard, board_name: 'Soon gone' });
      const templateId = await insertTemplate({ boardId: goneBoard });
      // The category belongs to the original board, so only the board is the dangling reference.
      await tt('boards').where({ board_id: goneBoard }).delete();

      const loaded: any = await templateActions.getTicketTemplate(templateId);
      expect(loaded.referenceProblems.map((p: any) => p.field)).toContain('board_id');

      const forCreate: any = await templateActions.getTicketTemplateForCreate(templateId);
      expect(forCreate.board_id).toBeNull();
      expect(forCreate.category_id ?? null).toBeNull(); // dependants are dropped with the board
      expect(forCreate.warnings?.length ?? 0).toBeGreaterThan(0);
    });

    it('createTicketTemplate rejects a board from another tenant', async () => {
      const result = await attempt(() =>
        templateActions.createTicketTemplate({ name: 'Bad', title: 'Bad', board_id: uuidv4() } as any)
      );
      expect(refusalMessage(result)).toBeTruthy();
      expect(await tt('ticket_templates').where({ name: 'Bad' })).toHaveLength(0);
    });
  });

  // ----------------------------------------------------------------- item 13
  describe('migrations and permission grants', () => {
    const tableExists = async (name: string) =>
      (await context.db.raw(`SELECT to_regclass(?) AS t`, [`public.${name}`])).rows[0].t !== null;
    const columnRows = async () =>
      (await context.db.raw(
        `SELECT data_type, is_nullable FROM information_schema.columns WHERE table_name = 'tickets' AND column_name = 'created_from_template_id'`
      )).rows;

    it('creates the tables, the nullable uuid column (no FK, no index) and the unique active-name index', async () => {
      expect(await tableExists('ticket_templates')).toBe(true);
      expect(await tableExists('ticket_template_checklist_items')).toBe(true);
      expect(await columnRows()).toEqual([{ data_type: 'uuid', is_nullable: 'YES' }]);

      const fks = await context.db.raw(
        `SELECT c.conname FROM pg_constraint c
           JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
          WHERE c.conrelid = 'tickets'::regclass AND c.contype = 'f' AND a.attname = 'created_from_template_id'`
      );
      expect(fks.rows).toEqual([]);
      const indexes = await context.db.raw(
        `SELECT indexname FROM pg_indexes WHERE tablename = 'tickets' AND indexdef ILIKE '%created_from_template_id%'`
      );
      expect(indexes.rows).toEqual([]);

      const unique = await context.db.raw(
        `SELECT indexdef FROM pg_indexes WHERE tablename = 'ticket_templates' AND indexname = 'ticket_templates_active_name_unique'`
      );
      expect(unique.rows).toHaveLength(1);
      expect(unique.rows[0].indexdef).toMatch(/tenant, lower\(name\)/i);
      expect(unique.rows[0].indexdef).toMatch(/WHERE/i);
    });

    it('deleting a template cascades its checklist items but not tickets', async () => {
      const templateId = await insertTemplate();
      const ticket = await createdTicket(await ticketActions.addTicket(ticketForm(templateId)));
      await tt('ticket_templates').where({ template_id: templateId }).delete();
      expect(await tt('ticket_template_checklist_items').where({ template_id: templateId })).toHaveLength(0);
      expect(await tt('tickets').where({ ticket_id: ticket.ticket_id })).toHaveLength(1);
    });

    it('enforces unique active names but allows a retired duplicate', async () => {
      await insertTemplate({ name: 'Same name' });
      await expect(insertTemplate({ name: 'Same name', isActive: false })).resolves.toBeTruthy();
      // last: a failed insert aborts the surrounding test transaction
      await expect(insertTemplate({ name: 'SAME NAME' })).rejects.toThrow(/ticket_templates_active_name_unique/);
    });

    it('down drops the tables and column; up restores them and is idempotent', async () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const migration = require('../../../migrations/20261013041821_create_ticket_templates.cjs');
      // Recurring definitions reference ticket_templates (migration A, ON DELETE RESTRICT), so roll that link back first.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const linkMigration = require('../../../migrations/20261017120000_add_recurring_ticket_template_link.cjs');
      await linkMigration.down(context.db);
      try {
        await migration.down(context.db);
        expect(await tableExists('ticket_templates')).toBe(false);
        expect(await tableExists('ticket_template_checklist_items')).toBe(false);
        expect(await columnRows()).toHaveLength(0);
        await expect(migration.down(context.db)).resolves.not.toThrow();
      } finally {
        await migration.up(context.db);
        await linkMigration.up(context.db);
      }
      expect(await tableExists('ticket_templates')).toBe(true);
      expect(await columnRows()).toHaveLength(1);
      await expect(migration.up(context.db)).resolves.not.toThrow();
    });

    it('the permission catalog matches D11 for PSA, AlgaDesk and co-managed', async () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { ACTIVE_PERMISSIONS: PERMISSIONS } = require('../../../migrations/utils/permissions/catalog.cjs');
      const rows = PERMISSIONS.filter((p: any) => p.resource === 'ticket_template');
      expect(rows.map((p: any) => p.action).sort()).toEqual(['create', 'delete', 'read', 'update']);
      for (const row of rows) {
        expect(row.msp).toBe(true);
        expect(row.client).toBe(false);
        expect([...row.products].sort()).toEqual(['algadesk', 'co_managed', 'psa']);
        if (row.action === 'read') {
          expect(row.defaultGrants.psa).toEqual(
            expect.arrayContaining(['msp:Admin', 'msp:Technician', 'msp:Dispatcher', 'msp:Manager', 'msp:Project Manager'])
          );
          expect(row.defaultGrants.algadesk).toEqual(expect.arrayContaining(['msp:Admin', 'msp:Agent']));
          expect(row.defaultGrants.co_managed).toEqual(
            expect.arrayContaining(['msp:Admin', 'msp:Technician', 'msp:Dispatcher', 'msp:Project Manager'])
          );
        } else {
          expect(row.defaultGrants.psa).toEqual(['msp:Admin']);
          expect(row.defaultGrants.algadesk).toEqual(['msp:Admin']);
          expect(row.defaultGrants.co_managed).toEqual(['msp:Admin']);
        }
      }
    });

    it('the seeded tenant has the four ticket_template permissions, and Admin holds all of them', async () => {
      const perms = await tt('permissions').where({ resource: 'ticket_template', msp: true }).select('permission_id', 'action');
      expect(perms.map((p: any) => p.action).sort()).toEqual(['create', 'delete', 'read', 'update']);

      const adminRole = await tt('roles').where({ role_name: 'Admin', msp: true }).first();
      if (adminRole) {
        const granted = await tt('role_permissions')
          .where({ role_id: adminRole.role_id })
          .whereIn('permission_id', perms.map((p: any) => p.permission_id));
        expect(granted).toHaveLength(4);
      }
      const techRole = await tt('roles').where({ role_name: 'Technician', msp: true }).first();
      if (techRole) {
        const readId = perms.find((p: any) => p.action === 'read').permission_id;
        const granted = await tt('role_permissions').where({ role_id: techRole.role_id }).whereIn('permission_id', perms.map((p: any) => p.permission_id));
        expect(granted.map((g: any) => g.permission_id)).toEqual([readId]);
      }
    });
  });
});
