'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex } from '@alga-psa/db';
import { z } from 'zod';
import {
  rmmAlertRuleConditionsSchema,
  rmmAlertRuleActionsSchema,
  rmmMaintenanceWindowRecurrenceSchema,
  type RmmAlertRuleRow,
  type RmmMaintenanceWindowRow,
} from '@alga-psa/shared/rmm/alerts';

interface ActionResult<T> {
  success: boolean;
  error?: string;
  data?: T;
}

const ruleInputSchema = z.object({
  integrationId: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  isActive: z.boolean().default(true),
  conditions: rmmAlertRuleConditionsSchema,
  actions: rmmAlertRuleActionsSchema,
});

const windowInputSchema = z
  .object({
    name: z.string().min(1).max(255),
    integrationId: z.string().uuid().nullable().optional(),
    clientId: z.string().uuid().nullable().optional(),
    assetId: z.string().uuid().nullable().optional(),
    isActive: z.boolean().default(true),
    startsAt: z.string().datetime().nullable().optional(),
    endsAt: z.string().datetime().nullable().optional(),
    recurrence: rmmMaintenanceWindowRecurrenceSchema.nullable().optional(),
  })
  .superRefine((value, ctx) => {
    const hasOneOff = Boolean(value.startsAt && value.endsAt);
    const hasRecurrence = Boolean(value.recurrence);
    if (!hasOneOff && !hasRecurrence) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A window needs either a start/end pair or a weekly recurrence',
      });
    }
    if (value.startsAt && value.endsAt && new Date(value.startsAt) >= new Date(value.endsAt)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'startsAt must be before endsAt' });
    }
  });

function zodErrorMessage(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; ');
}

// ---------------------------------------------------------------------------
// Alert rules
// ---------------------------------------------------------------------------

export const listRmmAlertRules = withAuth(
  async (user, { tenant }, input: { integrationId: string }): Promise<ActionResult<RmmAlertRuleRow[]>> => {
    if (!(await hasPermission(user as any, 'system_settings', 'read'))) {
      return { success: false, error: 'Permission denied' };
    }
    const { knex } = await createTenantKnex();
    const rules = await knex('rmm_alert_rules')
      .where({ tenant, integration_id: input.integrationId })
      .orderBy('priority_order', 'asc');
    return { success: true, data: rules as RmmAlertRuleRow[] };
  }
);

export const createRmmAlertRule = withAuth(
  async (user, { tenant }, input: z.input<typeof ruleInputSchema>): Promise<ActionResult<RmmAlertRuleRow>> => {
    if (!(await hasPermission(user as any, 'system_settings', 'update'))) {
      return { success: false, error: 'Permission denied' };
    }
    const parsed = ruleInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: zodErrorMessage(parsed.error) };
    }
    const { knex } = await createTenantKnex();

    const integration = await knex('rmm_integrations')
      .where({ tenant, integration_id: parsed.data.integrationId })
      .first('integration_id');
    if (!integration) {
      return { success: false, error: 'Integration not found' };
    }

    const maxOrder = await knex('rmm_alert_rules')
      .where({ tenant, integration_id: parsed.data.integrationId })
      .max('priority_order as max_order')
      .first();

    const [rule] = await knex('rmm_alert_rules')
      .insert({
        tenant,
        integration_id: parsed.data.integrationId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        is_active: parsed.data.isActive,
        priority_order: Number(maxOrder?.max_order ?? -1) + 1,
        conditions: JSON.stringify(parsed.data.conditions),
        actions: JSON.stringify(parsed.data.actions),
      })
      .returning('*');
    return { success: true, data: rule as RmmAlertRuleRow };
  }
);

export const updateRmmAlertRule = withAuth(
  async (
    user,
    { tenant },
    input: { ruleId: string } & Partial<z.input<typeof ruleInputSchema>>
  ): Promise<ActionResult<RmmAlertRuleRow>> => {
    if (!(await hasPermission(user as any, 'system_settings', 'update'))) {
      return { success: false, error: 'Permission denied' };
    }
    const parsed = ruleInputSchema.omit({ integrationId: true }).partial().safeParse(input);
    if (!parsed.success) {
      return { success: false, error: zodErrorMessage(parsed.error) };
    }

    const update: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) update.name = parsed.data.name;
    if (parsed.data.description !== undefined) update.description = parsed.data.description;
    if (parsed.data.isActive !== undefined) update.is_active = parsed.data.isActive;
    if (parsed.data.conditions !== undefined) update.conditions = JSON.stringify(parsed.data.conditions);
    if (parsed.data.actions !== undefined) update.actions = JSON.stringify(parsed.data.actions);
    if (Object.keys(update).length === 0) {
      return { success: false, error: 'Nothing to update' };
    }

    const { knex } = await createTenantKnex();
    const [rule] = await knex('rmm_alert_rules')
      .where({ tenant, rule_id: input.ruleId })
      .update(update)
      .returning('*');
    if (!rule) {
      return { success: false, error: 'Rule not found' };
    }
    return { success: true, data: rule as RmmAlertRuleRow };
  }
);

export const deleteRmmAlertRule = withAuth(
  async (user, { tenant }, input: { ruleId: string }): Promise<ActionResult<null>> => {
    if (!(await hasPermission(user as any, 'system_settings', 'update'))) {
      return { success: false, error: 'Permission denied' };
    }
    const { knex } = await createTenantKnex();
    const deleted = await knex('rmm_alert_rules').where({ tenant, rule_id: input.ruleId }).delete();
    if (!deleted) {
      return { success: false, error: 'Rule not found' };
    }
    return { success: true, data: null };
  }
);

export const reorderRmmAlertRules = withAuth(
  async (
    user,
    { tenant },
    input: { integrationId: string; orderedRuleIds: string[] }
  ): Promise<ActionResult<null>> => {
    if (!(await hasPermission(user as any, 'system_settings', 'update'))) {
      return { success: false, error: 'Permission denied' };
    }
    const { knex } = await createTenantKnex();
    await knex.transaction(async (trx) => {
      for (let index = 0; index < input.orderedRuleIds.length; index += 1) {
        await trx('rmm_alert_rules')
          .where({ tenant, integration_id: input.integrationId, rule_id: input.orderedRuleIds[index] })
          .update({ priority_order: index });
      }
    });
    return { success: true, data: null };
  }
);

// ---------------------------------------------------------------------------
// Maintenance windows
// ---------------------------------------------------------------------------

export const listRmmMaintenanceWindows = withAuth(
  async (
    user,
    { tenant },
    input?: { integrationId?: string }
  ): Promise<ActionResult<RmmMaintenanceWindowRow[]>> => {
    if (!(await hasPermission(user as any, 'system_settings', 'read'))) {
      return { success: false, error: 'Permission denied' };
    }
    const { knex } = await createTenantKnex();
    let query = knex('rmm_maintenance_windows').where({ tenant }).orderBy('created_at', 'desc');
    if (input?.integrationId) {
      // A window scoped to another integration never affects this one; global
      // (integration-null) windows always show.
      query = query.andWhere((qb) =>
        qb.where('integration_id', input.integrationId!).orWhereNull('integration_id')
      );
    }
    const windows = await query;
    return { success: true, data: windows as RmmMaintenanceWindowRow[] };
  }
);

export const createRmmMaintenanceWindow = withAuth(
  async (
    user,
    { tenant },
    input: z.input<typeof windowInputSchema>
  ): Promise<ActionResult<RmmMaintenanceWindowRow>> => {
    if (!(await hasPermission(user as any, 'system_settings', 'update'))) {
      return { success: false, error: 'Permission denied' };
    }
    const parsed = windowInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: zodErrorMessage(parsed.error) };
    }
    const { knex } = await createTenantKnex();
    const [window] = await knex('rmm_maintenance_windows')
      .insert({
        tenant,
        name: parsed.data.name,
        integration_id: parsed.data.integrationId ?? null,
        client_id: parsed.data.clientId ?? null,
        asset_id: parsed.data.assetId ?? null,
        is_active: parsed.data.isActive,
        starts_at: parsed.data.startsAt ?? null,
        ends_at: parsed.data.endsAt ?? null,
        recurrence: parsed.data.recurrence ? JSON.stringify(parsed.data.recurrence) : null,
      })
      .returning('*');
    return { success: true, data: window as RmmMaintenanceWindowRow };
  }
);

export const updateRmmMaintenanceWindow = withAuth(
  async (
    user,
    { tenant },
    input: { windowId: string } & z.input<typeof windowInputSchema>
  ): Promise<ActionResult<RmmMaintenanceWindowRow>> => {
    if (!(await hasPermission(user as any, 'system_settings', 'update'))) {
      return { success: false, error: 'Permission denied' };
    }
    const parsed = windowInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: zodErrorMessage(parsed.error) };
    }
    const { knex } = await createTenantKnex();
    const [window] = await knex('rmm_maintenance_windows')
      .where({ tenant, window_id: input.windowId })
      .update({
        name: parsed.data.name,
        integration_id: parsed.data.integrationId ?? null,
        client_id: parsed.data.clientId ?? null,
        asset_id: parsed.data.assetId ?? null,
        is_active: parsed.data.isActive,
        starts_at: parsed.data.startsAt ?? null,
        ends_at: parsed.data.endsAt ?? null,
        recurrence: parsed.data.recurrence ? JSON.stringify(parsed.data.recurrence) : null,
      })
      .returning('*');
    if (!window) {
      return { success: false, error: 'Window not found' };
    }
    return { success: true, data: window as RmmMaintenanceWindowRow };
  }
);

export const deleteRmmMaintenanceWindow = withAuth(
  async (user, { tenant }, input: { windowId: string }): Promise<ActionResult<null>> => {
    if (!(await hasPermission(user as any, 'system_settings', 'update'))) {
      return { success: false, error: 'Permission denied' };
    }
    const { knex } = await createTenantKnex();
    const deleted = await knex('rmm_maintenance_windows').where({ tenant, window_id: input.windowId }).delete();
    if (!deleted) {
      return { success: false, error: 'Window not found' };
    }
    return { success: true, data: null };
  }
);
