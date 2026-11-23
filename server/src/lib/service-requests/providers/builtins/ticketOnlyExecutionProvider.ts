import { SERVICE_REQUEST_EXECUTION_MODES } from '../../domain';
import { WorkflowEventPublisher } from '@shared/workflow/adapters/workflowEventPublisher';
import type { ServiceRequestExecutionProvider } from '../contracts';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { TicketModel } from '@shared/models/ticketModel';
import { ticketCreatedPublishedByCaller } from '@shared/lib/tickets/ticketLifecycleEvents';
import type { Knex } from 'knex';
import { resolveTicketPriorityFields } from '@alga-psa/shared/lib/tickets/boardFieldRules';
import { getTenantDefaultLocale } from '@alga-psa/notifications/notifications/emailLocaleResolver';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import {
  normalizeTicketSubject,
  renderServiceRequestTemplate,
  type ServiceRequestTemplateFormat,
} from '../../ticketTextTemplate';
import {
  describeFormAnswer,
  getFieldElementKind,
  groupFormElementsBySection,
} from '../../formSchema';

function getStringConfig(config: Record<string, unknown>, key: string): string | undefined {
  const value = config[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
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

export interface TicketTextContext {
  formSchema: Record<string, unknown> | undefined;
  payload: Record<string, unknown>;
  format: ServiceRequestTemplateFormat;
}

/** Subject chain: template, then legacy `titleFieldKey`, then the first non-empty answer, then `Service Request <id8>`. */
export function buildTicketTitle(
  text: TicketTextContext,
  definitionId: string,
  config: Record<string, unknown>
): string {
  const { payload } = text;
  const configuredTemplate = getStringConfig(config, 'titleTemplate');
  if (configuredTemplate) {
    const rendered = normalizeTicketSubject(renderServiceRequestTemplate(configuredTemplate, text));
    if (rendered.length > 0) {
      return rendered;
    }
  }

  const configuredFieldKey = getStringConfig(config, 'titleFieldKey');
  if (configuredFieldKey) {
    const configuredValue = payload[configuredFieldKey];
    if (typeof configuredValue === 'string') {
      const normalized = normalizeTicketSubject(configuredValue);
      if (normalized.length > 0) {
        return normalized;
      }
    }
  }

  for (const value of Object.values(payload)) {
    if (typeof value === 'string') {
      const normalized = normalizeTicketSubject(value);
      if (normalized.length > 0) {
        return normalized;
      }
    }
  }

  return `Service Request ${definitionId.slice(0, 8)}`;
}

interface FormFieldSnapshot {
  key?: unknown;
  type?: unknown;
  label?: unknown;
  options?: Array<{ label?: unknown; value?: unknown }>;
}

const textCell = (text: string, bold = false) => [
  { type: 'text', text, styles: bold ? { bold: true } : {} },
];

const paragraph = (text: string, bold = false) => ({
  type: 'paragraph',
  content: textCell(text, bold),
});

function describeAnswer(
  field: FormFieldSnapshot | undefined,
  value: unknown,
  format: ServiceRequestTemplateFormat
): string {
  return describeFormAnswer(field, value, { ...format, empty: '—' });
}

function elementLabel(element: FormFieldSnapshot): string {
  return typeof element?.label === 'string' && element.label.trim()
    ? element.label.trim()
    : String(element?.key ?? '');
}

/**
 * The ticket description as serialized rich-text blocks: the configured prefix, then the
 * answers in form order. A form with sections gets one labelled block per section — the
 * section's name, then a table of its answers — so the technician reads the request in the
 * shape it was asked. Answers the schema does not describe follow in a table of their own.
 * Cells use the inline-array form, which the ticket editor and the notification email
 * renderer both read.
 */
export function buildTicketDescription(
  text: TicketTextContext,
  config: Record<string, unknown>
): string {
  const { payload, formSchema } = text;
  const configuredPrefix = getStringConfig(config, 'descriptionPrefix');
  // Line breaks are kept: only the subject is normalized.
  const descriptionPrefix = configuredPrefix ? renderServiceRequestTemplate(configuredPrefix, text).trim() || undefined : undefined;
  const includeFormResponses = config.includeFormResponsesInDescription !== false;
  const emptySummary = 'No structured payload captured.';
  const blocks: unknown[] = descriptionPrefix ? [paragraph(descriptionPrefix)] : [];

  if (!includeFormResponses) {
    return JSON.stringify(blocks.length > 0 ? blocks : [paragraph(emptySummary)]);
  }

  const fields: FormFieldSnapshot[] = Array.isArray(formSchema?.fields)
    ? (formSchema.fields as FormFieldSnapshot[]).filter((field) => typeof field?.key === 'string')
    : [];
  const fieldByKey = new Map(fields.map((field) => [field.key as string, field]));

  // One table per section, in form order; a form without sections stays a single table.
  const tables: Array<{ label?: string; keys: string[] }> = [];
  for (const group of groupFormElementsBySection(fields)) {
    const keys = group.elements
      .filter(
        (element) =>
          typeof element?.key === 'string' &&
          getFieldElementKind(element.type) === 'input' &&
          element.key in payload
      )
      .map((element) => element.key as string);
    if (keys.length === 0) {
      continue;
    }
    tables.push({ label: group.section ? elementLabel(group.section) : undefined, keys });
  }

  // Answers the schema does not describe (a key removed from a later draft) still show up.
  const undescribedKeys = Object.keys(payload).filter((key) => !fieldByKey.has(key));
  if (undescribedKeys.length > 0) {
    const last = tables[tables.length - 1];
    if (last && last.label === undefined) {
      last.keys.push(...undescribedKeys);
    } else {
      tables.push({ keys: undescribedKeys });
    }
  }

  if (tables.length === 0) {
    blocks.push(paragraph(emptySummary));
    return JSON.stringify(blocks);
  }

  for (const table of tables) {
    if (table.label) {
      blocks.push(paragraph(table.label, true));
    }
    blocks.push({
      type: 'table',
      content: {
        type: 'tableContent',
        rows: table.keys.map((key) => {
          const field = fieldByKey.get(key);
          const label = typeof field?.label === 'string' && field.label.trim() ? field.label.trim() : key;
          return { cells: [textCell(label, true), textCell(describeAnswer(field, payload[key], text.format))] };
        }),
      },
    });
  }
  return JSON.stringify(blocks);
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
      // `context.knex` is normally the portal submission's open transaction. The ticket work
      // runs in a savepoint so a ticket failure (e.g. a ticket-number unique violation) rolls
      // back only the ticket and the caller can still record the 'failed' outcome. After-commit
      // hooks are only run by the transaction-owning frame, never for a savepoint, so
      // TICKET_CREATED is registered on the outer transaction once the savepoint has succeeded.
      // With a plain Knex there is no outer transaction: withTransaction owns the commit.
      const outerIsTransaction = typeof (context.knex as unknown as { commit?: unknown }).commit === 'function';
      let outerTrx: Knex.Transaction | undefined = outerIsTransaction
        ? (context.knex as unknown as Knex.Transaction)
        : undefined;
      const runInTicketFrame = <T,>(work: (trx: Knex.Transaction) => Promise<T>): Promise<T> =>
        outerIsTransaction
          ? (context.knex as unknown as Knex.Transaction).transaction(work)
          : withTransaction(context.knex, async (trx) => {
              outerTrx = trx;
              return work(trx);
            });

      return await runInTicketFrame(async (trx) => {
        const db = tenantDb(trx, context.tenant);
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
            await db.table('boards')
              .where({ is_default: true })
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

        // R4/R6: one rule resolves the priority with the Impact/Urgency pair for this board.
        // Impact × Urgency decides the priority only on a board that uses ITIL priorities and is
        // found by `itil_priority_level` (D8), never by a `P{n} -` name; on a board with the
        // tenant's own priorities neither value is stored. Nobody watches a service request being
        // executed, so a configured priority that does not fit the board falls back to the board's
        // default (R7) rather than failing the request.
        const resolvedPriority = await resolveTicketPriorityFields(trx, context.tenant, {
          boardId,
          priorityId: configuredPriorityId ?? null,
          itilImpact: configuredItilImpact ?? null,
          itilUrgency: configuredItilUrgency ?? null,
          policy: 'fallback',
        });
        const priorityId = resolvedPriority.priority_id ?? undefined;

        if (!priorityId) {
          return {
            status: 'failed',
            errorSummary: 'No ticket priority is available for ticket-only execution.',
          } as const;
        }

        // Once per execution, on the provider's transaction (no second pool connection). The locale is
        // the tenant's default, not the requester's: the subject is a shared record read by technicians.
        const locale = await getTenantDefaultLocale(context.tenant, 'internal', trx);
        const { t } = await getServerTranslation(locale, 'common');
        const text: TicketTextContext = {
          formSchema: context.formSchema,
          payload: context.payload,
          format: { locale, yes: t('yes', { defaultValue: 'Yes' }), no: t('no', { defaultValue: 'No' }) },
        };
        const title = buildTicketTitle(text, context.definitionId, context.config);
        const description = buildTicketDescription(text, context.config);

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
            itil_impact: resolvedPriority.itil_impact ?? undefined,
            itil_urgency: resolvedPriority.itil_urgency ?? undefined,
            entered_by: context.requesterUserId,
            source: 'client_portal',
            ticket_origin: 'client_portal',
          },
          context.tenant,
          trx,
          // R6: nobody watches a service request execute, so a configured category that is not the
          // board's is dropped rather than failing the request (the priority is already resolved).
          { boardFieldPolicy: 'fallback' },
          ticketCreatedPublishedByCaller('published on the owning transaction after the savepoint succeeds'),
          undefined,
          context.requesterUserId,
          1,
          { serviceRequestSubmissionId: context.submissionId }
        );

        await new WorkflowEventPublisher({ transaction: outerTrx! }).publishTicketCreated({
          tenantId: context.tenant,
          ticketId: ticket.ticket_id,
          userId: context.requesterUserId,
          metadata: {
            source: 'client_portal',
            board_id: boardId,
            priority_id: priorityId,
            client_id: context.clientId,
            // Ticket-only service requests never sent a client new-ticket notification
            // before TICKET_CREATED became mandatory; keep that (see contactSuppressedTicketCreation).
            suppressContactNotifications: true,
          },
        });

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
