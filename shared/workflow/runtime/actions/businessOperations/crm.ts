import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { withWorkflowJsonSchemaMetadata } from '../../jsonSchemaMetadata';
import { getWorkflowEmailProvider } from '../../registries/workflowEmailRegistry';
import QuoteActivity from '../../../../../packages/billing/src/models/quoteActivity';
import { getQuoteApprovalWorkflowSettings } from '../../../../../packages/billing/src/lib/quoteApprovalSettings';
import {
  uuidSchema,
  isoDateTimeSchema,
  actionProvidedKey,
  withTenantTransaction,
  requirePermission,
  writeRunAudit,
  throwActionError,
  rethrowAsStandardError,
  type TenantTxContext,
} from './shared';
import { buildInteractionLoggedPayload } from '../../../streams/domainEventBuilders/crmInteractionNoteEventBuilders';

const WORKFLOW_PICKER_HINTS = {
  client: 'Search clients',
  contact: 'Search contacts',
  ticket: 'Search tickets',
  user: 'Search users',
} as const;

const withWorkflowPicker = <T extends z.ZodTypeAny>(
  schema: T,
  description: string,
  kind: keyof typeof WORKFLOW_PICKER_HINTS,
  dependencies?: string[]
): T =>
  withWorkflowJsonSchemaMetadata(schema, description, {
    'x-workflow-picker-kind': kind,
    'x-workflow-picker-dependencies': dependencies,
    'x-workflow-picker-fixed-value-hint': WORKFLOW_PICKER_HINTS[kind],
    'x-workflow-picker-allow-dynamic-reference': true,
  });

const nullableUuidSchema = z.union([uuidSchema, z.null()]);
const visibilitySchema = z.enum(['internal', 'client_visible']);
const onEmptySchema = z.enum(['return_empty', 'error']);

const activitySummarySchema = z.object({
  activity_id: uuidSchema,
  type_id: uuidSchema,
  type_name: z.string().nullable(),
  status_id: nullableUuidSchema,
  status_name: z.string().nullable(),
  client_id: nullableUuidSchema,
  client_name: z.string().nullable(),
  contact_id: nullableUuidSchema,
  contact_name: z.string().nullable(),
  ticket_id: nullableUuidSchema,
  ticket_number: z.string().nullable(),
  title: z.string().nullable(),
  notes_preview: z.string().nullable(),
  interaction_date: isoDateTimeSchema,
  start_time: isoDateTimeSchema.nullable(),
  end_time: isoDateTimeSchema.nullable(),
  duration: z.number().int().nullable(),
  user_id: nullableUuidSchema,
  user_name: z.string().nullable(),
  visibility: z.string().nullable(),
  category: z.string().nullable(),
  tags: z.array(z.string()).nullable(),
});

const quoteSummarySchema = z.object({
  quote_id: uuidSchema,
  quote_number: z.string().nullable(),
  status: z.string().nullable(),
  client_id: nullableUuidSchema,
  title: z.string(),
});

const findActivitiesInputSchema = z
  .object({
    client_id: withWorkflowPicker(uuidSchema.optional(), 'Optional client id filter', 'client'),
    contact_id: withWorkflowPicker(uuidSchema.optional(), 'Optional contact id filter', 'contact', ['client_id']),
    ticket_id: withWorkflowPicker(uuidSchema.optional(), 'Optional ticket id filter', 'ticket'),
    user_id: withWorkflowPicker(uuidSchema.optional(), 'Optional owner user id filter', 'user'),
    type_id: uuidSchema.optional().describe('Optional interaction type id filter'),
    status_id: uuidSchema.optional().describe('Optional interaction status id filter'),
    date_from: isoDateTimeSchema.optional(),
    date_to: isoDateTimeSchema.optional(),
    limit: z.number().int().positive().max(200).default(25),
    on_empty: onEmptySchema.default('return_empty'),
  })
  .superRefine((value, refinementCtx) => {
    const hasMeaningfulFilter = Boolean(
      value.client_id ||
      value.contact_id ||
      value.ticket_id ||
      value.user_id ||
      value.type_id ||
      value.status_id ||
      value.date_from ||
      value.date_to
    );

    if (!hasMeaningfulFilter) {
      refinementCtx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one filter or date range is required',
      });
    }

    if (value.date_from && value.date_to && new Date(value.date_from).getTime() > new Date(value.date_to).getTime()) {
      refinementCtx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'date_from must be less than or equal to date_to',
      });
    }
  });

const updateActivityPatchSchema = z
  .object({
    title: z.string().min(1).optional(),
    notes: z.string().nullable().optional(),
    status_id: uuidSchema.nullable().optional(),
    visibility: visibilitySchema.optional(),
    category: z.string().nullable().optional(),
    tags: z.array(z.string().min(1)).nullable().optional(),
    interaction_date: isoDateTimeSchema.optional(),
    start_time: isoDateTimeSchema.nullable().optional(),
    end_time: isoDateTimeSchema.nullable().optional(),
    duration: z.number().int().nonnegative().nullable().optional(),
    type_id: uuidSchema.optional(),
  })
  .superRefine((value, refinementCtx) => {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      refinementCtx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'patch must include at least one editable field',
      });
      return;
    }

    const hasDefined = keys.some((key) => (value as Record<string, unknown>)[key] !== undefined);
    if (!hasDefined) {
      refinementCtx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'patch must include at least one defined value',
      });
    }
  });

const scheduleActivityInputSchema = z
  .object({
    client_id: withWorkflowPicker(uuidSchema.optional(), 'Optional client id. Required when contact_id is omitted.', 'client'),
    contact_id: withWorkflowPicker(uuidSchema.optional(), 'Optional contact id. Resolves client when client_id is omitted.', 'contact', ['client_id']),
    ticket_id: withWorkflowPicker(uuidSchema.optional(), 'Optional ticket id to link the scheduled activity', 'ticket'),
    type_id: uuidSchema.describe('Interaction type id (system or tenant type)'),
    title: z.string().min(1),
    notes: z.string().optional(),
    status_id: uuidSchema.optional(),
    start_time: isoDateTimeSchema,
    end_time: isoDateTimeSchema.optional(),
    duration: z.number().int().nonnegative().optional(),
    visibility: visibilitySchema.optional(),
    category: z.string().optional(),
    tags: z.array(z.string().min(1)).optional(),
    assigned_user_id: withWorkflowPicker(uuidSchema.optional(), 'Optional assigned user id. Defaults to workflow actor.', 'user'),
    owner_user_id: withWorkflowPicker(uuidSchema.optional(), 'Optional owner user id. Defaults to workflow actor.', 'user'),
    idempotency_key: z.string().optional().describe('Optional external idempotency key'),
  })
  .superRefine((value, refinementCtx) => {
    if (!value.client_id && !value.contact_id) {
      refinementCtx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'client_id or contact_id is required',
      });
    }

    if (value.end_time && new Date(value.start_time).getTime() > new Date(value.end_time).getTime()) {
      refinementCtx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'start_time must be less than or equal to end_time',
      });
    }
  });

const sendQuoteInputSchema = z.object({
  quote_id: uuidSchema,
  email_addresses: z.array(z.string().email()).optional(),
  subject: z.string().optional(),
  message: z.string().optional(),
  no_op_if_already_sent: z.boolean().default(true),
});

function asIsoString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

function normalizeTags(value: unknown): string[] | null {
  if (!value) return null;
  if (Array.isArray(value)) {
    return value.map((tag) => String(tag).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map((tag) => String(tag).trim()).filter(Boolean);
      }
    } catch {
      return value.trim() ? [value.trim()] : null;
    }
  }
  return null;
}

function computeNotesPreview(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return normalized.length > 180 ? `${normalized.slice(0, 180)}…` : normalized;
}

function coalesceInteractionTypeName(row: Record<string, unknown>): string | null {
  const tenantTypeName = row.tenant_type_name;
  if (typeof tenantTypeName === 'string' && tenantTypeName.trim()) return tenantTypeName;
  const systemTypeName = row.system_type_name;
  if (typeof systemTypeName === 'string' && systemTypeName.trim()) return systemTypeName;
  return null;
}

function coalesceUserName(row: Record<string, unknown>): string | null {
  const firstName = typeof row.user_first_name === 'string' ? row.user_first_name.trim() : '';
  const lastName = typeof row.user_last_name === 'string' ? row.user_last_name.trim() : '';
  const combined = [firstName, lastName].filter(Boolean).join(' ').trim();
  if (combined) return combined;
  if (typeof row.user_email === 'string' && row.user_email.trim()) return row.user_email.trim();
  return null;
}

function toActivitySummary(row: Record<string, unknown>) {
  const interactionDate = asIsoString(row.interaction_date);
  if (!interactionDate) {
    throw new Error('interaction_date is required for activity summary');
  }

  return activitySummarySchema.parse({
    activity_id: row.interaction_id,
    type_id: row.type_id,
    type_name: coalesceInteractionTypeName(row),
    status_id: row.status_id ?? null,
    status_name: typeof row.status_name === 'string' ? row.status_name : null,
    client_id: row.client_id ?? null,
    client_name: typeof row.client_name === 'string' ? row.client_name : null,
    contact_id: row.contact_name_id ?? null,
    contact_name: typeof row.contact_full_name === 'string' ? row.contact_full_name : null,
    ticket_id: row.ticket_id ?? null,
    ticket_number: row.ticket_number == null ? null : String(row.ticket_number),
    title: typeof row.title === 'string' ? row.title : null,
    notes_preview: computeNotesPreview(row.notes),
    interaction_date: interactionDate,
    start_time: asIsoString(row.start_time),
    end_time: asIsoString(row.end_time),
    duration: typeof row.duration === 'number' ? row.duration : row.duration == null ? null : Number(row.duration),
    user_id: row.user_id ?? null,
    user_name: coalesceUserName(row),
    visibility: typeof row.visibility === 'string' ? row.visibility : null,
    category: typeof row.category === 'string' ? row.category : null,
    tags: normalizeTags(row.tags),
  });
}

function collectChangedFields(
  before: z.infer<typeof activitySummarySchema>,
  after: z.infer<typeof activitySummarySchema>,
  requestedPatch: Record<string, unknown>
): string[] {
  const patchFieldToSummaryField = new Map<string, keyof z.infer<typeof activitySummarySchema>>([
    ['title', 'title'],
    ['notes', 'notes_preview'],
    ['status_id', 'status_id'],
    ['visibility', 'visibility'],
    ['category', 'category'],
    ['tags', 'tags'],
    ['interaction_date', 'interaction_date'],
    ['start_time', 'start_time'],
    ['end_time', 'end_time'],
    ['duration', 'duration'],
    ['type_id', 'type_id'],
  ]);

  const changed = new Set<string>();

  for (const key of Object.keys(requestedPatch)) {
    const mappedField = patchFieldToSummaryField.get(key);
    if (!mappedField) continue;
    const beforeValue = before[mappedField];
    const afterValue = after[mappedField];
    if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
      changed.add(key);
    }
  }

  return [...changed].sort((left, right) => left.localeCompare(right));
}

async function validateInteractionTypeId(
  ctx: any,
  tx: TenantTxContext,
  typeId: string,
  fieldName: 'type_id'
): Promise<void> {
  const [tenantType, systemType] = await Promise.all([
    tx.trx('interaction_types').where({ tenant: tx.tenantId, type_id: typeId }).first(),
    tx.trx('system_interaction_types').where({ type_id: typeId }).first(),
  ]);

  if (tenantType || systemType) {
    return;
  }

  throwActionError(ctx, {
    category: 'ValidationError',
    code: 'VALIDATION_ERROR',
    message: `${fieldName} is not a valid interaction type id for this tenant`,
    details: { [fieldName]: typeId },
  });
}

async function validateInteractionStatusId(
  ctx: any,
  tx: TenantTxContext,
  statusId: string,
  fieldName: 'status_id'
): Promise<void> {
  const status = await tx.trx('statuses')
    .where({ tenant: tx.tenantId, status_id: statusId, status_type: 'interaction' })
    .first();

  if (status) {
    return;
  }

  throwActionError(ctx, {
    category: 'ValidationError',
    code: 'VALIDATION_ERROR',
    message: `${fieldName} is not a valid interaction status for this tenant`,
    details: { [fieldName]: statusId },
  });
}

async function getDefaultInteractionStatusId(ctx: any, tx: TenantTxContext): Promise<string> {
  const status = await tx.trx('statuses')
    .where({
      tenant: tx.tenantId,
      status_type: 'interaction',
      is_default: true,
    })
    .first();

  if (status?.status_id) {
    return status.status_id;
  }

  throwActionError(ctx, {
    category: 'ActionError',
    code: 'INTERNAL_ERROR',
    message: 'No default interaction status found. Configure an interaction default status to use crm.schedule_activity.',
  });
}

async function fetchActivityDetailRow(
  trx: Knex.Transaction,
  tenantId: string,
  activityId: string
): Promise<Record<string, unknown> | null> {
  return await trx('interactions as i')
    .leftJoin('clients as c', function joinClients() {
      this.on('i.tenant', 'c.tenant').andOn('i.client_id', 'c.client_id');
    })
    .leftJoin('contacts as ct', function joinContacts() {
      this.on('i.tenant', 'ct.tenant').andOn('i.contact_name_id', 'ct.contact_name_id');
    })
    .leftJoin('tickets as tk', function joinTickets() {
      this.on('i.tenant', 'tk.tenant').andOn('i.ticket_id', 'tk.ticket_id');
    })
    .leftJoin('users as u', function joinUsers() {
      this.on('i.tenant', 'u.tenant').andOn('i.user_id', 'u.user_id');
    })
    .leftJoin('statuses as st', function joinStatuses() {
      this.on('i.tenant', 'st.tenant').andOn('i.status_id', 'st.status_id');
    })
    .leftJoin('interaction_types as it', function joinInteractionTypes() {
      this.on('i.tenant', 'it.tenant').andOn('i.type_id', 'it.type_id');
    })
    .leftJoin('system_interaction_types as sit', 'i.type_id', 'sit.type_id')
    .where({ 'i.tenant': tenantId, 'i.interaction_id': activityId })
    .select(
      'i.interaction_id',
      'i.type_id',
      'i.status_id',
      'i.client_id',
      'i.contact_name_id',
      'i.ticket_id',
      'i.title',
      'i.notes',
      'i.interaction_date',
      'i.start_time',
      'i.end_time',
      'i.duration',
      'i.user_id',
      'i.visibility',
      'i.category',
      'i.tags',
      'c.client_name',
      'ct.full_name as contact_full_name',
      'tk.ticket_number',
      'u.first_name as user_first_name',
      'u.last_name as user_last_name',
      'u.email as user_email',
      'st.name as status_name',
      'it.type_name as tenant_type_name',
      'sit.type_name as system_type_name'
    )
    .first() as Record<string, unknown> | null;
}

async function fetchActivitySummary(
  ctx: any,
  tx: TenantTxContext,
  activityId: string
): Promise<z.infer<typeof activitySummarySchema>> {
  const row = await fetchActivityDetailRow(tx.trx, tx.tenantId, activityId);
  if (!row) {
    throwActionError(ctx, {
      category: 'ActionError',
      code: 'NOT_FOUND',
      message: 'Activity not found',
      details: { activity_id: activityId },
    });
  }

  return toActivitySummary(row);
}

const maybeWorkflowActor = (userId: string): { actorType: 'USER'; actorUserId: string } => ({
  actorType: 'USER',
  actorUserId: userId,
});

async function publishWorkflowDomainEvent(params: {
  eventType: string;
  payload: Record<string, unknown>;
  tenantId: string;
  occurredAt: string;
  actorUserId: string;
  idempotencyKey: string;
}): Promise<void> {
  try {
    const publishers = (await import('@alga-psa/event-bus/publishers')) as unknown as {
      publishWorkflowEvent?: (value: {
        eventType: string;
        payload: Record<string, unknown>;
        ctx: {
          tenantId: string;
          occurredAt: string;
          actor: { actorType: 'USER'; actorUserId: string };
        };
        idempotencyKey: string;
      }) => Promise<unknown>;
    };

    if (!publishers.publishWorkflowEvent) return;

    await publishers.publishWorkflowEvent({
      eventType: params.eventType,
      payload: params.payload,
      ctx: {
        tenantId: params.tenantId,
        occurredAt: params.occurredAt,
        actor: maybeWorkflowActor(params.actorUserId),
      },
      idempotencyKey: params.idempotencyKey,
    });
  } catch {
    // Best-effort publication.
  }
}

async function maybeStoreQuotePdfBestEffort(
  trx: Knex.Transaction,
  tenantId: string,
  quote: Record<string, unknown>,
  actorUserId: string
): Promise<void> {
  try {
    const [{ createPDFGenerationService }, documentsModule] = await Promise.all([
      import('../../../../../packages/billing/src/services'),
      import('@alga-psa/documents/models'),
    ]);

    const fileRecord = await createPDFGenerationService(tenantId).generateAndStore({
      quoteId: String(quote.quote_id),
      quoteNumber: typeof quote.quote_number === 'string' ? quote.quote_number : undefined,
      userId: actorUserId,
    });

    const documentModel = (documentsModule as unknown as {
      Document: {
        insert: (trx: Knex.Transaction, row: Record<string, unknown>) => Promise<unknown>;
      };
      DocumentAssociation: {
        create: (trx: Knex.Transaction, row: Record<string, unknown>) => Promise<unknown>;
      };
    }).Document;

    const documentAssociation = (documentsModule as unknown as {
      DocumentAssociation: {
        create: (trx: Knex.Transaction, row: Record<string, unknown>) => Promise<unknown>;
      };
    }).DocumentAssociation;

    const documentId = uuidv4();

    await documentModel.insert(trx, {
      document_id: documentId,
      document_name: `Quote_${String(quote.quote_number ?? quote.quote_id)}.pdf`,
      type_id: null,
      user_id: actorUserId,
      created_by: actorUserId,
      order_number: 0,
      tenant: tenantId,
      file_id: fileRecord.file_id,
      storage_path: fileRecord.storage_path,
      mime_type: 'application/pdf',
      file_size: fileRecord.file_size,
      folder_path: '/Quotes/Generated',
      is_client_visible: true,
    });

    await documentAssociation.create(trx, {
      document_id: documentId,
      entity_id: String(quote.quote_id),
      entity_type: 'quote',
      tenant: tenantId,
    });
  } catch {
    // Best-effort PDF storage.
  }
}

async function resolveQuoteRecipients(
  trx: Knex.Transaction,
  tenantId: string,
  quote: Record<string, unknown>,
  explicitRecipients: string[]
): Promise<string[]> {
  const [contactRecipient, clientRecipient] = await Promise.all([
    quote.contact_id
      ? trx('contacts')
        .select('email')
        .where({ tenant: tenantId, contact_name_id: quote.contact_id })
        .first<{ email?: string | null }>()
      : Promise.resolve(null),
    quote.client_id
      ? trx('clients')
        .select('billing_email')
        .where({ tenant: tenantId, client_id: quote.client_id })
        .first<{ billing_email?: string | null }>()
      : Promise.resolve(null),
  ]);

  return Array.from(
    new Set(
      [...explicitRecipients, contactRecipient?.email ?? '', clientRecipient?.billing_email ?? '']
        .map((email) => String(email).trim())
        .filter(Boolean)
    )
  );
}

async function sendQuoteEmailBestEffort(params: {
  tenantId: string;
  quote: Record<string, unknown>;
  actorUserId: string;
  recipients: string[];
  subject?: string;
  message?: string;
}): Promise<{ emailSent: boolean; messageId: string | null }> {
  if (params.recipients.length === 0) {
    return { emailSent: false, messageId: null };
  }

  try {
    const { TenantEmailService, StaticTemplateProcessor } = getWorkflowEmailProvider();
    const service = TenantEmailService.getInstance(params.tenantId);

    const portalBaseUrl = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const portalLink = `${portalBaseUrl}/client-portal/billing?tab=quotes`;
    const defaultSubject = `Quote ${String(params.quote.quote_number ?? params.quote.quote_id)} is ready`;
    const defaultText = params.message?.trim()
      ? `${params.message.trim()}\n\nView quote: ${portalLink}`
      : `Your quote is available in the client portal.\n\nView quote: ${portalLink}`;
    const defaultHtml = `<p>${params.message?.trim() || 'Your quote is available in the client portal.'}</p><p><a href=\"${portalLink}\">View quote</a></p>`;

    const templateProcessor = new StaticTemplateProcessor(
      params.subject?.trim() || defaultSubject,
      defaultHtml,
      defaultText
    );

    const emailResult = await service.sendEmail({
      tenantId: params.tenantId,
      to: params.recipients.map((email) => ({ email })),
      templateProcessor,
      templateData: {},
      entityType: 'quote',
      entityId: String(params.quote.quote_id),
      contactId: (params.quote.contact_id as string | null | undefined) ?? undefined,
      userId: params.actorUserId,
    } as any);

    return {
      emailSent: Boolean(emailResult.success),
      messageId:
        typeof (emailResult as Record<string, unknown>).messageId === 'string'
          ? ((emailResult as Record<string, unknown>).messageId as string)
          : null,
    };
  } catch {
    return { emailSent: false, messageId: null };
  }
}

function toQuoteSummary(quote: Record<string, unknown>) {
  return quoteSummarySchema.parse({
    quote_id: quote.quote_id,
    quote_number: quote.quote_number == null ? null : String(quote.quote_number),
    status: quote.status == null ? null : String(quote.status),
    client_id: quote.client_id ?? null,
    title: String(quote.title ?? ''),
  });
}

export function registerCrmActions(): void {
  const registry = getActionRegistryV2();

  // ---------------------------------------------------------------------------
  // A18 — crm.create_activity_note
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'crm.create_activity_note',
    version: 1,
    inputSchema: z.object({
      target: z.object({
        type: z.enum(['client', 'contact', 'ticket', 'project']).describe('Target type'),
        id: uuidSchema.describe('Target id')
      }),
      body: z.string().min(1).describe('Note body'),
      visibility: visibilitySchema.default('internal'),
      tags: z.array(z.string()).optional(),
      category: z.string().optional()
    }),
    outputSchema: z.object({
      note_id: uuidSchema,
      created_at: isoDateTimeSchema,
      target_type: z.string(),
      target_id: uuidSchema,
      target_summary: z.record(z.unknown()).nullable()
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Create Activity Note', category: 'Business Operations', description: 'Create a CRM activity note (interaction)' },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      const permissionResource =
        input.target.type === 'client'
          ? 'client'
          : input.target.type === 'contact'
            ? 'contact'
            : input.target.type === 'ticket'
              ? 'ticket'
              : 'project';
      await requirePermission(ctx, tx, { resource: permissionResource, action: 'update' });

      if (input.visibility === 'client_visible' && input.target.type === 'project') {
        throwActionError(ctx, {
          category: 'ValidationError',
          code: 'VALIDATION_ERROR',
          message: 'client_visible notes are not supported for project targets'
        });
      }

      let clientId: string | null = null;
      let contactId: string | null = null;
      let ticketId: string | null = null;
      let projectId: string | null = null;
      let targetSummary: Record<string, unknown> | null = null;

      if (input.target.type === 'client') {
        const client = await tx.trx('clients').where({ tenant: tx.tenantId, client_id: input.target.id }).first();
        if (!client) throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Client not found' });
        clientId = input.target.id;
        targetSummary = { client_id: input.target.id, client_name: client.client_name ?? null };
      } else if (input.target.type === 'contact') {
        const contact = await tx.trx('contacts').where({ tenant: tx.tenantId, contact_name_id: input.target.id }).first();
        if (!contact) throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Contact not found' });
        contactId = input.target.id;
        clientId = (contact.client_id as string | null) ?? null;
        targetSummary = { contact_id: input.target.id, full_name: contact.full_name ?? null, email: contact.email ?? null, client_id: clientId };
      } else if (input.target.type === 'ticket') {
        const ticket = await tx.trx('tickets').where({ tenant: tx.tenantId, ticket_id: input.target.id }).first();
        if (!ticket) throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Ticket not found' });
        ticketId = input.target.id;
        clientId = (ticket.client_id as string | null) ?? null;
        contactId = (ticket.contact_name_id as string | null) ?? null;
        targetSummary = { ticket_id: input.target.id, ticket_number: ticket.ticket_number ?? null, title: ticket.title ?? null, client_id: clientId };
      } else if (input.target.type === 'project') {
        const project = await tx.trx('projects').where({ tenant: tx.tenantId, project_id: input.target.id }).first();
        if (!project) throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Project not found' });
        projectId = input.target.id;
        clientId = (project.client_id as string | null) ?? null;
        targetSummary = { project_id: input.target.id, project_name: project.project_name ?? null, client_id: clientId };
      }

      const noteType = await tx.trx('system_interaction_types').where({ type_name: 'Note' }).first();
      if (!noteType) throwActionError(ctx, { category: 'ActionError', code: 'INTERNAL_ERROR', message: 'System interaction type Note missing' });

      const noteId = uuidv4();
      const nowIso = new Date().toISOString();
      await tx.trx('interactions').insert({
        tenant: tx.tenantId,
        interaction_id: noteId,
        type_id: noteType.type_id,
        contact_name_id: contactId,
        client_id: clientId,
        ticket_id: ticketId,
        project_id: projectId,
        user_id: tx.actorUserId,
        title: input.category ?? 'Note',
        notes: input.body,
        interaction_date: nowIso,
        start_time: nowIso,
        end_time: nowIso,
        duration: 0,
        status_id: null,
        visibility: input.visibility,
        category: input.category ?? null,
        tags: input.tags ?? null
      });

      await writeRunAudit(ctx, tx, {
        operation: 'workflow_action:crm.create_activity_note',
        changedData: { interaction_id: noteId, target: input.target },
        details: { action_id: 'crm.create_activity_note', action_version: 1, note_id: noteId }
      });

      return { note_id: noteId, created_at: nowIso, target_type: input.target.type, target_id: input.target.id, target_summary: targetSummary };
    })
  });

  // ---------------------------------------------------------------------------
  // crm.find_activities
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'crm.find_activities',
    version: 1,
    inputSchema: findActivitiesInputSchema,
    outputSchema: z.object({
      activities: z.array(activitySummarySchema),
      count: z.number().int(),
      matched_filters: z.record(z.unknown()),
    }),
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Find CRM Activities',
      category: 'Business Operations',
      description: 'Find CRM activities by client/contact/ticket/user/type/status and date filters',
    },
    handler: async (input, ctx) =>
      withTenantTransaction(ctx, async (tx) => {
        // Permission mapping decision: interactions are CRM activity records linked primarily to clients.
        // Always require client:read. Add contact/ticket read when those scoped filters are supplied.
        await requirePermission(ctx, tx, { resource: 'client', action: 'read' });
        if (input.contact_id) {
          await requirePermission(ctx, tx, { resource: 'contact', action: 'read' });
        }
        if (input.ticket_id) {
          await requirePermission(ctx, tx, { resource: 'ticket', action: 'read' });
        }

        const query = tx.trx('interactions as i')
          .leftJoin('clients as c', function joinClients() {
            this.on('i.tenant', 'c.tenant').andOn('i.client_id', 'c.client_id');
          })
          .leftJoin('contacts as ct', function joinContacts() {
            this.on('i.tenant', 'ct.tenant').andOn('i.contact_name_id', 'ct.contact_name_id');
          })
          .leftJoin('tickets as tk', function joinTickets() {
            this.on('i.tenant', 'tk.tenant').andOn('i.ticket_id', 'tk.ticket_id');
          })
          .leftJoin('users as u', function joinUsers() {
            this.on('i.tenant', 'u.tenant').andOn('i.user_id', 'u.user_id');
          })
          .leftJoin('statuses as st', function joinStatuses() {
            this.on('i.tenant', 'st.tenant').andOn('i.status_id', 'st.status_id');
          })
          .leftJoin('interaction_types as it', function joinInteractionTypes() {
            this.on('i.tenant', 'it.tenant').andOn('i.type_id', 'it.type_id');
          })
          .leftJoin('system_interaction_types as sit', 'i.type_id', 'sit.type_id')
          .where('i.tenant', tx.tenantId)
          .select(
            'i.interaction_id',
            'i.type_id',
            'i.status_id',
            'i.client_id',
            'i.contact_name_id',
            'i.ticket_id',
            'i.title',
            'i.notes',
            'i.interaction_date',
            'i.start_time',
            'i.end_time',
            'i.duration',
            'i.user_id',
            'i.visibility',
            'i.category',
            'i.tags',
            'c.client_name',
            'ct.full_name as contact_full_name',
            'tk.ticket_number',
            'u.first_name as user_first_name',
            'u.last_name as user_last_name',
            'u.email as user_email',
            'st.name as status_name',
            'it.type_name as tenant_type_name',
            'sit.type_name as system_type_name'
          );

        if (input.client_id) query.andWhere('i.client_id', input.client_id);
        if (input.contact_id) query.andWhere('i.contact_name_id', input.contact_id);
        if (input.ticket_id) query.andWhere('i.ticket_id', input.ticket_id);
        if (input.user_id) query.andWhere('i.user_id', input.user_id);
        if (input.type_id) query.andWhere('i.type_id', input.type_id);
        if (input.status_id) query.andWhere('i.status_id', input.status_id);
        if (input.date_from) query.andWhere('i.interaction_date', '>=', input.date_from);
        if (input.date_to) query.andWhere('i.interaction_date', '<=', input.date_to);

        query.orderBy('i.interaction_date', 'desc').limit(input.limit);

        let rows: Array<Record<string, unknown>>;
        try {
          rows = await query;
        } catch (error) {
          rethrowAsStandardError(ctx, error);
        }

        const activities = rows.map((row) => toActivitySummary(row));
        if (activities.length === 0 && input.on_empty === 'error') {
          throwActionError(ctx, {
            category: 'ActionError',
            code: 'NOT_FOUND',
            message: 'No CRM activities matched the supplied filters',
          });
        }

        return {
          activities,
          count: activities.length,
          matched_filters: {
            client_id: input.client_id ?? null,
            contact_id: input.contact_id ?? null,
            ticket_id: input.ticket_id ?? null,
            user_id: input.user_id ?? null,
            type_id: input.type_id ?? null,
            status_id: input.status_id ?? null,
            date_from: input.date_from ?? null,
            date_to: input.date_to ?? null,
            limit: input.limit,
          },
        };
      }),
  });

  // ---------------------------------------------------------------------------
  // crm.update_activity
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'crm.update_activity',
    version: 1,
    inputSchema: z.object({
      activity_id: uuidSchema,
      patch: updateActivityPatchSchema,
      reason: z.string().optional(),
    }),
    outputSchema: z.object({
      activity_before: activitySummarySchema,
      activity_after: activitySummarySchema,
      changed_fields: z.array(z.string()),
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Update CRM Activity',
      category: 'Business Operations',
      description: 'Patch an existing CRM activity and return before/after differences',
    },
    handler: async (input, ctx) =>
      withTenantTransaction(ctx, async (tx) => {
        await requirePermission(ctx, tx, { resource: 'client', action: 'update' });

        const before = await fetchActivitySummary(ctx, tx, input.activity_id);

        if (input.patch.status_id) {
          await validateInteractionStatusId(ctx, tx, input.patch.status_id, 'status_id');
        }

        if (input.patch.type_id) {
          await validateInteractionTypeId(ctx, tx, input.patch.type_id, 'type_id');
        }

        const startForValidation = input.patch.start_time ?? before.start_time;
        const endForValidation = input.patch.end_time ?? before.end_time;
        if (startForValidation && endForValidation && new Date(startForValidation).getTime() > new Date(endForValidation).getTime()) {
          throwActionError(ctx, {
            category: 'ValidationError',
            code: 'VALIDATION_ERROR',
            message: 'start_time must be less than or equal to end_time',
          });
        }

        const updatePatch: Record<string, unknown> = {
          ...(input.patch.title !== undefined ? { title: input.patch.title } : {}),
          ...(input.patch.notes !== undefined ? { notes: input.patch.notes } : {}),
          ...(input.patch.status_id !== undefined ? { status_id: input.patch.status_id } : {}),
          ...(input.patch.visibility !== undefined ? { visibility: input.patch.visibility } : {}),
          ...(input.patch.category !== undefined ? { category: input.patch.category } : {}),
          ...(input.patch.tags !== undefined ? { tags: input.patch.tags } : {}),
          ...(input.patch.interaction_date !== undefined ? { interaction_date: input.patch.interaction_date } : {}),
          ...(input.patch.start_time !== undefined ? { start_time: input.patch.start_time } : {}),
          ...(input.patch.end_time !== undefined ? { end_time: input.patch.end_time } : {}),
          ...(input.patch.duration !== undefined ? { duration: input.patch.duration } : {}),
          ...(input.patch.type_id !== undefined ? { type_id: input.patch.type_id } : {}),
        };

        try {
          const updatedCount = await tx.trx('interactions')
            .where({ tenant: tx.tenantId, interaction_id: input.activity_id })
            .update(updatePatch);
          if (!updatedCount) {
            throwActionError(ctx, {
              category: 'ActionError',
              code: 'NOT_FOUND',
              message: 'Activity not found',
              details: { activity_id: input.activity_id },
            });
          }
        } catch (error) {
          rethrowAsStandardError(ctx, error);
        }

        const after = await fetchActivitySummary(ctx, tx, input.activity_id);
        const changedFields = collectChangedFields(before, after, input.patch as Record<string, unknown>);

        await writeRunAudit(ctx, tx, {
          operation: 'workflow_action:crm.update_activity',
          changedData: {
            activity_id: input.activity_id,
            changed_fields: changedFields,
            reason: input.reason ?? null,
            before: {
              status_id: before.status_id,
              type_id: before.type_id,
              title: before.title,
              visibility: before.visibility,
              category: before.category,
            },
            after: {
              status_id: after.status_id,
              type_id: after.type_id,
              title: after.title,
              visibility: after.visibility,
              category: after.category,
            },
          },
          details: {
            action_id: 'crm.update_activity',
            action_version: 1,
            activity_id: input.activity_id,
          },
        });

        return {
          activity_before: before,
          activity_after: after,
          changed_fields: changedFields,
        };
      }),
  });

  // ---------------------------------------------------------------------------
  // crm.schedule_activity
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'crm.schedule_activity',
    version: 1,
    inputSchema: scheduleActivityInputSchema,
    outputSchema: z.object({
      activity: activitySummarySchema,
    }),
    sideEffectful: true,
    idempotency: { mode: 'actionProvided', key: actionProvidedKey },
    ui: {
      label: 'Schedule CRM Activity',
      category: 'Business Operations',
      description: 'Schedule a follow-up CRM activity linked to client/contact/ticket context',
    },
    handler: async (input, ctx) =>
      withTenantTransaction(ctx, async (tx) => {
        await requirePermission(ctx, tx, { resource: 'client', action: 'update' });
        if (input.ticket_id) {
          await requirePermission(ctx, tx, { resource: 'ticket', action: 'read' });
        }

        let resolvedClientId = input.client_id ?? null;
        let resolvedContactId = input.contact_id ?? null;

        if (resolvedContactId) {
          const contact = await tx.trx('contacts')
            .where({ tenant: tx.tenantId, contact_name_id: resolvedContactId })
            .first();
          if (!contact) {
            throwActionError(ctx, {
              category: 'ActionError',
              code: 'NOT_FOUND',
              message: 'Contact not found',
              details: { contact_id: resolvedContactId },
            });
          }

          if (resolvedClientId && contact.client_id !== resolvedClientId) {
            throwActionError(ctx, {
              category: 'ValidationError',
              code: 'VALIDATION_ERROR',
              message: 'contact_id must belong to the selected client',
              details: { contact_id: resolvedContactId, client_id: resolvedClientId },
            });
          }

          resolvedClientId = (contact.client_id as string | null) ?? resolvedClientId;
        }

        if (!resolvedClientId) {
          throwActionError(ctx, {
            category: 'ValidationError',
            code: 'VALIDATION_ERROR',
            message: 'Unable to resolve a client from client_id/contact_id',
          });
        }

        const client = await tx.trx('clients').where({ tenant: tx.tenantId, client_id: resolvedClientId }).first();
        if (!client) {
          throwActionError(ctx, {
            category: 'ActionError',
            code: 'NOT_FOUND',
            message: 'Client not found',
            details: { client_id: resolvedClientId },
          });
        }

        if (input.ticket_id) {
          const ticket = await tx.trx('tickets').where({ tenant: tx.tenantId, ticket_id: input.ticket_id }).first();
          if (!ticket) {
            throwActionError(ctx, {
              category: 'ActionError',
              code: 'NOT_FOUND',
              message: 'Ticket not found',
              details: { ticket_id: input.ticket_id },
            });
          }

          if (ticket.client_id && ticket.client_id !== resolvedClientId) {
            throwActionError(ctx, {
              category: 'ValidationError',
              code: 'VALIDATION_ERROR',
              message: 'ticket_id must belong to the selected client',
              details: { ticket_id: input.ticket_id, client_id: resolvedClientId },
            });
          }

          if (resolvedContactId && ticket.contact_name_id && ticket.contact_name_id !== resolvedContactId) {
            throwActionError(ctx, {
              category: 'ValidationError',
              code: 'VALIDATION_ERROR',
              message: 'ticket_id contact does not match the selected contact_id',
              details: { ticket_id: input.ticket_id, contact_id: resolvedContactId },
            });
          }
        }

        await validateInteractionTypeId(ctx, tx, input.type_id, 'type_id');

        const statusId = input.status_id ?? (await getDefaultInteractionStatusId(ctx, tx));
        await validateInteractionStatusId(ctx, tx, statusId, 'status_id');

        const ownerUserId = input.assigned_user_id ?? input.owner_user_id ?? tx.actorUserId;
        const owner = await tx.trx('users').where({ tenant: tx.tenantId, user_id: ownerUserId }).first();
        if (!owner) {
          throwActionError(ctx, {
            category: 'ActionError',
            code: 'NOT_FOUND',
            message: 'Assigned user not found',
            details: { user_id: ownerUserId },
          });
        }

        const endTime = input.end_time ?? input.start_time;
        const derivedDuration =
          input.duration !== undefined
            ? input.duration
            : Math.max(0, Math.round((new Date(endTime).getTime() - new Date(input.start_time).getTime()) / 60000));

        const interactionId = uuidv4();

        try {
          await tx.trx('interactions').insert({
            tenant: tx.tenantId,
            interaction_id: interactionId,
            type_id: input.type_id,
            client_id: resolvedClientId,
            contact_name_id: resolvedContactId,
            ticket_id: input.ticket_id ?? null,
            user_id: ownerUserId,
            title: input.title,
            notes: input.notes ?? null,
            interaction_date: input.start_time,
            start_time: input.start_time,
            end_time: endTime,
            duration: derivedDuration,
            status_id: statusId,
            visibility: input.visibility ?? 'internal',
            category: input.category ?? null,
            tags: input.tags ?? null,
          });
        } catch (error) {
          rethrowAsStandardError(ctx, error);
        }

        const createdActivity = await fetchActivitySummary(ctx, tx, interactionId);
        const occurredAt = createdActivity.interaction_date;

        await publishWorkflowDomainEvent({
          eventType: 'INTERACTION_LOGGED',
          payload: buildInteractionLoggedPayload({
            interactionId,
            clientId: resolvedClientId,
            contactId: resolvedContactId ?? undefined,
            interactionType: createdActivity.type_name ?? createdActivity.type_id,
            interactionOccurredAt: occurredAt,
            loggedByUserId: ownerUserId,
            subject: input.title,
            outcome: createdActivity.status_name ?? undefined,
          }),
          tenantId: tx.tenantId,
          occurredAt,
          actorUserId: tx.actorUserId,
          idempotencyKey: `interaction_logged:${interactionId}`,
        });

        await writeRunAudit(ctx, tx, {
          operation: 'workflow_action:crm.schedule_activity',
          changedData: {
            activity_id: interactionId,
            client_id: resolvedClientId,
            contact_id: resolvedContactId,
            ticket_id: input.ticket_id ?? null,
            status_id: statusId,
            type_id: input.type_id,
            start_time: input.start_time,
            end_time: endTime,
            duration: derivedDuration,
            assigned_user_id: ownerUserId,
          },
          details: {
            action_id: 'crm.schedule_activity',
            action_version: 1,
            activity_id: interactionId,
          },
        });

        return {
          activity: createdActivity,
        };
      }),
  });

  // ---------------------------------------------------------------------------
  // crm.send_quote
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'crm.send_quote',
    version: 1,
    inputSchema: sendQuoteInputSchema,
    outputSchema: z.object({
      quote: quoteSummarySchema,
      previous_status: z.string().nullable(),
      new_status: z.string().nullable(),
      sent_at: isoDateTimeSchema.nullable(),
      recipients: z.array(z.string()),
      email_sent: z.boolean(),
      message_id: z.string().nullable(),
      no_op: z.boolean(),
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Send Quote',
      category: 'Business Operations',
      description: 'Send an existing quote to the client using current quote send semantics',
    },
    handler: async (input, ctx) =>
      withTenantTransaction(ctx, async (tx) => {
        await requirePermission(ctx, tx, { resource: 'billing', action: 'read' });
        await requirePermission(ctx, tx, { resource: 'billing', action: 'update' });

        const quote = await tx.trx('quotes').where({ tenant: tx.tenantId, quote_id: input.quote_id }).first();
        if (!quote) {
          throwActionError(ctx, {
            category: 'ActionError',
            code: 'NOT_FOUND',
            message: 'Quote not found',
            details: { quote_id: input.quote_id },
          });
        }

        if (quote.is_template) {
          throwActionError(ctx, {
            category: 'ValidationError',
            code: 'VALIDATION_ERROR',
            message: 'Quote templates cannot be sent to clients',
            details: { quote_id: input.quote_id },
          });
        }

        const previousStatus = quote.status == null ? null : String(quote.status);
        if (previousStatus === 'sent') {
          if (!input.no_op_if_already_sent) {
            throwActionError(ctx, {
              category: 'ValidationError',
              code: 'VALIDATION_ERROR',
              message: 'Quote is already sent; resend behavior is not supported by crm.send_quote v1',
              details: { quote_id: input.quote_id },
            });
          }

          const summary = toQuoteSummary(quote);
          await writeRunAudit(ctx, tx, {
            operation: 'workflow_action:crm.send_quote',
            changedData: {
              quote_id: input.quote_id,
              previous_status: previousStatus,
              new_status: previousStatus,
              no_op: true,
            },
            details: {
              action_id: 'crm.send_quote',
              action_version: 1,
              quote_id: input.quote_id,
            },
          });

          return {
            quote: summary,
            previous_status: previousStatus,
            new_status: previousStatus,
            sent_at: asIsoString(quote.sent_at),
            recipients: [],
            email_sent: false,
            message_id: null,
            no_op: true,
          };
        }

        const approvalSettings = await getQuoteApprovalWorkflowSettings(tx.trx, tx.tenantId);
        if (approvalSettings.approvalRequired) {
          if (previousStatus !== 'approved') {
            throwActionError(ctx, {
              category: 'ValidationError',
              code: 'VALIDATION_ERROR',
              message: 'Only approved quotes can be sent when quote approval is required',
            });
          }
        } else if (previousStatus !== 'draft' && previousStatus !== 'approved') {
          throwActionError(ctx, {
            category: 'ValidationError',
            code: 'VALIDATION_ERROR',
            message: 'Only draft or approved quotes can be sent',
          });
        }

        const sentAt = new Date().toISOString();
        await tx.trx('quotes')
          .where({ tenant: tx.tenantId, quote_id: input.quote_id })
          .update({
            status: 'sent',
            sent_at: sentAt,
            updated_by: tx.actorUserId,
            updated_at: sentAt,
          });

        const updatedQuote = await tx.trx('quotes').where({ tenant: tx.tenantId, quote_id: input.quote_id }).first();
        if (!updatedQuote) {
          throwActionError(ctx, {
            category: 'ActionError',
            code: 'NOT_FOUND',
            message: 'Quote not found after send transition',
            details: { quote_id: input.quote_id },
          });
        }

        await maybeStoreQuotePdfBestEffort(tx.trx, tx.tenantId, updatedQuote, tx.actorUserId);

        const recipients = await resolveQuoteRecipients(tx.trx, tx.tenantId, updatedQuote, input.email_addresses ?? []);
        const { emailSent, messageId } = await sendQuoteEmailBestEffort({
          tenantId: tx.tenantId,
          quote: updatedQuote,
          actorUserId: tx.actorUserId,
          recipients,
          subject: input.subject,
          message: input.message,
        });

        const activityDescription = emailSent && recipients.length > 0
          ? `Quote sent to ${recipients.join(', ')} and published in client portal`
          : 'Quote published in client portal';

        await QuoteActivity.create(tx.trx, tx.tenantId, {
          quote_id: input.quote_id,
          activity_type: 'sent',
          description: activityDescription,
          performed_by: tx.actorUserId,
          metadata: {
            recipients,
            email_sent: emailSent,
            message_id: messageId,
            workflow_source: 'crm.send_quote',
          },
        });

        await writeRunAudit(ctx, tx, {
          operation: 'workflow_action:crm.send_quote',
          changedData: {
            quote_id: input.quote_id,
            previous_status: previousStatus,
            new_status: 'sent',
            sent_at: sentAt,
            recipients,
            email_sent: emailSent,
            message_id: messageId,
          },
          details: {
            action_id: 'crm.send_quote',
            action_version: 1,
            quote_id: input.quote_id,
          },
        });

        return {
          quote: toQuoteSummary(updatedQuote),
          previous_status: previousStatus,
          new_status: 'sent',
          sent_at: sentAt,
          recipients,
          email_sent: emailSent,
          message_id: messageId,
          no_op: false,
        };
      }),
  });
}
