'use server'

import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { Knex } from 'knex';
import { z } from 'zod';
import { predicateGroupSchema } from '@alga-psa/predicates';
import type { PredicateGroup } from '@alga-psa/predicates';
import { readChecklistWhere, checklistWhereForOwner, checklistWhereTagIds, CHECKLIST_RULE_WHERE_VERSION } from '@alga-psa/shared/lib/ticketChecklists';
import { replaceTagReferences, deleteTagReferences } from '@alga-psa/tags/lib/tagReferences';
import { TEMPLATE_CLIENT_INVALID, checklistActionErrorFrom, type ChecklistActionError } from './checklistActionErrors';

/**
 * Admin-managed checklist templates, their items, and auto-apply predicate
 * rules. Template items are COPIED onto tickets when applied — editing a
 * template never mutates checklists already on tickets.
 * See docs/plans/2026-06-10-ticket-close-rules/PRD.md §5.2.
 */

export interface IChecklistTemplateItem {
  template_item_id: string;
  template_id: string;
  item_name: string;
  description: string | null;
  order_number: number;
  is_required: boolean;
}

export interface IChecklistTemplate {
  template_id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  /** null = available to every client */
  client_id: string | null;
  client_name: string | null;
  items?: IChecklistTemplateItem[];
}

export interface IChecklistTemplateApplyRule {
  apply_rule_id: string;
  template_id: string;
  where: PredicateGroup;
  where_version: number;
  is_enabled: boolean;
}

export interface ChecklistTemplateInput {
  name: string;
  description?: string | null;
  is_active?: boolean;
  /** Optional client scope; null/undefined on create = tenant-wide. */
  client_id?: string | null;
}

export interface ChecklistTemplateItemInput {
  item_name: string;
  description?: string | null;
  is_required?: boolean;
}

export interface ChecklistTemplateApplyRuleInput {
  where: PredicateGroup;
  where_version?: number;
  is_enabled?: boolean;
}

const ruleInputSchema = z.object({
  where: predicateGroupSchema,
  where_version: z.number().default(CHECKLIST_RULE_WHERE_VERSION),
  is_enabled: z.boolean().default(true),
}).strict();

function applyRulePredicateColumns(input: ChecklistTemplateApplyRuleInput, owner: string | null) {
  const parsed = ruleInputSchema.parse(input);
  const where = checklistWhereForOwner(readChecklistWhere(parsed.where, parsed.where_version), owner);
  return { where: JSON.stringify(where), where_version: CHECKLIST_RULE_WHERE_VERSION, is_enabled: parsed.is_enabled };
}

const RULE_TAG_REFERRER = 'checklist_template_apply_rule';

async function requireSettingsPermission(user: Parameters<Parameters<typeof withAuth>[0]>[0]) {
  if (!(await hasPermission(user, 'ticket', 'update'))) {
    throw new Error('Permission denied: Cannot manage checklist templates');
  }
}

function tenantScopedTable(
  conn: Knex | Knex.Transaction,
  table: string,
  tenant: string
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

async function assertClientBelongsToTenant(
  conn: Knex | Knex.Transaction,
  tenant: string,
  clientId: string
): Promise<void> {
  const client = await tenantScopedTable(conn, 'clients', tenant).where({ client_id: clientId }).first('client_id');
  if (!client) throw new Error(TEMPLATE_CLIENT_INVALID);
}

/** Revalidate and normalize every rule when the template gains or changes its owner. */
async function narrowRuleClientsToOwner(
  trx: Knex.Transaction, tenant: string, templateId: string, owner: string
): Promise<void> {
  const rules = await tenantScopedTable(trx, 'checklist_template_apply_rules', tenant)
    .where({ template_id: templateId }).select('apply_rule_id', 'where', 'where_version');
  for (const rule of rules) {
    const where = checklistWhereForOwner(readChecklistWhere(rule.where, rule.where_version), owner);
    await tenantScopedTable(trx, 'checklist_template_apply_rules', tenant)
      .where({ apply_rule_id: rule.apply_rule_id })
      .update({ where: JSON.stringify(where), updated_at: trx.fn.now() });
    await replaceTagReferences(trx, tenant, RULE_TAG_REFERRER, rule.apply_rule_id, checklistWhereTagIds(where));
  }
}

export interface GetChecklistTemplatesOptions {
  includeInactive?: boolean;
  /**
   * Ticket-aware mode for the "apply checklist" picker: only templates with no client or the
   * ticket's client are returned. Omit for the (unfiltered) settings list.
   */
  forTicketId?: string;
  /** Settings list filter: only templates scoped to this client. */
  clientId?: string;
}

export const getChecklistTemplates = withAuth(
  async (_user, { tenant }, opts?: GetChecklistTemplatesOptions): Promise<IChecklistTemplate[]> => {
    const { knex: db } = await createTenantKnex();

    let ticketClientId: string | null | undefined;
    if (opts?.forTicketId) {
      const ticket = await tenantScopedTable(db, 'tickets', tenant)
        .where({ ticket_id: opts.forTicketId })
        .first('client_id');
      if (!ticket) throw new Error('Ticket not found');
      ticketClientId = ticket.client_id;
    }

    const templates = await tenantScopedTable(db, 'checklist_templates', tenant)
      .modify((qb) => {
        if (!opts?.includeInactive) qb.where('is_active', true);
        if (opts?.forTicketId) {
          qb.where((scope) => {
            scope.whereNull('client_id');
            if (ticketClientId) scope.orWhere('client_id', ticketClientId);
          });
        }
        if (opts?.clientId) qb.where('client_id', opts.clientId);
      })
      .orderBy('name', 'asc') as Array<IChecklistTemplate>;

    if (!templates.length) return [];

    const items = await tenantScopedTable(db, 'checklist_template_items', tenant)
      .whereIn('template_id', templates.map((t: { template_id: string }) => t.template_id))
      .orderBy('order_number', 'asc') as IChecklistTemplateItem[];

    const clientIds = Array.from(new Set(templates.map((t) => t.client_id).filter((id): id is string => Boolean(id))));
    const clientRows: { client_id: string; client_name: string }[] = clientIds.length
      ? await tenantScopedTable(db, 'clients', tenant).whereIn('client_id', clientIds).select('client_id', 'client_name')
      : [];
    const clientNames = new Map(clientRows.map((c) => [c.client_id, c.client_name]));

    return templates.map((t) => ({
      template_id: t.template_id,
      name: t.name,
      description: t.description,
      is_active: t.is_active,
      client_id: t.client_id ?? null,
      client_name: t.client_id ? clientNames.get(t.client_id) ?? null : null,
      items: items.filter((i) => i.template_id === t.template_id),
    }));
  }
);

export const createChecklistTemplate = withAuth(
  async (user, { tenant }, input: ChecklistTemplateInput): Promise<IChecklistTemplate | ChecklistActionError> => {
    try {
      await requireSettingsPermission(user);
      if (!input.name?.trim()) throw new Error('Template name is required');

      const { knex: db } = await createTenantKnex();
      if (input.client_id) await assertClientBelongsToTenant(db, tenant, input.client_id);
      const [row] = await tenantScopedTable(db, 'checklist_templates', tenant)
        .insert({
          tenant,
          name: input.name.trim(),
          description: input.description ?? null,
          is_active: input.is_active ?? true,
          client_id: input.client_id || null,
        })
        .returning('*');
      return row;
    } catch (error) {
      const expected = checklistActionErrorFrom(error);
      if (expected) {
        return expected;
      }
      throw error;
    }
  }
);

export const updateChecklistTemplate = withAuth(
  async (user, { tenant }, templateId: string, input: Partial<ChecklistTemplateInput>): Promise<IChecklistTemplate | ChecklistActionError> => {
    try {
      await requireSettingsPermission(user);

      const { knex: db } = await createTenantKnex();
      const updates: Record<string, unknown> = { updated_at: db.fn.now() };
      if (input.name !== undefined) {
        if (!input.name.trim()) throw new Error('Template name is required');
        updates.name = input.name.trim();
      }
      if (input.description !== undefined) updates.description = input.description;
      if (input.is_active !== undefined) updates.is_active = input.is_active;
      return await withTransaction(db, async (trx: Knex.Transaction) => {
        const existing = await tenantScopedTable(trx, 'checklist_templates', tenant)
          .where({ template_id: templateId }).forUpdate().first('template_id');
        if (!existing) throw new Error('Checklist template not found');
        if (input.client_id !== undefined) {
          if (input.client_id) {
            await assertClientBelongsToTenant(trx, tenant, input.client_id);
            await narrowRuleClientsToOwner(trx, tenant, templateId, input.client_id);
          }
          updates.client_id = input.client_id || null;
        }

        const [row] = await tenantScopedTable(trx, 'checklist_templates', tenant)
          .where({ template_id: templateId })
          .update(updates)
          .returning('*');
        if (!row) throw new Error('Checklist template not found');
        return row;
      });
    } catch (error) {
      const expected = checklistActionErrorFrom(error);
      if (expected) {
        return expected;
      }
      throw error;
    }
  }
);

/**
 * "Duplicate to client": copies a template and its items into a new template scoped to one
 * client, leaving a "copied from" note in the description. A plain copy: no inheritance and no
 * per-client item overrides, so later edits to the source do not propagate.
 */
export const duplicateChecklistTemplateToClient = withAuth(
  async (user, { tenant }, templateId: string, clientId: string): Promise<IChecklistTemplate | ChecklistActionError> => {
    try {
      await requireSettingsPermission(user);
      const { knex: db } = await createTenantKnex();
      return await withTransaction(db, async (trx: Knex.Transaction) => {
        const source = await tenantScopedTable(trx, 'checklist_templates', tenant)
          .where({ template_id: templateId })
          .first();
        if (!source) throw new Error('Checklist template not found');
        if (!clientId) throw new Error(TEMPLATE_CLIENT_INVALID);
        await assertClientBelongsToTenant(trx, tenant, clientId);

        const note = `Copied from "${source.name}"`;
        const [created] = await tenantScopedTable(trx, 'checklist_templates', tenant)
          .insert({
            tenant,
            name: source.name,
            description: source.description ? `${note}\n\n${source.description}` : note,
            is_active: source.is_active,
            client_id: clientId,
          })
          .returning('*');

        const items = await tenantScopedTable(trx, 'checklist_template_items', tenant)
          .where({ template_id: templateId })
          .orderBy('order_number', 'asc') as IChecklistTemplateItem[];
        if (items.length) {
          await tenantScopedTable(trx, 'checklist_template_items', tenant).insert(
            items.map((item) => ({
              tenant,
              template_id: created.template_id,
              item_name: item.item_name,
              description: item.description,
              is_required: item.is_required,
              order_number: item.order_number,
            }))
          );
        }
        return created;
      });
    } catch (error) {
      const expected = checklistActionErrorFrom(error);
      if (expected) {
        return expected;
      }
      throw error;
    }
  }
);

export const deleteChecklistTemplate = withAuth(
  async (user, { tenant }, templateId: string): Promise<void | ChecklistActionError> => {
    try {
      await requireSettingsPermission(user);
      const { knex: db } = await createTenantKnex();
      // Items and apply rules cascade; ticket_checklist_items keep their copies
      // (template_id is provenance only, no FK).
      const deleted = await withTransaction(db, async (trx: Knex.Transaction) => {
        // Serialize rule creation/deletion with the soft tag-reference cleanup.
        const template = await tenantScopedTable(trx, 'checklist_templates', tenant)
          .where({ template_id: templateId }).forUpdate().first('template_id');
        if (!template) throw new Error('Checklist template not found');
        const rules = await tenantScopedTable(trx, 'checklist_template_apply_rules', tenant)
          .where({ template_id: templateId }).select('apply_rule_id');
        for (const rule of rules) await deleteTagReferences(trx, tenant, RULE_TAG_REFERRER, rule.apply_rule_id);
        return tenantScopedTable(trx, 'checklist_templates', tenant).where({ template_id: templateId }).del();
      });
      if (!deleted) {
        throw new Error('Checklist template not found');
      }
    } catch (error) {
      const expected = checklistActionErrorFrom(error);
      if (expected) {
        return expected;
      }
      throw error;
    }
  }
);

export const addChecklistTemplateItem = withAuth(
  async (user, { tenant }, templateId: string, input: ChecklistTemplateItemInput): Promise<IChecklistTemplateItem | ChecklistActionError> => {
    try {
      await requireSettingsPermission(user);
      if (!input.item_name?.trim()) throw new Error('Item name is required');

      const { knex: db } = await createTenantKnex();
      return await withTransaction(db, async (trx: Knex.Transaction) => {
        const template = await tenantScopedTable(trx, 'checklist_templates', tenant)
          .where({ template_id: templateId })
          .first();
        if (!template) throw new Error('Checklist template not found');

        const maxOrder = await tenantScopedTable(trx, 'checklist_template_items', tenant)
          .where({ template_id: templateId })
          .max('order_number as max')
          .first();

        const [row] = await tenantScopedTable(trx, 'checklist_template_items', tenant)
          .insert({
            tenant,
            template_id: templateId,
            item_name: input.item_name.trim(),
            description: input.description ?? null,
            is_required: input.is_required ?? true,
            order_number: (maxOrder?.max ?? -1) + 1,
          })
          .returning('*');
        return row;
      });
    } catch (error) {
      const expected = checklistActionErrorFrom(error);
      if (expected) {
        return expected;
      }
      throw error;
    }
  }
);

export const updateChecklistTemplateItem = withAuth(
  async (user, { tenant }, templateItemId: string, input: Partial<ChecklistTemplateItemInput>): Promise<IChecklistTemplateItem | ChecklistActionError> => {
    try {
      await requireSettingsPermission(user);

      const { knex: db } = await createTenantKnex();
      const updates: Record<string, unknown> = { updated_at: db.fn.now() };
      if (input.item_name !== undefined) {
        if (!input.item_name.trim()) throw new Error('Item name is required');
        updates.item_name = input.item_name.trim();
      }
      if (input.description !== undefined) updates.description = input.description;
      if (input.is_required !== undefined) updates.is_required = input.is_required;

      const [row] = await tenantScopedTable(db, 'checklist_template_items', tenant)
        .where({ template_item_id: templateItemId })
        .update(updates)
        .returning('*');
      if (!row) throw new Error('Template item not found');
      return row;
    } catch (error) {
      const expected = checklistActionErrorFrom(error);
      if (expected) {
        return expected;
      }
      throw error;
    }
  }
);

export const deleteChecklistTemplateItem = withAuth(
  async (user, { tenant }, templateItemId: string): Promise<void | ChecklistActionError> => {
    try {
      await requireSettingsPermission(user);
      const { knex: db } = await createTenantKnex();
      const deleted = await tenantScopedTable(db, 'checklist_template_items', tenant).where({ template_item_id: templateItemId }).del();
      if (!deleted) {
        throw new Error('Template item not found');
      }
    } catch (error) {
      const expected = checklistActionErrorFrom(error);
      if (expected) {
        return expected;
      }
      throw error;
    }
  }
);

export const reorderChecklistTemplateItems = withAuth(
  async (user, { tenant }, templateId: string, orderedItemIds: string[]): Promise<void | ChecklistActionError> => {
    try {
      await requireSettingsPermission(user);

      const { knex: db } = await createTenantKnex();
      await withTransaction(db, async (trx: Knex.Transaction) => {
        const template = await tenantScopedTable(trx, 'checklist_templates', tenant)
          .where({ template_id: templateId })
          .first();
        if (!template) throw new Error('Checklist template not found');

        for (let i = 0; i < orderedItemIds.length; i++) {
          const updated = await tenantScopedTable(trx, 'checklist_template_items', tenant)
            .where({ template_id: templateId, template_item_id: orderedItemIds[i] })
            .update({ order_number: i, updated_at: trx.fn.now() });
          if (!updated) {
            throw new Error('Template item not found');
          }
        }
      });
    } catch (error) {
      const expected = checklistActionErrorFrom(error);
      if (expected) {
        return expected;
      }
      throw error;
    }
  }
);

export const getChecklistTemplateApplyRules = withAuth(
  async (_user, { tenant }, templateId?: string): Promise<IChecklistTemplateApplyRule[]> => {
    const { knex: db } = await createTenantKnex();
    const rows = await tenantScopedTable(db, 'checklist_template_apply_rules', tenant)
      .modify((qb) => { if (templateId) qb.where('template_id', templateId); })
      .orderBy('created_at', 'asc')
      .select('apply_rule_id', 'template_id', 'where', 'where_version', 'is_enabled');
    return rows.map((row: IChecklistTemplateApplyRule) => ({ ...row, where: readChecklistWhere(row.where, row.where_version) }));
  }
);

export const createChecklistTemplateApplyRule = withAuth(
  async (user, { tenant }, templateId: string, input: ChecklistTemplateApplyRuleInput): Promise<IChecklistTemplateApplyRule | ChecklistActionError> => {
    try {
      await requireSettingsPermission(user);

      const { knex: db } = await createTenantKnex();
      return await withTransaction(db, async (trx: Knex.Transaction) => {
        const template = await tenantScopedTable(trx, 'checklist_templates', tenant)
          .where({ template_id: templateId }).forUpdate()
          .first();
        if (!template) throw new Error('Checklist template not found');

        const [row] = await tenantScopedTable(trx, 'checklist_template_apply_rules', tenant)
          .insert({
            tenant,
            template_id: templateId,
            ...applyRulePredicateColumns(input, template.client_id ?? null),
          })
          .returning('*');
        await replaceTagReferences(trx, tenant, RULE_TAG_REFERRER, row.apply_rule_id, checklistWhereTagIds(row.where));
        return row;
      });
    } catch (error) {
      const expected = checklistActionErrorFrom(error);
      if (expected) {
        return expected;
      }
      throw error;
    }
  }
);

export const updateChecklistTemplateApplyRule = withAuth(
  async (user, { tenant }, applyRuleId: string, input: ChecklistTemplateApplyRuleInput): Promise<IChecklistTemplateApplyRule | ChecklistActionError> => {
    try {
      await requireSettingsPermission(user);

      const { knex: db } = await createTenantKnex();
      return await withTransaction(db, async (trx: Knex.Transaction) => {
        const existing = await tenantScopedTable(trx, 'checklist_template_apply_rules', tenant)
          .where({ apply_rule_id: applyRuleId })
          .first('template_id');
        if (!existing) throw new Error('Apply rule not found');
        const template = await tenantScopedTable(trx, 'checklist_templates', tenant)
          .where({ template_id: existing.template_id }).forUpdate()
          .first('client_id');
        if (!template) throw new Error('Checklist template not found');
        const [row] = await tenantScopedTable(trx, 'checklist_template_apply_rules', tenant)
          .where({ apply_rule_id: applyRuleId })
          .update({
            ...applyRulePredicateColumns(input, template.client_id ?? null),
            updated_at: trx.fn.now(),
          })
          .returning('*');
        if (!row) throw new Error('Apply rule not found');
        await replaceTagReferences(trx, tenant, RULE_TAG_REFERRER, row.apply_rule_id, checklistWhereTagIds(row.where));
        return row;
      });
    } catch (error) {
      const expected = checklistActionErrorFrom(error);
      if (expected) {
        return expected;
      }
      throw error;
    }
  }
);

export const deleteChecklistTemplateApplyRule = withAuth(
  async (user, { tenant }, applyRuleId: string): Promise<void | ChecklistActionError> => {
    try {
      await requireSettingsPermission(user);
      const { knex: db } = await createTenantKnex();
      const deleted = await withTransaction(db, async (trx: Knex.Transaction) => {
        const rule = await tenantScopedTable(trx, 'checklist_template_apply_rules', tenant)
          .where({ apply_rule_id: applyRuleId }).first('template_id');
        if (!rule) throw new Error('Apply rule not found');
        await tenantScopedTable(trx, 'checklist_templates', tenant)
          .where({ template_id: rule.template_id }).forUpdate().first('template_id');
        await deleteTagReferences(trx, tenant, RULE_TAG_REFERRER, applyRuleId);
        return tenantScopedTable(trx, 'checklist_template_apply_rules', tenant).where({ apply_rule_id: applyRuleId }).del();
      });
      if (!deleted) {
        throw new Error('Apply rule not found');
      }
    } catch (error) {
      const expected = checklistActionErrorFrom(error);
      if (expected) {
        return expected;
      }
      throw error;
    }
  }
);

export interface ChecklistRuleServiceRequestDefinitionOption {
  definition_id: string;
  name: string;
}

/** Service request definitions a rule can be narrowed to (tenant-scoped, not archived). */
export const getChecklistRuleServiceRequestDefinitions = withAuth(
  async (user, { tenant }): Promise<ChecklistRuleServiceRequestDefinitionOption[] | ChecklistActionError> => {
    try {
      await requireSettingsPermission(user);
      const { knex: db } = await createTenantKnex();
      return await tenantScopedTable(db, 'service_request_definitions', tenant)
        .whereNot({ lifecycle_state: 'archived' })
        .orderBy('name', 'asc')
        .select('definition_id', 'name');
    } catch (error) {
      const expected = checklistActionErrorFrom(error);
      if (expected) return expected;
      throw error;
    }
  }
);

/** Display names for the clients a rule lists (tenant-scoped lookup by id). */
export const getChecklistRuleClientNames = withAuth(
  async (user, { tenant }, clientIds: string[]): Promise<Array<{ client_id: string; client_name: string }> | ChecklistActionError> => {
    try {
      await requireSettingsPermission(user);
      if (!clientIds?.length) return [];
      const { knex: db } = await createTenantKnex();
      return await tenantScopedTable(db, 'clients', tenant)
        .whereIn('client_id', clientIds)
        .select('client_id', 'client_name');
    } catch (error) {
      const expected = checklistActionErrorFrom(error);
      if (expected) return expected;
      throw error;
    }
  }
);
