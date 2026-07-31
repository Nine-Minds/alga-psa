'use server'

import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { Knex } from 'knex';
import { checklistActionErrorFrom, type ChecklistActionError } from './checklistActionErrors';

/**
 * Admin-managed checklist templates, their items, and auto-apply matcher
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
  items?: IChecklistTemplateItem[];
}

export interface IChecklistTemplateApplyRule {
  apply_rule_id: string;
  template_id: string;
  board_id: string | null;
  category_id: string | null;
  subcategory_id: string | null;
  priority_id: string | null;
  is_enabled: boolean;
}

export interface ChecklistTemplateInput {
  name: string;
  description?: string | null;
  is_active?: boolean;
}

export interface ChecklistTemplateItemInput {
  item_name: string;
  description?: string | null;
  is_required?: boolean;
}

export interface ChecklistTemplateApplyRuleInput {
  board_id?: string | null;
  category_id?: string | null;
  subcategory_id?: string | null;
  priority_id?: string | null;
  is_enabled?: boolean;
}

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

export const getChecklistTemplates = withAuth(
  async (_user, { tenant }, opts?: { includeInactive?: boolean }): Promise<IChecklistTemplate[]> => {
    const { knex: db } = await createTenantKnex();
    const templates = await tenantScopedTable(db, 'checklist_templates', tenant)
      .modify((qb) => {
        if (!opts?.includeInactive) qb.where('is_active', true);
      })
      .orderBy('name', 'asc') as IChecklistTemplate[];

    if (!templates.length) return [];

    const items = await tenantScopedTable(db, 'checklist_template_items', tenant)
      .whereIn('template_id', templates.map((t: { template_id: string }) => t.template_id))
      .orderBy('order_number', 'asc') as IChecklistTemplateItem[];

    return templates.map((t) => ({
      template_id: t.template_id,
      name: t.name,
      description: t.description,
      is_active: t.is_active,
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
      const [row] = await tenantScopedTable(db, 'checklist_templates', tenant)
        .insert({
          tenant,
          name: input.name.trim(),
          description: input.description ?? null,
          is_active: input.is_active ?? true,
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

      const [row] = await tenantScopedTable(db, 'checklist_templates', tenant)
        .where({ template_id: templateId })
        .update(updates)
        .returning('*');
      if (!row) throw new Error('Checklist template not found');
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

export const deleteChecklistTemplate = withAuth(
  async (user, { tenant }, templateId: string): Promise<void | ChecklistActionError> => {
    try {
      await requireSettingsPermission(user);
      const { knex: db } = await createTenantKnex();
      // Items and apply rules cascade; ticket_checklist_items keep their copies
      // (template_id is provenance only, no FK).
      const deleted = await tenantScopedTable(db, 'checklist_templates', tenant).where({ template_id: templateId }).del();
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
    return tenantScopedTable(db, 'checklist_template_apply_rules', tenant)
      .modify((qb) => {
        if (templateId) qb.where('template_id', templateId);
      })
      .orderBy('created_at', 'asc')
      .select(
        'apply_rule_id',
        'template_id',
        'board_id',
        'category_id',
        'subcategory_id',
        'priority_id',
        'is_enabled'
      );
  }
);

export const createChecklistTemplateApplyRule = withAuth(
  async (user, { tenant }, templateId: string, input: ChecklistTemplateApplyRuleInput): Promise<IChecklistTemplateApplyRule | ChecklistActionError> => {
    try {
      await requireSettingsPermission(user);

      const { knex: db } = await createTenantKnex();
      return await withTransaction(db, async (trx: Knex.Transaction) => {
        const template = await tenantScopedTable(trx, 'checklist_templates', tenant)
          .where({ template_id: templateId })
          .first();
        if (!template) throw new Error('Checklist template not found');

        const [row] = await tenantScopedTable(trx, 'checklist_template_apply_rules', tenant)
          .insert({
            tenant,
            template_id: templateId,
            board_id: input.board_id || null,
            category_id: input.category_id || null,
            subcategory_id: input.subcategory_id || null,
            priority_id: input.priority_id || null,
            is_enabled: input.is_enabled ?? true,
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

export const updateChecklistTemplateApplyRule = withAuth(
  async (user, { tenant }, applyRuleId: string, input: ChecklistTemplateApplyRuleInput): Promise<IChecklistTemplateApplyRule | ChecklistActionError> => {
    try {
      await requireSettingsPermission(user);

      const { knex: db } = await createTenantKnex();
      const [row] = await tenantScopedTable(db, 'checklist_template_apply_rules', tenant)
        .where({ apply_rule_id: applyRuleId })
        .update({
          board_id: input.board_id || null,
          category_id: input.category_id || null,
          subcategory_id: input.subcategory_id || null,
          priority_id: input.priority_id || null,
          is_enabled: input.is_enabled ?? true,
          updated_at: db.fn.now(),
        })
        .returning('*');
      if (!row) throw new Error('Apply rule not found');
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

export const deleteChecklistTemplateApplyRule = withAuth(
  async (user, { tenant }, applyRuleId: string): Promise<void | ChecklistActionError> => {
    try {
      await requireSettingsPermission(user);
      const { knex: db } = await createTenantKnex();
      const deleted = await tenantScopedTable(db, 'checklist_template_apply_rules', tenant).where({ apply_rule_id: applyRuleId }).del();
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
