import { SERVICE_REQUEST_EXECUTION_MODES } from '../../domain';
import type { ServiceRequestExecutionProvider } from '../contracts';
import { TicketModel } from '@shared/models/ticketModel';
import { calculateItilPriority } from '@alga-psa/tickets/lib/itilUtils';

function getStringConfig(config: Record<string, unknown>, key: string): string | undefined {
  const value = config[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function renderTemplate(
  template: string,
  payload: Record<string, unknown>
): string {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, fieldKey: string) => {
    const value = payload[fieldKey];
    if (value === null || value === undefined) {
      return '';
    }
    return String(value);
  });
}

function getNumberConfig(config: Record<string, unknown>, key: string): number | undefined {
  const value = config[key];
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isInteger(parsed) ? parsed : undefined;
  }
  return undefined;
}

function buildTicketTitle(
  contextPayload: Record<string, unknown>,
  definitionId: string,
  config: Record<string, unknown>
): string {
  const configuredTemplate = getStringConfig(config, 'titleTemplate');
  if (configuredTemplate) {
    const rendered = renderTemplate(configuredTemplate, contextPayload).trim();
    if (rendered.length > 0) {
      return rendered;
    }
  }

  const configuredFieldKey = getStringConfig(config, 'titleFieldKey');
  if (configuredFieldKey) {
    const configuredValue = contextPayload[configuredFieldKey];
    if (typeof configuredValue === 'string' && configuredValue.trim().length > 0) {
      return configuredValue.trim();
    }
  }

  const firstStringValue = Object.values(contextPayload).find(
    (value) => typeof value === 'string' && value.trim().length > 0
  ) as string | undefined;

  if (firstStringValue) {
    return firstStringValue.trim();
  }

  return `Service Request ${definitionId.slice(0, 8)}`;
}

function buildTicketDescription(
  payload: Record<string, unknown>,
  config: Record<string, unknown>
): string {
  const descriptionPrefix = getStringConfig(config, 'descriptionPrefix');
  const includeFormResponses = config.includeFormResponsesInDescription !== false;
  const payloadLines = Object.entries(payload).map(([key, value]) => `${key}: ${String(value)}`);
  const payloadSummary = payloadLines.length > 0 ? payloadLines.join('\n') : 'No structured payload captured.';

  if (!includeFormResponses) {
    return descriptionPrefix ?? 'No structured payload captured.';
  }

  return descriptionPrefix ? `${descriptionPrefix}\n\n${payloadSummary}` : payloadSummary;
}

function validateTicketOnlyExecutionConfig(config: Record<string, unknown>) {
  const errors: string[] = [];

  if (!getStringConfig(config, 'boardId')) {
    errors.push('Ticket routing board is required');
  }

  if (!getStringConfig(config, 'statusId')) {
    errors.push('Ticket routing status is required');
  }

  const hasPriorityId = Boolean(getStringConfig(config, 'priorityId'));
  const hasItilImpact = getNumberConfig(config, 'itilImpact') !== undefined;
  const hasItilUrgency = getNumberConfig(config, 'itilUrgency') !== undefined;

  if (!hasPriorityId && !hasItilImpact && !hasItilUrgency) {
    errors.push('Ticket routing priority is required');
  }

  if (!hasPriorityId && hasItilImpact !== hasItilUrgency) {
    errors.push('Ticket routing requires both ITIL impact and urgency when priority is not set');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings: [],
  };
}

export const ticketOnlyExecutionProvider: ServiceRequestExecutionProvider = {
  key: 'ticket-only',
  displayName: 'Ticket Only',
  executionMode: SERVICE_REQUEST_EXECUTION_MODES.TICKET_ONLY,
  validateConfig: validateTicketOnlyExecutionConfig,
  async execute(context) {
    try {
      return await context.knex.transaction(async (trx) => {
        const configuredBoardId = getStringConfig(context.config, 'boardId');
        const configuredStatusId = getStringConfig(context.config, 'statusId');
        const configuredPriorityId = getStringConfig(context.config, 'priorityId');
        const configuredCategoryId = getStringConfig(context.config, 'categoryId');
        const configuredSubcategoryId = getStringConfig(context.config, 'subcategoryId');
        const configuredAssignedTo = getStringConfig(context.config, 'assignedToUserId');
        const configuredItilImpact = getNumberConfig(context.config, 'itilImpact');
        const configuredItilUrgency = getNumberConfig(context.config, 'itilUrgency');

        const boardId =
          configuredBoardId ??
          (
            await trx('boards')
              .where({ tenant: context.tenant, is_default: true })
              .first<{ board_id: string }>('board_id')
          )?.board_id;
        if (!boardId) {
          return {
            status: 'failed',
            errorSummary: 'No ticket board is available for ticket-only execution.',
          } as const;
        }

        const statusId =
          configuredStatusId ??
          (await TicketModel.getDefaultStatusId(context.tenant, trx, boardId)) ??
          undefined;
        if (!statusId) {
          return {
            status: 'failed',
            errorSummary: 'No ticket status is available for ticket-only execution.',
          } as const;
        }

        let priorityId =
          configuredPriorityId ??
          (
            await trx('priorities')
              .where({ tenant: context.tenant })
              .orderBy('order_number', 'asc')
              .first<{ priority_id: string }>('priority_id')
          )?.priority_id;

        if (configuredItilImpact && configuredItilUrgency) {
          const priorityLevel = calculateItilPriority(configuredItilImpact, configuredItilUrgency);
          const itilPriorityRecord = await trx('priorities')
            .where('tenant', context.tenant)
            .where('is_from_itil_standard', true)
            .where('priority_name', 'like', `P${priorityLevel} -%`)
            .where('item_type', 'ticket')
            .first<{ priority_id: string }>('priority_id');

          if (itilPriorityRecord?.priority_id) {
            priorityId = itilPriorityRecord.priority_id;
          }
        }

        if (!priorityId) {
          return {
            status: 'failed',
            errorSummary: 'No ticket priority is available for ticket-only execution.',
          } as const;
        }

        const title = buildTicketTitle(context.payload, context.definitionId, context.config);
        const description = buildTicketDescription(context.payload, context.config);

        const ticket = await TicketModel.createTicketWithRetry(
          {
            title,
            description,
            board_id: boardId,
            status_id: statusId,
            priority_id: priorityId,
            category_id: configuredCategoryId,
            subcategory_id: configuredSubcategoryId,
            assigned_to: configuredAssignedTo,
            client_id: context.clientId,
            contact_id: context.contactId ?? undefined,
            itil_impact: configuredItilImpact,
            itil_urgency: configuredItilUrgency,
            entered_by: context.requesterUserId,
            source: 'client_portal',
            ticket_origin: 'client_portal',
          },
          context.tenant,
          trx,
          {},
          undefined,
          undefined,
          context.requesterUserId,
          1
        );

        return {
          status: 'succeeded',
          createdTicketId: ticket.ticket_id,
        } as const;
      });
    } catch (error) {
      return {
        status: 'failed',
        errorSummary: error instanceof Error ? error.message : 'Ticket execution failed.',
      };
    }
  },
};
