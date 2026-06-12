import { z } from 'zod';
import { getActionRegistryV2 } from '../../../../../../shared/workflow/runtime/registries/actionRegistry';
import { throwActionError } from '../../../../../../shared/workflow/runtime/actions/businessOperations/shared';
import type { ActionContext } from '../../../../../../shared/workflow/runtime/registries/actionRegistry';
import {
  createTicketForAlert,
  rmmAlertRuleActionsSchema,
  type NormalizedRmmAlertEvent,
  type RmmAlertRuleActions,
} from '../../../../../../shared/rmm/alerts';

let rmmAlertActionsRegistered = false;

/**
 * Provider-agnostic RMM alert actions. Unlike the per-provider ninjaone.*
 * actions these work for any connected RMM, keyed off rmm_alerts rows.
 */
export function registerRmmAlertWorkflowActionsV2(): void {
  if (rmmAlertActionsRegistered) return;
  const registry = getActionRegistryV2();

  registry.register({
    id: 'rmm.alerts.create_ticket',
    version: 1,
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    inputSchema: z.object({
      alert_id: z.string().uuid(),
      board_id: z.string().uuid().optional(),
      priority_id: z.string().uuid().optional(),
      assign_to_user_id: z.string().uuid().optional(),
      title_template: z.string().optional(),
      description_template: z.string().optional()
    }),
    outputSchema: z.object({
      ticket_id: z.string().uuid(),
      ticket_number: z.string()
    }),
    ui: {
      label: 'Create ticket from RMM alert',
      description: 'Create an Alga ticket for an unlinked RMM alert (any provider) via the shared alert ticket creator.',
      category: 'RMM',
      icon: 'alert'
    },
    handler: async (input, ctx: ActionContext) => {
      const tenantId = ctx.tenantId ?? null;
      if (!tenantId) {
        throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: 'tenantId is required' });
      }
      const knex = ctx.knex;
      if (!knex) {
        throwActionError(ctx, { category: 'ActionError', code: 'INTERNAL_ERROR', message: 'Database connection unavailable' });
      }

      const alert = await knex('rmm_alerts as a')
        .join('rmm_integrations as i', function joinIntegrations(this: any) {
          this.on('i.tenant', 'a.tenant').andOn('i.integration_id', 'a.integration_id');
        })
        .where('a.tenant', tenantId)
        .andWhere('a.alert_id', input.alert_id)
        .first('a.*', 'i.provider');
      if (!alert) {
        throwActionError(ctx, { category: 'ValidationError', code: 'NOT_FOUND', message: 'Alert not found' });
      }
      if (alert.ticket_id) {
        throwActionError(ctx, {
          category: 'ValidationError',
          code: 'ALREADY_LINKED',
          message: 'Alert already has a linked ticket'
        });
      }

      // Resolve the client from the asset, falling back to the org mapping.
      let clientId: string | null = null;
      let organizationName: string | null = null;
      if (alert.asset_id) {
        const asset = await knex('assets')
          .where({ tenant: tenantId, asset_id: alert.asset_id })
          .first('client_id');
        clientId = asset?.client_id ?? null;
      }
      const rawMetadata = typeof alert.metadata === 'string' ? safeParse(alert.metadata) : alert.metadata;
      const externalOrgId =
        rawMetadata && typeof rawMetadata === 'object' && 'organizationId' in rawMetadata
          ? String((rawMetadata as Record<string, unknown>).organizationId)
          : null;
      if (externalOrgId) {
        const orgMapping = await knex('rmm_organization_mappings')
          .where({ tenant: tenantId, integration_id: alert.integration_id, external_organization_id: externalOrgId })
          .first('client_id', 'external_organization_name');
        organizationName = orgMapping?.external_organization_name ?? null;
        if (!clientId) clientId = orgMapping?.client_id ?? null;
      }
      if (!clientId) {
        throwActionError(ctx, {
          category: 'ValidationError',
          code: 'NO_CLIENT',
          message: 'No client resolvable for this alert (unmapped asset and organization)'
        });
      }

      const event: NormalizedRmmAlertEvent = {
        tenantId,
        integrationId: alert.integration_id,
        provider: alert.provider,
        kind: 'triggered',
        externalAlertId: alert.external_alert_id,
        externalDeviceId: alert.external_device_id,
        activityType: alert.activity_type,
        alertClass: alert.alert_class,
        sourceType: alert.source_type,
        severity: alert.severity,
        message: alert.message,
        deviceName: alert.device_name,
        externalOrganizationId: externalOrgId,
        occurredAt: toIso(alert.triggered_at) ?? new Date().toISOString(),
        raw: (rawMetadata as Record<string, unknown>) ?? {}
      };
      const actions: RmmAlertRuleActions = rmmAlertRuleActionsSchema.parse({
        createTicket: true,
        ...(input.board_id ? { boardId: input.board_id } : {}),
        ...(input.priority_id ? { priorityOverride: input.priority_id } : {}),
        ...(input.assign_to_user_id ? { assignToUserId: input.assign_to_user_id } : {}),
        ...(input.title_template || input.description_template
          ? {
              ticketTemplate: {
                ...(input.title_template ? { titleTemplate: input.title_template } : {}),
                ...(input.description_template ? { descriptionTemplate: input.description_template } : {})
              }
            }
          : {})
      });

      const ticket = await knex.transaction(async (trx: any) => {
        const created = await createTicketForAlert(trx, {
          event,
          actions,
          clientId: clientId!,
          assetId: alert.asset_id,
          organizationName
        });
        await trx('rmm_alerts')
          .where({ tenant: tenantId, alert_id: alert.alert_id })
          .update({ ticket_id: created.ticket_id, updated_at: new Date().toISOString() });
        return created;
      });

      return { ticket_id: ticket.ticket_id, ticket_number: ticket.ticket_number };
    }
  });

  rmmAlertActionsRegistered = true;
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
