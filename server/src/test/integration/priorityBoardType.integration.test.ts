/**
 * Integration tests for card d4555320: a ticket priority's family (ITIL or custom) must match its board's priority_type.
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
import { findTicketFieldReferenceProblems, findPriorityBoardTypeProblem, findTicketUpdatePriorityBoardTypeProblem } from '@alga-psa/tickets/lib/ticketFieldReferences';
import * as optimizedActions from '@alga-psa/tickets/actions/optimizedTicketActions';
import { TicketService } from '@/lib/api/services/TicketService';
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

/** The refusal must be RETURNED as `{ actionError }` (a thrown Error is redacted in production Next.js). */
function expectReturnedActionError(outcome: Outcome, message: string, params: { priority: string; board: string }, key: string) {
  expect(outcome.threw).toBeNull();
  expect(outcome.value).toMatchObject({ actionError: expect.stringContaining(message), messageKey: key, messageParams: params });
}

const json = (value: unknown) => (typeof value === 'string' ? JSON.parse(value) : value);

describe('Priority type vs board priority_type (integration)', () => {
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

  // ---------------------------------------------------------------- fixtures
  let itilBoardId: string;
  let itilStatusId: string;
  let itilPriorityId: string;
  let customPriorityName: string;

  async function seedItilSide() {
    itilBoardId = uuidv4();
    await tt('boards').insert({ tenant: tenantId, board_id: itilBoardId, board_name: 'Service Desk', priority_type: 'itil' });
    itilStatusId = uuidv4();
    await tt('statuses').insert({ tenant: tenantId, status_id: itilStatusId, name: 'ITIL Open', board_id: itilBoardId, status_type: 'ticket', is_closed: false, is_default: true, order_number: 9002 });
    // The seeds may already carry both families; use explicit rows of each so the fixtures never depend on order.
    const itilRow = await tt('priorities').where({ item_type: 'ticket', is_from_itil_standard: true, priority_name: 'P2 - High' }).first();
    if (itilRow) {
      itilPriorityId = itilRow.priority_id;
    } else {
      itilPriorityId = uuidv4();
      await tt('priorities').insert({ tenant: tenantId, priority_id: itilPriorityId, priority_name: 'P2 - High', item_type: 'ticket', order_number: 9100, color: '#f00', is_from_itil_standard: true, itil_priority_level: 2, created_by: ownerUser });
    }
    let customRow = await tt('priorities').where({ item_type: 'ticket' }).andWhere((q: any) => q.where({ is_from_itil_standard: false }).orWhereNull('is_from_itil_standard')).first();
    if (!customRow) {
      const id = uuidv4();
      await tt('priorities').insert({ tenant: tenantId, priority_id: id, priority_name: 'PBT Custom', item_type: 'ticket', order_number: 9099, color: '#0a0', created_by: ownerUser });
      customRow = await tt('priorities').where({ priority_id: id }).first();
    }
    priorityId = customRow.priority_id;
    await tt('tickets').where({ ticket_id: sourceTicketId }).update({ priority_id: priorityId });
    customPriorityName = (await tt('priorities').where({ priority_id: priorityId }).first()).priority_name;
  }

  const mismatchOf = (problems: Array<{ field: string; message: string }>) =>
    problems.filter((problem) => problem.field === 'priority_id').map((problem) => problem.message);

  const templateInput = (overrides: Record<string, unknown>) => ({
    name: `PBT ${uuidv4().slice(0, 6)}`,
    notes: null,
    title: 'Priority type check',
    description: null,
    board_id: boardId,
    category_id: null,
    subcategory_id: null,
    priority_id: priorityId,
    itil_impact: null,
    itil_urgency: null,
    tags: [],
    custom_fields: {},
    checklist: [],
    ...overrides,
  });

  // ------------------------------------------------------------- validator
  describe('findTicketFieldReferenceProblems / findPriorityBoardTypeProblem', () => {
    const fields = (board_id: string, priority_id: string) => ({
      board_id, priority_id, category_id: null, subcategory_id: null,
    });

    it('rejects an ITIL priority on a custom board, naming both sides', async () => {
      await seedItilSide();
      const problems = await findTicketFieldReferenceProblems(context.db, tenantId, { fields: fields(boardId, itilPriorityId) });
      expect(mismatchOf(problems)).toEqual(["Priority ‘P2 - High’ is an ITIL priority but board ‘Tpl Board’ uses custom priorities"]);
      expect((await findPriorityBoardTypeProblem(context.db, tenantId, boardId, itilPriorityId))?.message).toBe(mismatchOf(problems)[0]);
    });

    it('rejects a custom priority on an ITIL board, and appends "edit the schedule" for schedules', async () => {
      await seedItilSide();
      const expected = `Priority ‘${customPriorityName}’ is a custom priority but board ‘Service Desk’ uses ITIL priorities`;
      const problems = await findTicketFieldReferenceProblems(context.db, tenantId, { fields: fields(itilBoardId, priorityId) });
      expect(mismatchOf(problems)).toEqual([expected]);
      const schedule = await findTicketFieldReferenceProblems(context.db, tenantId, { fields: fields(itilBoardId, priorityId), schedule: true });
      expect(mismatchOf(schedule)).toEqual([`${expected}; edit the schedule`]);
    });

    it('accepts both matching pairs', async () => {
      await seedItilSide();
      expect(mismatchOf(await findTicketFieldReferenceProblems(context.db, tenantId, { fields: fields(boardId, priorityId) }))).toEqual([]);
      expect(mismatchOf(await findTicketFieldReferenceProblems(context.db, tenantId, { fields: fields(itilBoardId, itilPriorityId) }))).toEqual([]);
      expect(await findPriorityBoardTypeProblem(context.db, tenantId, itilBoardId, itilPriorityId)).toBeNull();
    });

    it('treats a null priority_type (and a null is_from_itil_standard) as custom', async () => {
      await seedItilSide();
      await tt('boards').where({ board_id: boardId }).update({ priority_type: null });
      await tt('priorities').where({ priority_id: priorityId }).update({ is_from_itil_standard: null });
      expect(await findPriorityBoardTypeProblem(context.db, tenantId, boardId, priorityId)).toBeNull();
      expect((await findPriorityBoardTypeProblem(context.db, tenantId, boardId, itilPriorityId))?.message).toMatch(/is an ITIL priority but board ‘Tpl Board’ uses custom/);
    });

    it('adds nothing when the board is missing (the board problem already speaks)', async () => {
      await seedItilSide();
      const problems = await findTicketFieldReferenceProblems(context.db, tenantId, { fields: fields(uuidv4(), itilPriorityId) });
      expect(problems.map((p) => p.field)).toEqual(['board_id']);
    });
  });

  // -------------------------------------------------------------- templates
  describe('ticket template save', () => {
    it('refuses create and update with a mismatched pair, and keeps the stored row untouched', async () => {
      await seedItilSide();
      const create = await attempt(() => templateActions.createTicketTemplate(templateInput({ priority_id: itilPriorityId }) as any));
      expect(refusalMessage(create)).toContain("Priority ‘P2 - High’ is an ITIL priority but board ‘Tpl Board’ uses custom priorities");
      // The refusal carries the specific problem as the interpolation param of the generic key.
      expect(create.value).toMatchObject({
        messageKey: 'features/tickets:templates.errors.invalidReferences',
        messageParams: { problems: expect.stringContaining('is an ITIL priority but board ‘Tpl Board’ uses custom priorities') },
      });

      const templateId = await insertTemplate();
      const update = await attempt(() => templateActions.updateTicketTemplate(templateId, templateInput({ board_id: itilBoardId, category_id: null, subcategory_id: null }) as any));
      expect(refusalMessage(update)).toContain(`Priority ‘${customPriorityName}’ is a custom priority but board ‘Service Desk’ uses ITIL priorities`);
      expect((await tt('ticket_templates').where({ template_id: templateId }).first()).board_id).toBe(boardId);

      const ok = await attempt(() => templateActions.updateTicketTemplate(templateId, templateInput({ board_id: itilBoardId, priority_id: itilPriorityId }) as any));
      expect(ok.threw).toBeNull();
      expect(refusalMessage(ok)).toBe('');
    });
  });

  // ---------------------------------------------------------- manual tickets
  describe('manual ticket create / update', () => {
    it('addTicket refuses a mismatched pair and creates nothing', async () => {
      await seedItilSide();
      const before = await countTickets();
      const outcome = await attempt(() => ticketActions.addTicket(ticketForm(null, { priority_id: itilPriorityId, category_id: '', subcategory_id: '' })));
      expectReturnedActionError(
        outcome,
        'is an ITIL priority but board ‘Tpl Board’ uses custom priorities',
        { priority: 'P2 - High', board: 'Tpl Board' },
        'features/tickets:errors.ticket.priorityItilBoardCustom'
      );
      expect(await countTickets()).toBe(before);

      const ok = await attempt(() => ticketActions.addTicket(ticketForm(null, { board_id: itilBoardId, status_id: itilStatusId, priority_id: itilPriorityId, category_id: '', subcategory_id: '' })));
      expect(refusalMessage(ok)).toBe('');
      expect(await countTickets()).toBe(before + 1);
    });

    it('updateTicket: an unrelated patch on a legacy mismatched ticket still succeeds; touching priority or board is checked', async () => {
      await seedItilSide();
      // Legacy data: an ITIL priority on a custom board.
      await tt('tickets').where({ ticket_id: sourceTicketId }).update({ priority_id: itilPriorityId });

      const unrelated = await attempt(() => ticketActions.updateTicket(sourceTicketId, { title: 'Renamed on legacy data' }));
      expect(refusalMessage(unrelated)).toBe('');
      expect(unrelated.value).toBe('success');
      expect((await tt('tickets').where({ ticket_id: sourceTicketId }).first()).title).toBe('Renamed on legacy data');

      // Re-sending the stored pair is not a change.
      const resend = await attempt(() => ticketActions.updateTicket(sourceTicketId, { priority_id: itilPriorityId, board_id: boardId }));
      expect(resend.value).toBe('success');

      // Changing the priority to another ITIL one on the custom board is refused...
      const otherItil = uuidv4();
      await tt('priorities').insert({ tenant: tenantId, priority_id: otherItil, priority_name: `P3 - PBT ${otherItil.slice(0, 4)}`, item_type: 'ticket', order_number: 9101, color: '#ff0', is_from_itil_standard: true, itil_priority_level: 3, created_by: ownerUser });
      const toOtherItil = await attempt(() => ticketActions.updateTicket(sourceTicketId, { priority_id: otherItil }));
      expectReturnedActionError(
        toOtherItil,
        'P3 - PBT',
        { priority: expect.stringContaining('P3 - PBT') as any, board: 'Tpl Board' },
        'features/tickets:errors.ticket.priorityItilBoardCustom'
      );

      // ...a matching custom priority repairs it...
      const repair = await attempt(() => ticketActions.updateTicket(sourceTicketId, { priority_id: priorityId }));
      expect(repair.value).toBe('success');

      // ...and moving the (now custom) ticket to the ITIL board with its status is refused on the board side.
      const move = await attempt(() => ticketActions.updateTicket(sourceTicketId, { board_id: itilBoardId, status_id: itilStatusId }));
      expectReturnedActionError(
        move,
        `Priority ‘${customPriorityName}’ is a custom priority but board ‘Service Desk’ uses ITIL priorities`,
        { priority: customPriorityName, board: 'Service Desk' },
        'features/tickets:errors.ticket.priorityCustomBoardItil'
      );
    });

    it('cross-family board move: a patch that clears the priority passes, one that keeps it is refused', async () => {
      await seedItilSide();
      // Ticket on the ITIL board with an ITIL priority.
      await tt('tickets').where({ ticket_id: sourceTicketId }).update({ board_id: itilBoardId, status_id: itilStatusId, priority_id: itilPriorityId });
      const current = await tt('tickets').where({ ticket_id: sourceTicketId }).first();

      const check = (patch: any) => findTicketUpdatePriorityBoardTypeProblem(context.db, tenantId, current, patch);
      expect(await check({ board_id: boardId, priority_id: null })).toBeNull();
      expect(await check({ board_id: boardId, priority_id: undefined })).not.toBeNull();
      expect(await check({ board_id: boardId })).not.toBeNull();
      expect(await check({ board_id: boardId, priority_id: priorityId })).toBeNull();
      // Unchanged resend of the stored pair, and an unrelated patch.
      expect(await check({ board_id: itilBoardId, priority_id: itilPriorityId })).toBeNull();
      expect(await check({})).toBeNull();
    });

    it('updateTicket / TicketService.update accept {board_id, status_id, priority_id: null} across families', async () => {
      await seedItilSide();
      const reset = () => tt('tickets').where({ ticket_id: sourceTicketId }).update({ board_id: itilBoardId, status_id: itilStatusId, priority_id: itilPriorityId });

      await reset();
      const refused = await attempt(() => ticketActions.updateTicket(sourceTicketId, { board_id: boardId, status_id: statusId }));
      expectReturnedActionError(
        refused,
        'is an ITIL priority but board ‘Tpl Board’ uses custom priorities',
        { priority: 'P2 - High', board: 'Tpl Board' },
        'features/tickets:errors.ticket.priorityItilBoardCustom'
      );

      const moved = await attempt(() => ticketActions.updateTicket(sourceTicketId, { board_id: boardId, status_id: statusId, priority_id: null }));
      expect(refusalMessage(moved)).toBe('');
      expect(moved.value).toBe('success');
      const row = await tt('tickets').where({ ticket_id: sourceTicketId }).first();
      expect(row.board_id).toBe(boardId);
      expect(row.priority_id).toBeNull();

      await reset();
      const cached = await attempt(() => optimizedActions.updateTicketWithCache(sourceTicketId, { board_id: boardId, status_id: statusId, priority_id: null }));
      expect(refusalMessage(cached)).toBe('');
      expect((await tt('tickets').where({ ticket_id: sourceTicketId }).first()).board_id).toBe(boardId);

      // REST: nulls are not stripped by cleanedData (only undefined is), so the check sees the clear.
      // The REST update schema does not accept a null priority_id, so the service is called directly.
      await reset();
      const service = new TicketService();
      vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: context.db });
      const serviceContext = { userId: ownerUser, tenant: tenantId, user: { user_id: ownerUser, user_type: 'internal' as const, tenant: tenantId } };
      const error: any = await service.update(sourceTicketId, { board_id: boardId, status_id: statusId, priority_id: null } as any, serviceContext as any).then(() => null, (e) => e);
      expect(error?.name, JSON.stringify(error?.details)).not.toBe('ValidationError');
      expect((await tt('tickets').where({ ticket_id: sourceTicketId }).first()).priority_id).toBeNull();
    });

    it('updateTicketWithCache (ticket detail save path) returns the refusal as an actionError', async () => {
      await seedItilSide();
      const outcome = await attempt(() => optimizedActions.updateTicketWithCache(sourceTicketId, { priority_id: itilPriorityId }));
      expectReturnedActionError(
        outcome,
        `Priority ‘${'P2 - High'}’ is an ITIL priority but board ‘Tpl Board’ uses custom priorities`,
        { priority: 'P2 - High', board: 'Tpl Board' },
        'features/tickets:errors.ticket.priorityItilBoardCustom'
      );
      expect((await tt('tickets').where({ ticket_id: sourceTicketId }).first()).priority_id).toBe(priorityId);
    });

    it('REST TicketService.update refuses with a ValidationError on priority_id', async () => {
      await seedItilSide();
      const service = new TicketService();
      vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: context.db });
      const serviceContext = { userId: ownerUser, tenant: tenantId, user: { user_id: ownerUser, user_type: 'internal' as const, tenant: tenantId } };
      const error: any = await service.update(sourceTicketId, { priority_id: itilPriorityId } as any, serviceContext as any).then(() => null, (e) => e);
      expect(error?.name).toBe('ValidationError');
      expect(JSON.stringify(error.details)).toContain('priority_id');
      expect(JSON.stringify(error.details)).toContain('is an ITIL priority but board ‘Tpl Board’ uses custom priorities');
    });
  });
});
