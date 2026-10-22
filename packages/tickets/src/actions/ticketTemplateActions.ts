'use server'

import type { Knex } from 'knex';
import { findTicketFieldReferenceProblems } from '../lib/ticketFieldReferences';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { hasPermission, withAuth } from '@alga-psa/auth';
import TagDefinition from '@alga-psa/tags/models/tagDefinition';
import type {
  ITicketTemplate,
  ITicketTemplateChecklistItem,
  TicketTemplateForCreate,
  TicketTemplateListItem,
  TicketTemplateOption,
  TicketTemplateUsage,
  TicketTemplateReferenceProblem,
} from '@alga-psa/types';
import { countDuplicableCustomFields, pickDuplicableAttributes } from '../lib/ticketDuplicate';
import {
  ticketTemplateInputSchema,
  type ParsedTicketTemplateInput,
  type TicketTemplateInput,
} from '../lib/ticketTemplates';
import { asJsonColumn } from '../lib/recurring/jsonColumn';
import {
  isDuplicateTemplateNameViolation,
  ticketTemplateActionErrorFrom,
  TicketTemplateError,
  type TicketTemplateActionError,
} from './ticketTemplateActionErrors';

const TEMPLATES = 'ticket_templates';
const ITEMS = 'ticket_template_checklist_items';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Action = 'read' | 'create' | 'update' | 'delete';
type AuthUser = Parameters<typeof hasPermission>[0];

function requireInternal(user: { user_type?: string }): void {
  if (user.user_type !== 'internal') {
    throw new Error('Permission denied: operation not available in client portal');
  }
}

async function requirePermission(user: AuthUser, resource: 'ticket_template' | 'ticket', action: Action, trx: Knex.Transaction) {
  if (!(await hasPermission(user, resource, action, trx))) {
    throw new Error(
      resource === 'ticket_template'
        ? `Permission denied: Cannot ${action} ticket templates`
        : `Permission denied: Cannot ${action} tickets`
    );
  }
}

function toIso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

async function loadTemplateRow(trx: Knex.Transaction, tenant: string, templateId: string, opts: { activeOnly?: boolean; manualUseOnly?: boolean } = {}) {
  const row = UUID_PATTERN.test(templateId)
    ? await tenantDb(trx, tenant)
        .table(TEMPLATES)
        .where({ template_id: templateId, ...(opts.activeOnly || opts.manualUseOnly ? { is_active: true } : {}), ...(opts.manualUseOnly ? { offer_for_manual_use: true } : {}) })
        .first()
    : undefined;
  if (!row) throw new TicketTemplateError('Ticket template not found', 'TEMPLATE_NOT_FOUND');
  return row;
}

async function loadItemRows(trx: Knex.Transaction, tenant: string, templateId: string) {
  return tenantDb(trx, tenant)
    .table(ITEMS)
    .where({ template_id: templateId })
    .orderBy('order_number', 'asc')
    .orderBy('created_at', 'asc')
    .select('template_item_id', 'item_name', 'description', 'is_required', 'order_number', 'checklist_template_id');
}

function toTemplate(row: Record<string, any>, items: Record<string, any>[]): ITicketTemplate {
  return {
    tenant: row.tenant,
    template_id: row.template_id,
    name: row.name,
    notes: row.notes ?? null,
    title: row.title,
    description: row.description ?? null,
    board_id: row.board_id ?? null,
    category_id: row.category_id ?? null,
    subcategory_id: row.subcategory_id ?? null,
    priority_id: row.priority_id ?? null,
    itil_impact: row.itil_impact ?? null,
    itil_urgency: row.itil_urgency ?? null,
    tags: asJsonColumn<string[]>(row.tags ?? []),
    custom_fields: asJsonColumn<Record<string, unknown>>(row.custom_fields ?? {}),
    is_active: row.is_active,
    offer_for_manual_use: row.offer_for_manual_use,
    source_ticket_id: row.source_ticket_id ?? null,
    created_by: row.created_by ?? null,
    updated_by: row.updated_by ?? null,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
    checklist: items.map(
      (item): ITicketTemplateChecklistItem => ({
        template_item_id: item.template_item_id,
        item_name: item.item_name,
        description: item.description ?? null,
        is_required: item.is_required,
        order_number: item.order_number,
        checklist_template_id: item.checklist_template_id ?? null,
      })
    ),
  };
}

/** Custom fields go through the same allowlist as Duplicate (D7). */
function allowlistedCustomFields(fields: Record<string, unknown>): Record<string, unknown> {
  return (pickDuplicableAttributes({ custom_fields: fields }).custom_fields as Record<string, unknown> | undefined) ?? {};
}

async function assertValidReferences(trx: Knex.Transaction, tenant: string, input: ParsedTicketTemplateInput) {
  const problems = await findTicketFieldReferenceProblems(trx, tenant, { fields: input });
  if (problems.length > 0) {
    throw new TicketTemplateError(
      problems.map((problem) => problem.message).join('. '),
      'INVALID_REFERENCES'
    );
  }
}

/** Per template: non-archived schedules using it and tickets created from it. */
async function loadTemplateUsage(
  trx: Knex.Transaction,
  tenant: string,
  templateIds: string[]
): Promise<Map<string, TicketTemplateUsage>> {
  const db = tenantDb(trx, tenant);
  const schedules = await db
    .table('recurring_ticket_definitions')
    .whereIn('ticket_template_id', templateIds)
    .whereNull('archived_at')
    .groupBy('ticket_template_id')
    .select('ticket_template_id')
    .count('* as total');
  const tickets = await db
    .table('tickets')
    .whereIn('created_from_template_id', templateIds)
    .groupBy('created_from_template_id')
    .select('created_from_template_id')
    .count('* as total');
  const usage = new Map<string, TicketTemplateUsage>(templateIds.map((id) => [id, { schedule_count: 0, ticket_count: 0 }]));
  for (const row of schedules) usage.get(row.ticket_template_id as string)!.schedule_count = Number(row.total);
  for (const row of tickets) usage.get(row.created_from_template_id as string)!.ticket_count = Number(row.total);
  return usage;
}

/** Non-archived schedules (active or paused) that use the template: what blocks its deletion (R3). */
async function listBlockingSchedules(trx: Knex.Transaction, tenant: string, templateId: string) {
  return tenantDb(trx, tenant)
    .table('recurring_ticket_definitions')
    .where({ ticket_template_id: templateId })
    .whereNull('archived_at')
    .orderBy('name', 'asc')
    .select('definition_id', 'name', 'is_active', 'status_id');
}

function duplicateNameError(name: string): TicketTemplateError {
  return new TicketTemplateError(`A template named ${name} already exists`, 'DUPLICATE_NAME', { name });
}

async function insertItems(
  trx: Knex.Transaction,
  tenant: string,
  templateId: string,
  checklist: ParsedTicketTemplateInput['checklist']
) {
  if (checklist.length === 0) return;
  await tenantDb(trx, tenant)
    .table(ITEMS)
    .insert(
      checklist.map((item, index) => ({
        tenant,
        template_id: templateId,
        item_name: item.item_name,
        description: item.description ?? null,
        is_required: item.is_required,
        order_number: index,
        checklist_template_id: item.checklist_template_id ?? null,
      }))
    );
}

function templateColumns(input: ParsedTicketTemplateInput) {
  return {
    name: input.name,
    notes: input.notes,
    title: input.title,
    description: input.description,
    board_id: input.board_id,
    category_id: input.category_id,
    subcategory_id: input.subcategory_id,
    priority_id: input.priority_id,
    itil_impact: input.itil_impact,
    itil_urgency: input.itil_urgency,
    tags: JSON.stringify(input.tags),
    custom_fields: JSON.stringify(allowlistedCustomFields(input.custom_fields)),
    // Unset on update leaves the stored value alone; a new template is offered unless said otherwise.
    ...(input.offer_for_manual_use === undefined ? {} : { offer_for_manual_use: input.offer_for_manual_use }),
  };
}

async function failed(error: unknown, label: string): Promise<TicketTemplateActionError> {
  const expected = ticketTemplateActionErrorFrom(error);
  if (expected) return expected;
  console.error(`Error in ${label}:`, error);
  throw error;
}

export const listTicketTemplates = withAuth(async (
  user,
  { tenant },
  options: { includeInactive?: boolean } = {}
): Promise<TicketTemplateListItem[] | TicketTemplateActionError> => {
  try {
    requireInternal(user);
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx) => {
      await requirePermission(user, 'ticket_template', 'read', trx);
      const db = tenantDb(trx, tenant);

      const query = db.table(`${TEMPLATES} as t`);
      db.tenantJoin(query, 'boards as b', 't.board_id', 'b.board_id', { type: 'left' });
      if (!options.includeInactive) query.where('t.is_active', true);
      const rows = await query.orderBy('t.name', 'asc').select('t.*', 'b.board_name');
      if (rows.length === 0) return [];

      const counts = await db
        .table(ITEMS)
        .whereIn('template_id', rows.map((row) => row.template_id as string))
        .groupBy('template_id')
        .select('template_id')
        .count('* as total');
      const countById = new Map(counts.map((row) => [row.template_id as string, Number(row.total)]));
      const usageById = await loadTemplateUsage(trx, tenant, rows.map((row) => row.template_id as string));

      return rows.map((row): TicketTemplateListItem => ({
        template_id: row.template_id,
        name: row.name,
        title: row.title,
        board_id: row.board_id ?? null,
        board_name: row.board_name ?? null,
        checklist_count: countById.get(row.template_id) ?? 0,
        tag_count: asJsonColumn<string[]>(row.tags ?? []).length,
        is_active: row.is_active,
        offer_for_manual_use: row.offer_for_manual_use,
        schedule_count: usageById.get(row.template_id)?.schedule_count ?? 0,
        ticket_count: usageById.get(row.template_id)?.ticket_count ?? 0,
        updated_at: toIso(row.updated_at),
      }));
    });
  } catch (error) {
    return failed(error, 'listTicketTemplates');
  }
});

export const getTicketTemplate = withAuth(async (
  user,
  { tenant },
  templateId: string
): Promise<(ITicketTemplate & TicketTemplateUsage & { referenceProblems: TicketTemplateReferenceProblem[] }) | TicketTemplateActionError> => {
  try {
    requireInternal(user);
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx) => {
      await requirePermission(user, 'ticket_template', 'read', trx);
      const row = await loadTemplateRow(trx, tenant, templateId);
      const items = await loadItemRows(trx, tenant, row.template_id);
      const template = toTemplate(row, items);
      const referenceProblems = await findTicketFieldReferenceProblems(trx, tenant, { fields: template });
      const usage = (await loadTemplateUsage(trx, tenant, [template.template_id])).get(template.template_id)!;
      return { ...template, referenceProblems, ...usage };
    });
  } catch (error) {
    return failed(error, 'getTicketTemplate');
  }
});

export const createTicketTemplate = withAuth(async (
  user,
  { tenant },
  input: TicketTemplateInput,
  sourceTicketId?: string | null
): Promise<{ template_id: string } | TicketTemplateActionError> => {
  try {
    requireInternal(user);
    const parsed = ticketTemplateInputSchema.parse(input);
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx) => {
      await requirePermission(user, 'ticket_template', 'create', trx);
      await assertValidReferences(trx, tenant, parsed);
      try {
        const [row] = await tenantDb(trx, tenant)
          .table(TEMPLATES)
          .insert({
            tenant,
            ...templateColumns(parsed),
            is_active: true,
            source_ticket_id: sourceTicketId && UUID_PATTERN.test(sourceTicketId) ? sourceTicketId : null,
            created_by: user.user_id,
            updated_by: user.user_id,
          })
          .returning('template_id');
        await insertItems(trx, tenant, row.template_id, parsed.checklist);
        return { template_id: row.template_id as string };
      } catch (error) {
        if (isDuplicateTemplateNameViolation(error)) throw duplicateNameError(parsed.name);
        throw error;
      }
    });
  } catch (error) {
    return failed(error, 'createTicketTemplate');
  }
});

export const updateTicketTemplate = withAuth(async (
  user,
  { tenant },
  templateId: string,
  input: TicketTemplateInput
): Promise<{ template_id: string } | TicketTemplateActionError> => {
  try {
    requireInternal(user);
    const parsed = ticketTemplateInputSchema.parse(input);
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx) => {
      await requirePermission(user, 'ticket_template', 'update', trx);
      const existing = await loadTemplateRow(trx, tenant, templateId);
      await assertValidReferences(trx, tenant, parsed);
      try {
        await tenantDb(trx, tenant)
          .table(TEMPLATES)
          .where({ template_id: existing.template_id })
          .update({ ...templateColumns(parsed), updated_by: user.user_id, updated_at: trx.fn.now() });
        // Item ids are never referenced elsewhere, so the checklist is replaced wholesale.
        await tenantDb(trx, tenant).table(ITEMS).where({ template_id: existing.template_id }).delete();
        await insertItems(trx, tenant, existing.template_id, parsed.checklist);
        return { template_id: existing.template_id as string };
      } catch (error) {
        if (isDuplicateTemplateNameViolation(error)) throw duplicateNameError(parsed.name);
        throw error;
      }
    });
  } catch (error) {
    return failed(error, 'updateTicketTemplate');
  }
});

export const setTicketTemplateActive = withAuth(async (
  user,
  { tenant },
  templateId: string,
  isActive: boolean
): Promise<{ template_id: string } | TicketTemplateActionError> => {
  try {
    requireInternal(user);
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx) => {
      await requirePermission(user, 'ticket_template', 'update', trx);
      const existing = await loadTemplateRow(trx, tenant, templateId);
      try {
        await tenantDb(trx, tenant)
          .table(TEMPLATES)
          .where({ template_id: existing.template_id })
          .update({ is_active: isActive, updated_by: user.user_id, updated_at: trx.fn.now() });
      } catch (error) {
        if (isDuplicateTemplateNameViolation(error)) throw duplicateNameError(existing.name);
        throw error;
      }
      return { template_id: existing.template_id as string };
    });
  } catch (error) {
    return failed(error, 'setTicketTemplateActive');
  }
});

export const deleteTicketTemplate = withAuth(async (
  user,
  { tenant },
  templateId: string
): Promise<{ template_id: string } | TicketTemplateActionError> => {
  try {
    requireInternal(user);
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx) => {
      await requirePermission(user, 'ticket_template', 'delete', trx);
      const existing = await loadTemplateRow(trx, tenant, templateId);
      // R3: refused while any non-archived schedule (active or paused) uses the template. The tenant-composite
      // FK (ON DELETE RESTRICT) enforces the same rule for any other writer; this gives the actionable message.
      const blocking = await listBlockingSchedules(trx, tenant, existing.template_id);
      if (blocking.length > 0) {
        throw new TicketTemplateError(
          `Used by ${blocking.length} recurring schedule${blocking.length === 1 ? '' : 's'}: ${blocking.map((row) => row.name).join(', ')}. Point them at another template or archive them first.`,
          'IN_USE_BY_SCHEDULES',
          { count: blocking.length, schedules: blocking.map((row) => row.name).join(', ') }
        );
      }
      // Hard delete. Tickets keep created_from_template_id (no FK) and the activity-row name snapshot.
      await tenantDb(trx, tenant).table(ITEMS).where({ template_id: existing.template_id }).delete();
      await tenantDb(trx, tenant).table(TEMPLATES).where({ template_id: existing.template_id }).delete();
      return { template_id: existing.template_id as string };
    });
  } catch (error) {
    return failed(error, 'deleteTicketTemplate');
  }
});

/** Active templates for the Quick Add picker. Needs `ticket:create` as well as template read. */
export const listTicketTemplatesForCreate = withAuth(async (
  user,
  { tenant }
): Promise<TicketTemplateOption[] | TicketTemplateActionError> => {
  try {
    requireInternal(user);
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx) => {
      await requirePermission(user, 'ticket', 'create', trx);
      await requirePermission(user, 'ticket_template', 'read', trx);
      const rows = await tenantDb(trx, tenant)
        .table(TEMPLATES)
        .where({ is_active: true, offer_for_manual_use: true })
        .orderBy('name', 'asc')
        .select('template_id', 'name', 'board_id');
      return rows.map((row): TicketTemplateOption => ({
        template_id: row.template_id,
        name: row.name,
        board_id: row.board_id ?? null,
      }));
    });
  } catch (error) {
    return failed(error, 'listTicketTemplatesForCreate');
  }
});

/**
 * The form prefill for "New ticket from template". Dangling references come back null with a
 * warning (D10); tags resolve to existing ticket tag definitions by text (D8).
 */
export const getTicketTemplateForCreate = withAuth(async (
  user,
  { tenant },
  templateId: string
): Promise<TicketTemplateForCreate | TicketTemplateActionError> => {
  try {
    requireInternal(user);
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx) => {
      await requirePermission(user, 'ticket', 'create', trx);
      await requirePermission(user, 'ticket_template', 'read', trx);
      const row = await loadTemplateRow(trx, tenant, templateId, { manualUseOnly: true });
      const items = await loadItemRows(trx, tenant, row.template_id);
      const template = toTemplate(row, items);

      const problems = await findTicketFieldReferenceProblems(trx, tenant, { fields: template });
      const bad = new Set(problems.map((problem) => problem.field));
      const boardGone = bad.has('board_id');
      const categoryGone = boardGone || bad.has('category_id');
      const subcategoryGone = categoryGone || bad.has('subcategory_id');

      const definitions = template.tags.length > 0 ? await TagDefinition.getAllByType(trx, tenant, 'ticket') : [];
      const byText = new Map(definitions.map((definition) => [definition.tag_text.trim().toLowerCase(), definition]));

      return {
        template_id: template.template_id,
        name: template.name,
        title: template.title,
        description: template.description ?? '',
        board_id: boardGone ? null : template.board_id,
        category_id: categoryGone ? null : template.category_id,
        subcategory_id: subcategoryGone ? null : template.subcategory_id,
        priority_id: bad.has('priority_id') ? null : template.priority_id,
        itil_impact: template.itil_impact,
        itil_urgency: template.itil_urgency,
        tags: template.tags.map((text) => {
          const definition = byText.get(text.trim().toLowerCase());
          return {
            tag_id: definition?.tag_id ?? null,
            tag_text: definition?.tag_text ?? text,
            background_color: definition?.background_color ?? null,
            text_color: definition?.text_color ?? null,
            is_new: !definition,
          };
        }),
        checklist: template.checklist.map((item) => ({ item_name: item.item_name, is_required: item.is_required })),
        custom_field_count: countDuplicableCustomFields({ custom_fields: template.custom_fields }),
        custom_fields: allowlistedCustomFields(template.custom_fields),
        warnings: problems.map((problem) => problem.message),
      } satisfies TicketTemplateForCreate;
    });
  } catch (error) {
    return failed(error, 'getTicketTemplateForCreate');
  }
});

/** A non-archived schedule using a template. `pins_status`: it dispatches into a fixed status that belongs to one board. */
export interface TicketTemplateScheduleUse {
  definition_id: string;
  name: string;
  is_active: boolean;
  pins_status: boolean;
}

/** Non-archived schedules using a template, for the editor's "Used by" panel. */
export const listSchedulesForTemplate = withAuth(async (
  user,
  { tenant },
  templateId: string
): Promise<TicketTemplateScheduleUse[] | TicketTemplateActionError> => {
  try {
    requireInternal(user);
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx) => {
      await requirePermission(user, 'ticket_template', 'read', trx);
      const existing = await loadTemplateRow(trx, tenant, templateId);
      return (await listBlockingSchedules(trx, tenant, existing.template_id)).map((row) => ({
        definition_id: row.definition_id as string,
        name: row.name as string,
        is_active: row.is_active as boolean,
        pins_status: row.status_id !== null && row.status_id !== undefined,
      }));
    });
  } catch (error) {
    return failed(error, 'listSchedulesForTemplate');
  }
});
