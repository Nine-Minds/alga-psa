import { z } from 'zod';
import { getActionRegistryV2 } from '../../../../../../shared/workflow/runtime/registries/actionRegistry';
import { throwActionError } from '../../../../../../shared/workflow/runtime/actions/businessOperations/shared';
import type { ActionContext } from '../../../../../../shared/workflow/runtime/registries/actionRegistry';
import { createTicketForAlertId } from '../../../../../../shared/rmm/alerts';

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

      try {
        const ticket = await createTicketForAlertId(knex, {
          tenantId,
          alertId: input.alert_id,
          overrides: {
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
          }
        });
        return { ticket_id: ticket.ticket_id, ticket_number: ticket.ticket_number };
      } catch (error) {
        throwActionError(ctx, {
          category: 'ValidationError',
          code: 'CREATE_TICKET_FAILED',
          message: error instanceof Error ? error.message : 'Failed to create ticket from alert'
        });
      }
    }
  });

  rmmAlertActionsRegistered = true;
}
