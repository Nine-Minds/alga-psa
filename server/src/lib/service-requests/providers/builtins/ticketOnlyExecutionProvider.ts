import { SERVICE_REQUEST_EXECUTION_MODES } from '../../domain';
import type { ServiceRequestExecutionProvider } from '../contracts';
import { TicketModel } from '@shared/models/ticketModel';

function getStringConfig(config: Record<string, unknown>, key: string): string | undefined {
  const value = config[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function buildTicketTitle(
  contextPayload: Record<string, unknown>,
  definitionId: string,
  config: Record<string, unknown>
): string {
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
  const payloadLines = Object.entries(payload).map(([key, value]) => `${key}: ${String(value)}`);
  const payloadSummary = payloadLines.length > 0 ? payloadLines.join('\n') : 'No structured payload captured.';
  return descriptionPrefix ? `${descriptionPrefix}\n\n${payloadSummary}` : payloadSummary;
}

export const ticketOnlyExecutionProvider: ServiceRequestExecutionProvider = {
  key: 'ticket-only',
  displayName: 'Ticket Only',
  executionMode: SERVICE_REQUEST_EXECUTION_MODES.TICKET_ONLY,
  validateConfig: () => ({ isValid: true }),
  async execute(context) {
    try {
      return await context.knex.transaction(async (trx) => {
        const configuredBoardId = getStringConfig(context.config, 'boardId');
        const configuredStatusId = getStringConfig(context.config, 'statusId');
        const configuredPriorityId = getStringConfig(context.config, 'priorityId');
        const configuredCategoryId = getStringConfig(context.config, 'categoryId');
        const configuredSubcategoryId = getStringConfig(context.config, 'subcategoryId');
        const configuredAssignedTo = getStringConfig(context.config, 'assignedToUserId');

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

        const priorityId =
          configuredPriorityId ??
          (
            await trx('priorities')
              .where({ tenant: context.tenant })
              .orderBy('order_number', 'asc')
              .first<{ priority_id: string }>('priority_id')
          )?.priority_id;
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
