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

// ---------------------------------------------------------------------------
// Form options + polling settings (settings UI support)
// ---------------------------------------------------------------------------

export interface RmmAlertRuleFormOptions {
  boards: Array<{ board_id: string; board_name: string }>;
  priorities: Array<{ priority_id: string; priority_name: string }>;
  closedStatuses: Array<{ status_id: string; name: string }>;
  users: Array<{ user_id: string; first_name: string | null; last_name: string | null; email: string }>;
  organizations: Array<{ external_organization_id: string; external_organization_name: string | null }>;
}

export const getRmmAlertRuleFormOptions = withAuth(
  async (user, { tenant }, input: { integrationId: string }): Promise<ActionResult<RmmAlertRuleFormOptions>> => {
    if (!(await hasPermission(user as any, 'system_settings', 'read'))) {
      return { success: false, error: 'Permission denied' };
    }
    const { knex } = await createTenantKnex();
    const [boards, priorities, closedStatuses, users, organizations] = await Promise.all([
      knex('boards').where({ tenant }).select('board_id', 'board_name').orderBy('board_name'),
      knex('priorities').where({ tenant }).select('priority_id', 'priority_name').orderBy('priority_name'),
      knex('statuses')
        .where({ tenant, status_type: 'ticket', is_closed: true })
        .select('status_id', 'name')
        .orderBy('order_number'),
      knex('users')
        .where({ tenant, user_type: 'internal' })
        .andWhere((qb) => qb.where('is_inactive', false).orWhereNull('is_inactive'))
        .select('user_id', 'first_name', 'last_name', 'email')
        .orderBy('first_name'),
      knex('rmm_organization_mappings')
        .where({ tenant, integration_id: input.integrationId })
        .select('external_organization_id', 'external_organization_name')
        .orderBy('external_organization_name'),
    ]);
    return { success: true, data: { boards, priorities, closedStatuses, users, organizations } };
  }
);

export interface RmmAlertPollingSettingsView {
  enabled: boolean;
  intervalMinutes: number;
  lastPolledAt: string | null;
}

export const getRmmAlertPollingSettings = withAuth(
  async (user, { tenant }, input: { integrationId: string }): Promise<ActionResult<RmmAlertPollingSettingsView>> => {
    if (!(await hasPermission(user as any, 'system_settings', 'read'))) {
      return { success: false, error: 'Permission denied' };
    }
    const { knex } = await createTenantKnex();
    const integration = await knex('rmm_integrations')
      .where({ tenant, integration_id: input.integrationId })
      .first('settings');
    if (!integration) {
      return { success: false, error: 'Integration not found' };
    }
    const settings = typeof integration.settings === 'string' ? safeJson(integration.settings) : integration.settings;
    const polling = (settings?.alertPolling ?? {}) as Record<string, unknown>;
    const rawInterval = Number(polling.intervalMinutes);
    return {
      success: true,
      data: {
        enabled: polling.enabled !== false,
        intervalMinutes: Number.isFinite(rawInterval) ? rawInterval : 15,
        lastPolledAt: typeof polling.lastPolledAt === 'string' ? polling.lastPolledAt : null,
      },
    };
  }
);

export const updateRmmAlertPollingSettings = withAuth(
  async (
    user,
    { tenant },
    input: { integrationId: string; enabled: boolean; intervalMinutes: number }
  ): Promise<ActionResult<null>> => {
    if (!(await hasPermission(user as any, 'system_settings', 'update'))) {
      return { success: false, error: 'Permission denied' };
    }
    const intervalMinutes = Math.round(Number(input.intervalMinutes));
    if (!Number.isFinite(intervalMinutes) || intervalMinutes < 5 || intervalMinutes > 60) {
      return { success: false, error: 'Poll interval must be between 5 and 60 minutes' };
    }
    const { knex } = await createTenantKnex();
    const updated = await knex('rmm_integrations')
      .where({ tenant, integration_id: input.integrationId })
      .update({
        // jsonb_set cannot create the intermediate alertPolling object, so
        // merge into it explicitly (first save would otherwise be a no-op).
        settings: knex.raw(
          `jsonb_set(
             COALESCE(settings, '{}'::jsonb),
             '{alertPolling}',
             COALESCE(settings->'alertPolling', '{}'::jsonb)
               || jsonb_build_object('enabled', ?::boolean, 'intervalMinutes', ?::int),
             true
           )`,
          [input.enabled, intervalMinutes]
        ),
      });
    if (!updated) {
      return { success: false, error: 'Integration not found' };
    }
    return { success: true, data: null };
  }
);

function safeJson(value: string): Record<string, unknown> | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

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

/**
 * Resolve the rmm_integrations.integration_id for a given provider slug.
 * Used by the alert-automation settings UI when the provider-pane component
 * doesn't already have the integration_id in its loaded state.
 */
export const getRmmIntegrationIdByProvider = withAuth(
  async (user, { tenant }, input: { provider: string }): Promise<ActionResult<{ integrationId: string | null }>> => {
    if (!(await hasPermission(user as any, 'system_settings', 'read'))) {
      return { success: false, error: 'Permission denied' };
    }
    const { knex } = await createTenantKnex();
    const row = await knex('rmm_integrations')
      .where({ tenant, provider: input.provider })
      .first('integration_id');
    return { success: true, data: { integrationId: row?.integration_id ?? null } };
  }
);
