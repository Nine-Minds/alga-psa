'use server';

// EE composition of "create workflow from ticket".
//
// `@alga-psa/tickets` (ticket data + row authorization) and `@alga-psa/workflows`
// (workflow persistence) must not import each other, so this EE server file is the only
// place that composes them. Nothing here publishes: the result is always a draft.
import { z } from 'zod';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { auditLog, createTenantKnex } from '@alga-psa/db';
import { isEnterprise } from '@alga-psa/core/features';
import { getTicketWorkflowBlueprint } from '@alga-psa/tickets/actions/ticketActions';
import {
  actionError,
  isActionMessageError,
  isActionPermissionError,
  permissionError,
} from '@alga-psa/ui/lib/errorHandling';
import {
  buildWorkflowDraftFromTicket,
  splitTicketChecklist,
  type TicketWorkflowTrigger,
} from '@alga-psa/shared/workflow/runtime/designer/draftFromTicket';
import {
  buildTriggerForCatalogEvent,
  createWorkflowDefinitionAction,
} from '@alga-psa/workflows/actions';
import { EMPTY_WORKFLOW_PAYLOAD_SCHEMA_REF } from '@alga-psa/event-schemas';

const CreateWorkflowFromTicketInput = z.object({
  ticketId: z.string().guid(),
  name: z.string().trim().min(1, 'Workflow name is required').max(200),
  trigger: z.discriminatedUnion('type', [
    z.object({ type: z.literal('manual') }),
    z.object({ type: z.literal('event'), eventName: z.string().trim().min(1) }),
  ]),
  include: z.object({
    assignment: z.boolean(),
    tags: z.boolean(),
    customFields: z.boolean(),
    checklist: z.boolean(),
  }),
});

export type CreateWorkflowFromTicketInput = z.infer<typeof CreateWorkflowFromTicketInput>;

export type CreateWorkflowFromTicketResult =
  | { workflowId: string }
  | ReturnType<typeof permissionError>
  | ReturnType<typeof actionError>;

export const createWorkflowFromTicketAction = withAuth(
  async (user, { tenant }, input: unknown): Promise<CreateWorkflowFromTicketResult> => {
    // 1. Edition gate: fail fast, nothing is read or written.
    if (!isEnterprise) {
      throw new Error('Create workflow from ticket is only available in the Enterprise edition');
    }
    if (user.user_type === 'client') {
      return permissionError('Permission denied: operation not available in client portal');
    }

    const parsed = CreateWorkflowFromTicketInput.safeParse(input);
    if (!parsed.success) {
      return actionError(parsed.error.issues[0]?.message ?? 'Invalid request');
    }
    const request = parsed.data;

    // 2. Workflow rights (manage or admin) before any ticket data is touched.
    const { knex } = await createTenantKnex();
    const canManage =
      (await hasPermission(user, 'workflow', 'manage', knex)) ||
      (await hasPermission(user, 'workflow', 'admin', knex));
    if (!canManage) {
      return permissionError('Permission denied: workflow manage rights are required');
    }

    // 3. Ticket read permission + row-level authorization (inside the tickets action).
    const blueprint = await getTicketWorkflowBlueprint(request.ticketId);
    if (isActionPermissionError(blueprint) || isActionMessageError(blueprint)) {
      // The error results are the tickets action's own permission/message errors; pass them through.
      return blueprint as unknown as CreateWorkflowFromTicketResult;
    }

    // 4. Resolve the trigger from the catalog on the server; the client never supplies a schema ref.
    let trigger: TicketWorkflowTrigger;
    let dateSourceId: string | null = null;
    if (request.trigger.type === 'manual') {
      trigger = { kind: 'manual' };
    } else {
      const resolved = await buildTriggerForCatalogEvent({ eventName: request.trigger.eventName });
      trigger = {
        kind: 'trigger',
        payloadSchemaRef: resolved.payloadSchemaRef,
        trigger: resolved.trigger,
      };
      dateSourceId = resolved.dateSourceId ?? null;
    }

    // 5. Build and persist the draft (createWorkflowDefinitionAction re-checks manage and validates).
    const definition = buildWorkflowDraftFromTicket(blueprint, {
      name: request.name,
      trigger,
      include: {
        assignment: Boolean(request.include.assignment),
        tags: Boolean(request.include.tags),
        customFields: Boolean(request.include.customFields),
        checklist: Boolean(request.include.checklist),
      },
    });
    let created: { workflowId: string };
    try {
      created = await createWorkflowDefinitionAction({ definition });
    } catch (error) {
      if (error instanceof Error && error.message === 'Forbidden') {
        return permissionError('Permission denied: workflow manage rights are required');
      }
      throw error;
    }

    // LEVERAGE: pattern tenant-scoped-audit — auditLog outside a GUC-setting trx is silently skipped behind pgbouncer
    await knex.transaction(async (trx) => {
      await trx.raw("select set_config('app.current_tenant', ?, true)", [tenant]);
      await auditLog(trx, {
        userId: user.user_id,
        operation: 'workflow_definition_create_from_ticket',
        tableName: 'workflow_definitions',
        recordId: created.workflowId,
        changedData: {
          sourceTicketId: request.ticketId,
          include: request.include,
          triggerEventName: request.trigger.type === 'event' ? request.trigger.eventName : null,
        },
        details: {
          tenant,
          dateSourceId,
          payloadSchemaRef:
            trigger.kind === 'trigger' ? trigger.payloadSchemaRef : EMPTY_WORKFLOW_PAYLOAD_SCHEMA_REF,
          source: 'ui',
        },
      });
    });

    return { workflowId: created.workflowId };
  }
);

const ImportSummaryInput = z.object({ ticketId: z.string().guid() });

export type WorkflowFromTicketImportSummary = {
  customFieldCount: number;
  /** Checklist items whose template is still active; re-applied from the current template. */
  templateItemCount: number;
  /** Ad-hoc items, including items whose template is inactive or missing. */
  adHocItemCount: number;
};

export type WorkflowFromTicketImportSummaryResult =
  | WorkflowFromTicketImportSummary
  | ReturnType<typeof permissionError>
  | ReturnType<typeof actionError>;

/**
 * Read-only counts shown in the dialog's import section. Same gate as the create action
 * (edition, not a client user, workflow manage/admin, then ticket read + row-auth through
 * the tickets action). Returns counts only; no ticket content crosses to the client.
 */
// LEVERAGE: pattern ee-workflow-from-ticket-gate — same gate sequence as createWorkflowFromTicketAction
export const getWorkflowFromTicketImportSummaryAction = withAuth(
  async (user, _ctx, input: unknown): Promise<WorkflowFromTicketImportSummaryResult> => {
    if (!isEnterprise) {
      throw new Error('Create workflow from ticket is only available in the Enterprise edition');
    }
    if (user.user_type === 'client') {
      return permissionError('Permission denied: operation not available in client portal');
    }
    const parsed = ImportSummaryInput.safeParse(input);
    if (!parsed.success) {
      return actionError(parsed.error.issues[0]?.message ?? 'Invalid request');
    }
    const { knex } = await createTenantKnex();
    const canManage =
      (await hasPermission(user, 'workflow', 'manage', knex)) ||
      (await hasPermission(user, 'workflow', 'admin', knex));
    if (!canManage) {
      return permissionError('Permission denied: workflow manage rights are required');
    }
    const blueprint = await getTicketWorkflowBlueprint(parsed.data.ticketId);
    if (isActionPermissionError(blueprint) || isActionMessageError(blueprint)) {
      return blueprint as unknown as WorkflowFromTicketImportSummaryResult;
    }
    const { adHocItems } = splitTicketChecklist(blueprint.checklist);
    return {
      customFieldCount: Object.keys(blueprint.custom_fields).length,
      templateItemCount: blueprint.checklist.length - adHocItems.length,
      adHocItemCount: adHocItems.length,
    };
  }
);
