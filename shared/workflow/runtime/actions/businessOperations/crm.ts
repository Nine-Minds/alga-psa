import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { withWorkflowJsonSchemaMetadata } from '../../jsonSchemaMetadata';
import { getWorkflowEmailProvider } from '../../registries/workflowEmailRegistry';
import {
  Quote,
  QuoteActivity,
  QuoteItem,
  TagDefinition,
  TagMapping,
  convertQuoteToDraftContract,
  convertQuoteToDraftContractAndInvoice,
  convertQuoteToDraftInvoice,
  createQuoteItemSchema,
  createQuoteSchema,
  getQuoteApprovalWorkflowSettings,
  quoteStatusSchema,
} from './crmWorkerDal';
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
import { buildTagAppliedPayload, buildTagDefinitionCreatedPayload } from '../../../streams/domainEventBuilders/tagEventBuilders';
import {
  BuiltinAuthorizationKernelProvider,
  BundleAuthorizationKernelProvider,
  RequestLocalAuthorizationCache,
  createAuthorizationKernel,
  type AuthorizationSubject,
} from '@alga-psa/authorization/kernel';
import { resolveBundleNarrowingRulesForEvaluation } from '@alga-psa/authorization/bundles/service';
import type { TaggedEntityType } from '@alga-psa/types';

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
const supportedActivityTagTargetTypes = ['ticket', 'contact', 'client'] as const;
type SupportedActivityTagTargetType = Extract<TaggedEntityType, typeof supportedActivityTagTargetTypes[number]>;

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

const createInteractionTypeInputSchema = z.object({
  type_name: z.string().trim().min(1).max(120),
  icon: z.string().trim().max(120).optional(),
  display_order: z.number().int().nonnegative().optional(),
  if_exists: z.enum(['return_existing', 'error']).default('return_existing'),
  idempotency_key: z.string().optional(),
});

const interactionTypeSummarySchema = z.object({
  type_id: uuidSchema,
  type_name: z.string(),
  icon: z.string().nullable(),
  display_order: z.number().int().nullable(),
  created_by: nullableUuidSchema,
  created: z.boolean(),
});

const updateActivityStatusInputSchema = z
  .object({
    activity_id: uuidSchema,
    status_id: uuidSchema.optional(),
    status_name: z.string().trim().min(1).max(255).optional(),
    reason: z.string().optional(),
    no_op_if_already_status: z.boolean().default(true),
  })
  .superRefine((value, refinementCtx) => {
    if (!value.status_id && !value.status_name) {
      refinementCtx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Either status_id or status_name is required',
      });
    }
    if (value.status_id && value.status_name) {
      refinementCtx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide either status_id or status_name, not both',
      });
    }
  });

const createQuoteInputSchema = z.object({
  client_id: withWorkflowPicker(uuidSchema, 'Client id', 'client'),
  contact_id: withWorkflowPicker(uuidSchema.optional(), 'Optional contact id linked to client', 'contact', ['client_id']),
  title: z.string().trim().min(1),
  description: z.string().optional().nullable(),
  quote_date: z.coerce.date(),
  valid_until: z.coerce.date(),
  po_number: z.string().trim().max(255).optional().nullable(),
  internal_notes: z.string().optional().nullable(),
  client_notes: z.string().optional().nullable(),
  terms_and_conditions: z.string().optional().nullable(),
  currency_code: z.string().trim().length(3).default('USD'),
  idempotency_key: z.string().optional(),
});

const addQuoteItemInputSchema = z.object({
  quote_id: uuidSchema,
  description: z.string().trim().min(1),
  quantity: z.number().int().positive(),
  unit_price: z.number().int().min(0).optional(),
  unit_of_measure: z.string().trim().optional().nullable(),
  display_order: z.number().int().nonnegative().optional(),
  phase: z.string().trim().optional().nullable(),
  is_optional: z.boolean().default(false),
  is_selected: z.boolean().default(true),
  is_recurring: z.boolean().default(false),
  billing_frequency: z.string().trim().optional().nullable(),
  billing_method: z.enum(['fixed', 'hourly', 'usage']).optional().nullable(),
  is_discount: z.boolean().default(false),
  discount_type: z.enum(['percentage', 'fixed']).optional().nullable(),
  discount_percentage: z.number().int().min(0).max(100).optional().nullable(),
  applies_to_item_id: uuidSchema.optional().nullable(),
  applies_to_service_id: uuidSchema.optional().nullable(),
  is_taxable: z.boolean().default(true),
  tax_region: z.string().trim().optional().nullable(),
  tax_rate: z.number().int().min(0).optional().nullable(),
  location_id: uuidSchema.optional().nullable(),
  cost: z.number().int().min(0).optional().nullable(),
  cost_currency: z.string().trim().length(3).optional().nullable(),
  idempotency_key: z.string().optional(),
});

const createQuoteFromTemplateInputSchema = z.object({
  template_id: uuidSchema,
  client_id: withWorkflowPicker(uuidSchema, 'Client id', 'client'),
  contact_id: withWorkflowPicker(uuidSchema.optional(), 'Optional contact id linked to client', 'contact', ['client_id']),
  title: z.string().trim().min(1).optional(),
  quote_date: z.coerce.date().optional(),
  valid_until: z.coerce.date().optional(),
  po_number: z.string().trim().max(255).optional().nullable(),
  internal_notes: z.string().optional().nullable(),
  client_notes: z.string().optional().nullable(),
  currency_code: z.string().trim().length(3).optional(),
  idempotency_key: z.string().optional(),
});

const findQuotesInputSchema = z
  .object({
    quote_id: uuidSchema.optional(),
    quote_number: z.string().trim().min(1).max(120).optional(),
    client_id: withWorkflowPicker(uuidSchema.optional(), 'Optional client id filter', 'client'),
    status: quoteStatusSchema.optional(),
    date_from: z.coerce.date().optional(),
    date_to: z.coerce.date().optional(),
    is_template: z.boolean().default(false),
    page: z.number().int().positive().default(1),
    pageSize: z.number().int().positive().max(200).default(25),
    sortBy: z.enum(['quote_date', 'total_amount', 'status', 'created_at']).default('quote_date'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
    on_empty: onEmptySchema.default('return_empty'),
  })
  .superRefine((value, refinementCtx) => {
    if (value.date_from && value.date_to && value.date_from.getTime() > value.date_to.getTime()) {
      refinementCtx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'date_from must be less than or equal to date_to',
      });
      return;
    }

    const hasFilter = Boolean(
      value.quote_id ||
      value.quote_number ||
      value.client_id ||
      value.status ||
      value.date_from ||
      value.date_to
    );
    const hasBoundedDateRange = Boolean(value.date_from && value.date_to);
    const smallPage = value.pageSize <= 25;

    if (!hasFilter && !hasBoundedDateRange && !smallPage) {
      refinementCtx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide at least one filter, a bounded date range, or use pageSize <= 25',
      });
    }
  });

const submitQuoteForApprovalInputSchema = z.object({
  quote_id: uuidSchema,
  comment: z.string().optional(),
  reason: z.string().optional(),
  no_op_if_already_pending: z.boolean().default(true),
});

const convertQuoteInputSchema = z.object({
  quote_id: uuidSchema,
  target: z.enum(['contract', 'invoice', 'contract_and_invoice']),
  no_op_if_already_converted: z.boolean().default(true),
});

const tagActivityInputSchema = z.object({
  activity_id: uuidSchema,
  tags: z.array(z.string().trim().min(1)).min(1),
  if_exists: z.enum(['no_op', 'error']).default('no_op'),
  idempotency_key: z.string().optional(),
});

const quoteDetailSummarySchema = z.object({
  quote_id: uuidSchema,
  quote_number: z.string().nullable(),
  status: z.string().nullable(),
  client_id: nullableUuidSchema,
  contact_id: nullableUuidSchema,
  title: z.string(),
  quote_date: isoDateTimeSchema.nullable(),
  valid_until: isoDateTimeSchema.nullable(),
  currency_code: z.string().nullable(),
  subtotal: z.number().nullable(),
  discount_total: z.number().nullable(),
  tax: z.number().nullable(),
  total_amount: z.number().nullable(),
  sent_at: isoDateTimeSchema.nullable(),
  converted_contract_id: nullableUuidSchema,
  converted_invoice_id: nullableUuidSchema,
  is_template: z.boolean(),
});

const quoteItemSummarySchema = z.object({
  quote_item_id: uuidSchema,
  quote_id: uuidSchema,
  description: z.string(),
  quantity: z.number().int(),
  unit_price: z.number(),
  total_price: z.number(),
  display_order: z.number().int(),
  is_optional: z.boolean(),
  is_selected: z.boolean(),
  is_recurring: z.boolean(),
  is_discount: z.boolean(),
  billing_frequency: z.string().nullable(),
  discount_type: z.string().nullable(),
  discount_percentage: z.number().nullable(),
  created_at: isoDateTimeSchema.nullable(),
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
  _trx: Knex.Transaction,
  _tenantId: string,
  _quote: Record<string, unknown>,
  _actorUserId: string
): Promise<void> {
  // PDF rendering is a server/UI concern today: the generator imports billing
  // service barrels, invoice template React renderers, and document models. Keep
  // the Temporal workflow worker graph worker-safe and skip this optional side
  // effect until a worker-safe quote PDF provider exists.
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

function toQuoteDetailSummary(quote: Record<string, unknown>) {
  return quoteDetailSummarySchema.parse({
    quote_id: quote.quote_id,
    quote_number: quote.quote_number == null ? null : String(quote.quote_number),
    status: quote.status == null ? null : String(quote.status),
    client_id: quote.client_id ?? null,
    contact_id: quote.contact_id ?? null,
    title: String(quote.title ?? ''),
    quote_date: asIsoString(quote.quote_date),
    valid_until: asIsoString(quote.valid_until),
    currency_code: quote.currency_code == null ? null : String(quote.currency_code),
    subtotal: quote.subtotal == null ? null : Number(quote.subtotal),
    discount_total: quote.discount_total == null ? null : Number(quote.discount_total),
    tax: quote.tax == null ? null : Number(quote.tax),
    total_amount: quote.total_amount == null ? null : Number(quote.total_amount),
    sent_at: asIsoString(quote.sent_at),
    converted_contract_id: quote.converted_contract_id ?? null,
    converted_invoice_id: quote.converted_invoice_id ?? null,
    is_template: Boolean(quote.is_template),
  });
}

function toQuoteItemSummary(item: Record<string, unknown>) {
  return quoteItemSummarySchema.parse({
    quote_item_id: item.quote_item_id,
    quote_id: item.quote_id,
    description: String(item.description ?? ''),
    quantity: Number(item.quantity ?? 0),
    unit_price: Number(item.unit_price ?? 0),
    total_price: Number(item.total_price ?? 0),
    display_order: Number(item.display_order ?? 0),
    is_optional: Boolean(item.is_optional),
    is_selected: Boolean(item.is_selected),
    is_recurring: Boolean(item.is_recurring),
    is_discount: Boolean(item.is_discount),
    billing_frequency: item.billing_frequency == null ? null : String(item.billing_frequency),
    discount_type: item.discount_type == null ? null : String(item.discount_type),
    discount_percentage: item.discount_percentage == null ? null : Number(item.discount_percentage),
    created_at: asIsoString(item.created_at),
  });
}

function normalizeInteractionTypeName(typeName: string): string {
  return typeName.trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeQuoteDates<T extends Record<string, unknown>>(value: T): T {
  const normalized = { ...value };
  for (const field of ['quote_date', 'valid_until'] as const) {
    if (normalized[field] instanceof Date) {
      (normalized as Record<string, unknown>)[field] = (normalized[field] as Date).toISOString();
    }
  }
  return normalized;
}

async function ensureQuoteContactBelongsToClient(
  ctx: any,
  tx: TenantTxContext,
  clientId: string,
  contactId: string | undefined
): Promise<void> {
  if (!contactId) return;

  const contact = await tx.trx('contacts')
    .where({ tenant: tx.tenantId, contact_name_id: contactId })
    .first();

  if (!contact) {
    throwActionError(ctx, {
      category: 'ActionError',
      code: 'NOT_FOUND',
      message: 'Contact not found',
      details: { contact_id: contactId },
    });
  }

  if (contact.client_id !== clientId) {
    throwActionError(ctx, {
      category: 'ValidationError',
      code: 'VALIDATION_ERROR',
      message: 'contact_id must belong to client_id',
      details: { contact_id: contactId, client_id: clientId },
    });
  }
}

type QuoteAuthorizationRecord = {
  quote_id: string | null;
  client_id: string | null;
  created_by: string | null;
};

let authorizationSavepointCounter = 0;

async function runAuthorizationLookupInSavepoint<T>(
  trx: Knex.Transaction,
  lookup: () => Promise<T>,
  fallback: T
): Promise<T> {
  const savepointName = `workflow_auth_lookup_${authorizationSavepointCounter++}`;

  try {
    await trx.raw(`SAVEPOINT ${savepointName}`);
    const result = await lookup();
    await trx.raw(`RELEASE SAVEPOINT ${savepointName}`);
    return result;
  } catch {
    try {
      await trx.raw(`ROLLBACK TO SAVEPOINT ${savepointName}`);
      await trx.raw(`RELEASE SAVEPOINT ${savepointName}`);
    } catch {
      // Best effort: the caller receives the fallback value, and any unrecoverable
      // transaction failure will surface on the next required DB operation.
    }
    return fallback;
  }
}

async function resolveBundleNarrowingRulesSafely(
  trx: Knex.Transaction,
  input: Parameters<typeof resolveBundleNarrowingRulesForEvaluation>[1]
): ReturnType<typeof resolveBundleNarrowingRulesForEvaluation> {
  return runAuthorizationLookupInSavepoint(
    trx,
    () => resolveBundleNarrowingRulesForEvaluation(trx, input),
    []
  );
}


function createQuoteAuthorizationKernel(trx: Knex.Transaction) {
  return createAuthorizationKernel({
    builtinProvider: new BuiltinAuthorizationKernelProvider({ mutationGuards: [] }),
    bundleProvider: new BundleAuthorizationKernelProvider({
      resolveRules: async (input) => resolveBundleNarrowingRulesSafely(trx, input),
    }),
    rbacEvaluator: async () => true,
  });
}

async function resolveQuoteAuthorizationSubject(
  trx: Knex.Transaction,
  tenantId: string,
  actorUserId: string
): Promise<AuthorizationSubject> {
  const roleRows = await runAuthorizationLookupInSavepoint(
    trx,
    () => trx('user_roles').where({ tenant: tenantId, user_id: actorUserId }).select<{ role_id: string }[]>('role_id'),
    []
  );
  const teamRows = await runAuthorizationLookupInSavepoint(
    trx,
    () => trx('team_members').where({ tenant: tenantId, user_id: actorUserId }).select<{ team_id: string }[]>('team_id'),
    []
  );
  const managedRows = await runAuthorizationLookupInSavepoint(
    trx,
    () => trx('users').where({ tenant: tenantId, reports_to: actorUserId }).select<{ user_id: string }[]>('user_id'),
    []
  );
  const userRow = await runAuthorizationLookupInSavepoint(
    trx,
    () => trx('users')
      .where({ tenant: tenantId, user_id: actorUserId })
      .select<{ user_type?: string | null; contact_id?: string | null; client_id?: string | null }>('user_type', 'contact_id', 'client_id')
      .first(),
    null
  );

  const clientId = userRow?.client_id ?? null;
  return {
    tenant: tenantId,
    userId: actorUserId,
    userType: userRow?.user_type === 'client' ? 'client' : 'internal',
    roleIds: roleRows.map((row) => row.role_id),
    teamIds: teamRows.map((row) => row.team_id),
    managedUserIds: managedRows.map((row) => row.user_id),
    clientId,
    portfolioClientIds: clientId ? [clientId] : [],
  };
}

function toQuoteAuthorizationRecord(quote: Record<string, unknown>): QuoteAuthorizationRecord {
  return {
    quote_id: quote.quote_id == null ? null : String(quote.quote_id),
    client_id: quote.client_id == null ? null : String(quote.client_id),
    created_by: quote.created_by == null ? null : String(quote.created_by),
  };
}

async function authorizeQuoteRead(
  trx: Knex.Transaction,
  tenantId: string,
  actorUserId: string,
  quote: Record<string, unknown>
): Promise<boolean> {
  const subject = await resolveQuoteAuthorizationSubject(trx, tenantId, actorUserId);
  const kernel = createQuoteAuthorizationKernel(trx);
  const decision = await kernel.authorizeResource({
    subject,
    resource: {
      type: 'billing',
      action: 'read',
      id: quote.quote_id == null ? null : String(quote.quote_id),
    },
    record: {
      id: toQuoteAuthorizationRecord(quote).quote_id,
      ownerUserId: toQuoteAuthorizationRecord(quote).created_by,
      clientId: toQuoteAuthorizationRecord(quote).client_id,
    },
    requestCache: new RequestLocalAuthorizationCache(),
    knex: trx,
  });
  return decision.allowed;
}

async function getAuthorizedQuoteForMutation(
  ctx: any,
  tx: TenantTxContext,
  quoteId: string,
  deniedMessage: string
): Promise<Record<string, unknown>> {
  const quote = await tx.trx('quotes').where({ tenant: tx.tenantId, quote_id: quoteId }).first();
  if (!quote) {
    throwActionError(ctx, {
      category: 'ActionError',
      code: 'NOT_FOUND',
      message: 'Quote not found',
      details: { quote_id: quoteId },
    });
  }

  const allowed = await authorizeQuoteRead(tx.trx, tx.tenantId, tx.actorUserId, quote);
  if (!allowed) {
    throwActionError(ctx, {
      category: 'ActionError',
      code: 'PERMISSION_DENIED',
      message: deniedMessage,
      details: { quote_id: quoteId },
    });
  }

  return quote;
}

function resolveSupportedActivityTagTarget(
  ctx: any,
  interaction: Record<string, unknown>
): { type: SupportedActivityTagTargetType; id: string } {
  if (interaction.ticket_id) {
    return { type: 'ticket', id: String(interaction.ticket_id) };
  }
  if (interaction.contact_name_id) {
    return { type: 'contact', id: String(interaction.contact_name_id) };
  }
  if (interaction.client_id) {
    return { type: 'client', id: String(interaction.client_id) };
  }

  throwActionError(ctx, {
    category: 'ValidationError',
    code: 'VALIDATION_ERROR',
    message: 'Activity cannot be tagged because it is not linked to a supported tag target',
    details: {
      supported_entity_types: supportedActivityTagTargetTypes,
    },
  });
}

async function resolveInteractionStatus(
  ctx: any,
  tx: TenantTxContext,
  params: { statusId?: string; statusName?: string }
): Promise<{ status_id: string; status_name: string }> {
  let statusRow: Record<string, unknown> | undefined;
  if (params.statusId) {
    statusRow = await tx.trx('statuses')
      .where({ tenant: tx.tenantId, status_type: 'interaction', status_id: params.statusId })
      .first();
  } else if (params.statusName) {
    statusRow = await tx.trx('statuses')
      .where({ tenant: tx.tenantId, status_type: 'interaction' })
      .whereRaw('lower(trim(name)) = lower(trim(?))', [params.statusName])
      .first();
  }

  if (!statusRow?.status_id) {
    throwActionError(ctx, {
      category: 'ValidationError',
      code: 'VALIDATION_ERROR',
      message: 'Target interaction status was not found',
      details: { status_id: params.statusId ?? null, status_name: params.statusName ?? null },
    });
  }

  return {
    status_id: String(statusRow.status_id),
    status_name: String(statusRow.name ?? ''),
  };
}

function validateTagText(value: string): string {
  const tagText = value.trim();
  if (!tagText) {
    throw new Error('Tag text is required');
  }
  if (tagText.length > 50) {
    throw new Error('Tag text too long (max 50 characters)');
  }
  if (!/^[a-zA-Z0-9\-_\s!@#$%^&*()+=\][{};':",./<>?]+$/.test(tagText)) {
    throw new Error('Tag text contains invalid characters');
  }
  return tagText;
}

export function registerCrmActions(): void {
  const registry = getActionRegistryV2();

  // ---------------------------------------------------------------------------
  // crm.create_interaction_type
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'crm.create_interaction_type',
    version: 1,
    inputSchema: createInteractionTypeInputSchema,
    outputSchema: z.object({
      interaction_type: interactionTypeSummarySchema,
    }),
    sideEffectful: true,
    idempotency: { mode: 'actionProvided', key: actionProvidedKey },
    ui: {
      label: 'Create Activity Type',
      category: 'Business Operations',
      description: 'Create a tenant CRM interaction type with idempotent duplicate handling',
    },
    handler: async (input, ctx) =>
      withTenantTransaction(ctx, async (tx) => {
        await requirePermission(ctx, tx, { resource: 'settings', action: 'update' });

        const normalizedTypeName = normalizeInteractionTypeName(input.type_name);
        const existing = await tx.trx('interaction_types')
          .where({ tenant: tx.tenantId })
          .whereRaw('lower(trim(type_name)) = ?', [normalizedTypeName])
          .first();

        if (existing) {
          if (input.if_exists === 'error') {
            throwActionError(ctx, {
              category: 'ActionError',
              code: 'CONFLICT',
              message: 'Interaction type already exists',
              details: { type_name: input.type_name },
            });
          }

          return {
            interaction_type: interactionTypeSummarySchema.parse({
              type_id: existing.type_id,
              type_name: String(existing.type_name),
              icon: existing.icon == null ? null : String(existing.icon),
              display_order: existing.display_order == null ? null : Number(existing.display_order),
              created_by: existing.created_by ?? null,
              created: false,
            }),
          };
        }

        const typeId = uuidv4();

        const displayOrder = input.display_order ?? await (async () => {
          const row = await tx.trx('interaction_types')
            .where({ tenant: tx.tenantId })
            .max<{ max?: number | string }>('display_order as max')
            .first();
          return Number(row?.max ?? -1) + 1;
        })();

        try {
          await tx.trx('interaction_types').insert({
            tenant: tx.tenantId,
            type_id: typeId,
            type_name: input.type_name.trim(),
            icon: input.icon?.trim() || null,
            display_order: displayOrder,
            created_by: tx.actorUserId,
          });
        } catch (error) {
          rethrowAsStandardError(ctx, error);
        }

        await writeRunAudit(ctx, tx, {
          operation: 'workflow_action:crm.create_interaction_type',
          changedData: {
            type_id: typeId,
            type_name: input.type_name.trim(),
            display_order: displayOrder,
            created: true,
          },
          details: {
            action_id: 'crm.create_interaction_type',
            action_version: 1,
            type_id: typeId,
          },
        });

        return {
          interaction_type: interactionTypeSummarySchema.parse({
            type_id: typeId,
            type_name: input.type_name.trim(),
            icon: input.icon?.trim() || null,
            display_order: displayOrder,
            created_by: tx.actorUserId,
            created: true,
          }),
        };
      }),
  });

  // ---------------------------------------------------------------------------
  // crm.update_activity_status
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'crm.update_activity_status',
    version: 1,
    inputSchema: updateActivityStatusInputSchema,
    outputSchema: z.object({
      activity_id: uuidSchema,
      previous_status_id: nullableUuidSchema,
      previous_status_name: z.string().nullable(),
      current_status_id: nullableUuidSchema,
      current_status_name: z.string().nullable(),
      no_op: z.boolean(),
      activity: activitySummarySchema,
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Update Activity Status',
      category: 'Business Operations',
      description: 'Update only the status for an existing CRM activity',
    },
    handler: async (input, ctx) =>
      withTenantTransaction(ctx, async (tx) => {
        await requirePermission(ctx, tx, { resource: 'client', action: 'update' });

        const before = await fetchActivitySummary(ctx, tx, input.activity_id);
        const targetStatus = await resolveInteractionStatus(ctx, tx, {
          statusId: input.status_id,
          statusName: input.status_name,
        });

        if (before.status_id === targetStatus.status_id && input.no_op_if_already_status) {
          return {
            activity_id: input.activity_id,
            previous_status_id: before.status_id,
            previous_status_name: before.status_name,
            current_status_id: before.status_id,
            current_status_name: before.status_name,
            no_op: true,
            activity: before,
          };
        }

        try {
          const updatedCount = await tx.trx('interactions')
            .where({ tenant: tx.tenantId, interaction_id: input.activity_id })
            .update({ status_id: targetStatus.status_id });
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

        await writeRunAudit(ctx, tx, {
          operation: 'workflow_action:crm.update_activity_status',
          changedData: {
            activity_id: input.activity_id,
            previous_status_id: before.status_id,
            current_status_id: after.status_id,
            reason: input.reason ?? null,
          },
          details: {
            action_id: 'crm.update_activity_status',
            action_version: 1,
            activity_id: input.activity_id,
          },
        });

        return {
          activity_id: input.activity_id,
          previous_status_id: before.status_id,
          previous_status_name: before.status_name,
          current_status_id: after.status_id,
          current_status_name: after.status_name,
          no_op: false,
          activity: after,
        };
      }),
  });

  // ---------------------------------------------------------------------------
  // crm.create_quote
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'crm.create_quote',
    version: 1,
    inputSchema: createQuoteInputSchema,
    outputSchema: z.object({
      quote: quoteDetailSummarySchema,
    }),
    sideEffectful: true,
    idempotency: { mode: 'actionProvided', key: actionProvidedKey },
    ui: {
      label: 'Create Quote',
      category: 'Business Operations',
      description: 'Create a draft quote header for a client/contact',
    },
    handler: async (input, ctx) =>
      withTenantTransaction(ctx, async (tx) => {
        await requirePermission(ctx, tx, { resource: 'billing', action: 'create' });
        await requirePermission(ctx, tx, { resource: 'billing', action: 'read' });

        const client = await tx.trx('clients').where({ tenant: tx.tenantId, client_id: input.client_id }).first();
        if (!client) {
          throwActionError(ctx, {
            category: 'ActionError',
            code: 'NOT_FOUND',
            message: 'Client not found',
            details: { client_id: input.client_id },
          });
        }

        await ensureQuoteContactBelongsToClient(ctx, tx, input.client_id, input.contact_id);

        let parsedInput: Record<string, unknown>;
        try {
          parsedInput = normalizeQuoteDates(createQuoteSchema.parse({
            client_id: input.client_id,
            contact_id: input.contact_id ?? null,
            title: input.title,
            description: input.description ?? null,
            quote_date: input.quote_date,
            valid_until: input.valid_until,
            po_number: input.po_number ?? null,
            internal_notes: input.internal_notes ?? null,
            client_notes: input.client_notes ?? null,
            terms_and_conditions: input.terms_and_conditions ?? null,
            currency_code: input.currency_code,
            tax_source: 'internal',
            is_template: false,
            created_by: tx.actorUserId,
          }));
        } catch (error) {
          rethrowAsStandardError(ctx, error);
        }

        const createdQuote = await Quote.create(tx.trx, tx.tenantId, {
          ...(parsedInput as any),
          subtotal: 0,
          discount_total: 0,
          tax: 0,
          total_amount: 0,
        } as any);

        const authorized = await authorizeQuoteRead(tx.trx, tx.tenantId, tx.actorUserId, createdQuote as any);
        if (!authorized) {
          throwActionError(ctx, {
            category: 'ActionError',
            code: 'PERMISSION_DENIED',
            message: 'Permission denied: Cannot read created quote',
          });
        }

        const fullQuote = await Quote.getById(tx.trx, tx.tenantId, createdQuote.quote_id);
        if (!fullQuote) {
          throwActionError(ctx, {
            category: 'ActionError',
            code: 'NOT_FOUND',
            message: 'Quote not found after creation',
            details: { quote_id: createdQuote.quote_id },
          });
        }

        await writeRunAudit(ctx, tx, {
          operation: 'workflow_action:crm.create_quote',
          changedData: {
            quote_id: createdQuote.quote_id,
            client_id: input.client_id,
            contact_id: input.contact_id ?? null,
            status: createdQuote.status ?? null,
          },
          details: {
            action_id: 'crm.create_quote',
            action_version: 1,
            quote_id: createdQuote.quote_id,
          },
        });

        return { quote: toQuoteDetailSummary(fullQuote as any) };
      }),
  });

  // ---------------------------------------------------------------------------
  // crm.add_quote_item
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'crm.add_quote_item',
    version: 1,
    inputSchema: addQuoteItemInputSchema,
    outputSchema: z.object({
      quote_item: quoteItemSummarySchema,
      quote: quoteDetailSummarySchema,
    }),
    sideEffectful: true,
    idempotency: { mode: 'actionProvided', key: actionProvidedKey },
    ui: {
      label: 'Add Quote Item',
      category: 'Business Operations',
      description: 'Add an item to an editable quote and return refreshed totals',
    },
    handler: async (input, ctx) =>
      withTenantTransaction(ctx, async (tx) => {
        await requirePermission(ctx, tx, { resource: 'billing', action: 'update' });
        await requirePermission(ctx, tx, { resource: 'billing', action: 'read' });

        const quote = await getAuthorizedQuoteForMutation(
          ctx,
          tx,
          input.quote_id,
          'Permission denied: Cannot update quote'
        );

        if (quote.is_template) {
          throwActionError(ctx, {
            category: 'ValidationError',
            code: 'VALIDATION_ERROR',
            message: 'Cannot add items to quote templates',
            details: { quote_id: input.quote_id },
          });
        }

        if (String(quote.status ?? 'draft') !== 'draft') {
          throwActionError(ctx, {
            category: 'ValidationError',
            code: 'VALIDATION_ERROR',
            message: 'Only draft quotes are editable',
            details: { quote_id: input.quote_id, status: quote.status ?? null },
          });
        }

        let parsedInput: Record<string, unknown>;
        try {
          parsedInput = createQuoteItemSchema.parse({
            ...input,
            created_by: tx.actorUserId,
          }) as Record<string, unknown>;
        } catch (error) {
          rethrowAsStandardError(ctx, error);
        }

        const createdItem = await QuoteItem.create(tx.trx, tx.tenantId, parsedInput as any);
        const refreshedQuote = await Quote.getById(tx.trx, tx.tenantId, input.quote_id);
        if (!refreshedQuote) {
          throwActionError(ctx, {
            category: 'ActionError',
            code: 'NOT_FOUND',
            message: 'Quote not found after item creation',
            details: { quote_id: input.quote_id },
          });
        }

        await writeRunAudit(ctx, tx, {
          operation: 'workflow_action:crm.add_quote_item',
          changedData: {
            quote_id: input.quote_id,
            quote_item_id: createdItem.quote_item_id,
            display_order: createdItem.display_order,
            total_price: createdItem.total_price,
          },
          details: {
            action_id: 'crm.add_quote_item',
            action_version: 1,
            quote_id: input.quote_id,
            quote_item_id: createdItem.quote_item_id,
          },
        });

        return {
          quote_item: toQuoteItemSummary(createdItem as any),
          quote: toQuoteDetailSummary(refreshedQuote as any),
        };
      }),
  });

  // ---------------------------------------------------------------------------
  // crm.create_quote_from_template
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'crm.create_quote_from_template',
    version: 1,
    inputSchema: createQuoteFromTemplateInputSchema,
    outputSchema: z.object({
      quote: quoteDetailSummarySchema,
      quote_items: z.array(quoteItemSummarySchema),
    }),
    sideEffectful: true,
    idempotency: { mode: 'actionProvided', key: actionProvidedKey },
    ui: {
      label: 'Create Quote from Template',
      category: 'Business Operations',
      description: 'Create a client quote from a quote template with optional overrides',
    },
    handler: async (input, ctx) =>
      withTenantTransaction(ctx, async (tx) => {
        await requirePermission(ctx, tx, { resource: 'billing', action: 'create' });
        await requirePermission(ctx, tx, { resource: 'billing', action: 'read' });

        const templateQuote = await getAuthorizedQuoteForMutation(
          ctx,
          tx,
          input.template_id,
          'Permission denied: Cannot read quote template'
        );

        if (!templateQuote.is_template) {
          throwActionError(ctx, {
            category: 'ValidationError',
            code: 'VALIDATION_ERROR',
            message: 'template_id must reference a quote template',
            details: { template_id: input.template_id },
          });
        }

        const templateWithItems = await Quote.getById(tx.trx, tx.tenantId, input.template_id);
        if (!templateWithItems) {
          throwActionError(ctx, {
            category: 'ActionError',
            code: 'NOT_FOUND',
            message: 'Template quote not found',
            details: { template_id: input.template_id },
          });
        }

        const client = await tx.trx('clients').where({ tenant: tx.tenantId, client_id: input.client_id }).first();
        if (!client) {
          throwActionError(ctx, {
            category: 'ActionError',
            code: 'NOT_FOUND',
            message: 'Client not found',
            details: { client_id: input.client_id },
          });
        }
        await ensureQuoteContactBelongsToClient(ctx, tx, input.client_id, input.contact_id);

        const resolvedQuoteDate = input.quote_date ?? (templateWithItems.quote_date ? new Date(templateWithItems.quote_date) : undefined);
        const resolvedValidUntil = input.valid_until ?? (templateWithItems.valid_until ? new Date(templateWithItems.valid_until) : undefined);

        if (!resolvedQuoteDate || !resolvedValidUntil) {
          throwActionError(ctx, {
            category: 'ValidationError',
            code: 'VALIDATION_ERROR',
            message: 'quote_date and valid_until must be resolvable from input or template',
          });
        }

        let parsedQuote: Record<string, unknown>;
        try {
          parsedQuote = normalizeQuoteDates(createQuoteSchema.parse({
            client_id: input.client_id,
            contact_id: input.contact_id ?? null,
            title: input.title ?? templateWithItems.title,
            description: templateWithItems.description ?? null,
            quote_date: resolvedQuoteDate,
            valid_until: resolvedValidUntil,
            po_number: input.po_number ?? null,
            internal_notes: input.internal_notes ?? templateWithItems.internal_notes ?? null,
            client_notes: input.client_notes ?? templateWithItems.client_notes ?? null,
            terms_and_conditions: templateWithItems.terms_and_conditions ?? null,
            currency_code: input.currency_code ?? templateWithItems.currency_code,
            tax_source: templateWithItems.tax_source ?? 'internal',
            is_template: false,
            created_by: tx.actorUserId,
          }));
        } catch (error) {
          rethrowAsStandardError(ctx, error);
        }

        const createdQuote = await Quote.create(tx.trx, tx.tenantId, {
          ...(parsedQuote as any),
          subtotal: 0,
          discount_total: 0,
          tax: 0,
          total_amount: 0,
        } as any);

        for (const item of templateWithItems.quote_items ?? []) {
          await QuoteItem.create(tx.trx, tx.tenantId, {
            quote_id: createdQuote.quote_id,
            service_id: item.service_id ?? null,
            service_item_kind: item.service_item_kind ?? null,
            service_name: item.service_name ?? null,
            service_sku: item.service_sku ?? null,
            billing_method: item.billing_method ?? null,
            description: item.description,
            quantity: item.quantity,
            unit_price: item.unit_price,
            unit_of_measure: item.unit_of_measure ?? null,
            display_order: item.display_order,
            phase: item.phase ?? null,
            is_optional: item.is_optional,
            is_selected: item.is_selected,
            is_recurring: item.is_recurring,
            billing_frequency: item.billing_frequency ?? null,
            is_discount: item.is_discount ?? false,
            discount_type: item.discount_type ?? null,
            discount_percentage: item.discount_percentage ?? null,
            applies_to_item_id: item.applies_to_item_id ?? null,
            applies_to_service_id: item.applies_to_service_id ?? null,
            is_taxable: item.is_taxable ?? true,
            tax_region: item.tax_region ?? null,
            tax_rate: item.tax_rate ?? null,
            location_id: item.location_id ?? null,
            cost: item.cost ?? null,
            cost_currency: item.cost_currency ?? null,
            created_by: tx.actorUserId,
          } as any);
        }

        const createdQuoteWithItems = await Quote.getById(tx.trx, tx.tenantId, createdQuote.quote_id);
        if (!createdQuoteWithItems) {
          throwActionError(ctx, {
            category: 'ActionError',
            code: 'NOT_FOUND',
            message: 'Created quote not found',
            details: { quote_id: createdQuote.quote_id },
          });
        }

        await writeRunAudit(ctx, tx, {
          operation: 'workflow_action:crm.create_quote_from_template',
          changedData: {
            quote_id: createdQuote.quote_id,
            template_id: input.template_id,
            item_count: createdQuoteWithItems.quote_items?.length ?? 0,
          },
          details: {
            action_id: 'crm.create_quote_from_template',
            action_version: 1,
            quote_id: createdQuote.quote_id,
          },
        });

        return {
          quote: toQuoteDetailSummary(createdQuoteWithItems as any),
          quote_items: (createdQuoteWithItems.quote_items ?? []).map((item) => toQuoteItemSummary(item as any)),
        };
      }),
  });

  // ---------------------------------------------------------------------------
  // crm.find_quotes
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'crm.find_quotes',
    version: 1,
    inputSchema: findQuotesInputSchema,
    outputSchema: z.object({
      quotes: z.array(quoteDetailSummarySchema),
      first_quote: quoteDetailSummarySchema.nullable(),
      count: z.number().int(),
      pagination: z.object({
        page: z.number().int(),
        page_size: z.number().int(),
      }),
    }),
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Find Quotes',
      category: 'Business Operations',
      description: 'Find tenant quotes with safe filters and pagination',
    },
    handler: async (input, ctx) =>
      withTenantTransaction(ctx, async (tx) => {
        await requirePermission(ctx, tx, { resource: 'billing', action: 'read' });

        const page = input.page ?? 1;
        const pageSize = input.pageSize ?? 25;
        const sortBy = input.sortBy ?? 'quote_date';
        const sortOrder = input.sortOrder ?? 'desc';

        const buildQuery = () => {
          const query = tx.trx('quotes')
            .where({ tenant: tx.tenantId, is_template: input.is_template ?? false });

          if (input.quote_id) query.andWhere('quote_id', input.quote_id);
          if (input.quote_number) query.andWhere('quote_number', input.quote_number);
          if (input.client_id) query.andWhere('client_id', input.client_id);
          if (input.status) query.andWhere('status', input.status);
          if (input.date_from) query.andWhere('quote_date', '>=', input.date_from.toISOString());
          if (input.date_to) query.andWhere('quote_date', '<=', input.date_to.toISOString());

          return query.orderBy(sortBy, sortOrder).orderBy('quote_id', 'asc');
        };

        const authorizedRows: Array<Record<string, unknown>> = [];
        const targetAuthorizedCount = page * pageSize;
        const sourceBatchSize = Math.max(pageSize, 100);
        let sourceOffset = 0;

        while (authorizedRows.length < targetAuthorizedCount) {
          const rows = await buildQuery().limit(sourceBatchSize).offset(sourceOffset);
          if (rows.length === 0) break;

          sourceOffset += rows.length;
          for (const row of rows) {
            if (await authorizeQuoteRead(tx.trx, tx.tenantId, tx.actorUserId, row)) {
              authorizedRows.push(row as Record<string, unknown>);
              if (authorizedRows.length >= targetAuthorizedCount) break;
            }
          }

          if (rows.length < sourceBatchSize) break;
        }

        const pageStart = (page - 1) * pageSize;
        const pageRows = authorizedRows.slice(pageStart, targetAuthorizedCount);

        if (pageRows.length === 0 && input.on_empty === 'error') {
          throwActionError(ctx, {
            category: 'ActionError',
            code: 'NOT_FOUND',
            message: 'No quotes matched the supplied filters',
          });
        }

        const summaries = pageRows.map((row) => toQuoteDetailSummary(row));
        return {
          quotes: summaries,
          first_quote: summaries[0] ?? null,
          count: summaries.length,
          pagination: {
            page,
            page_size: pageSize,
          },
        };
      }),
  });

  // ---------------------------------------------------------------------------
  // crm.submit_quote_for_approval
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'crm.submit_quote_for_approval',
    version: 1,
    inputSchema: submitQuoteForApprovalInputSchema,
    outputSchema: z.object({
      quote: quoteDetailSummarySchema,
      previous_status: z.string().nullable(),
      new_status: z.string().nullable(),
      no_op: z.boolean(),
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Submit Quote for Approval',
      category: 'Business Operations',
      description: 'Submit a draft quote to pending_approval',
    },
    handler: async (input, ctx) =>
      withTenantTransaction(ctx, async (tx) => {
        await requirePermission(ctx, tx, { resource: 'billing', action: 'read' });
        await requirePermission(ctx, tx, { resource: 'billing', action: 'update' });

        const quote = await getAuthorizedQuoteForMutation(
          ctx,
          tx,
          input.quote_id,
          'Permission denied: Cannot update quote'
        );

        if (quote.is_template) {
          throwActionError(ctx, {
            category: 'ValidationError',
            code: 'VALIDATION_ERROR',
            message: 'Quote templates cannot be submitted for approval',
            details: { quote_id: input.quote_id },
          });
        }

        const previousStatus = quote.status == null ? null : String(quote.status);
        if (previousStatus === 'pending_approval' && input.no_op_if_already_pending) {
          return {
            quote: toQuoteDetailSummary(quote),
            previous_status: previousStatus,
            new_status: previousStatus,
            no_op: true,
          };
        }

        if (previousStatus !== 'draft') {
          throwActionError(ctx, {
            category: 'ValidationError',
            code: 'VALIDATION_ERROR',
            message: 'Only draft quotes can be submitted for approval',
            details: { quote_id: input.quote_id, status: previousStatus },
          });
        }

        const updatedQuote = await Quote.update(tx.trx, tx.tenantId, input.quote_id, {
          status: 'pending_approval' as any,
          updated_by: tx.actorUserId,
        });

        const comment = input.comment?.trim() || input.reason?.trim() || null;
        if (comment) {
          await QuoteActivity.create(tx.trx, tx.tenantId, {
            quote_id: input.quote_id,
            activity_type: 'approval_submitted',
            description: `Quote submitted for approval: ${comment}`,
            performed_by: tx.actorUserId,
            metadata: { comment },
          });
        }

        await writeRunAudit(ctx, tx, {
          operation: 'workflow_action:crm.submit_quote_for_approval',
          changedData: {
            quote_id: input.quote_id,
            previous_status: previousStatus,
            new_status: updatedQuote.status ?? null,
            comment,
          },
          details: {
            action_id: 'crm.submit_quote_for_approval',
            action_version: 1,
            quote_id: input.quote_id,
          },
        });

        return {
          quote: toQuoteDetailSummary(updatedQuote as any),
          previous_status: previousStatus,
          new_status: updatedQuote.status == null ? null : String(updatedQuote.status),
          no_op: false,
        };
      }),
  });

  // ---------------------------------------------------------------------------
  // crm.convert_quote
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'crm.convert_quote',
    version: 1,
    inputSchema: convertQuoteInputSchema,
    outputSchema: z.object({
      quote: quoteDetailSummarySchema,
      contract_id: nullableUuidSchema,
      invoice_id: nullableUuidSchema,
      no_op: z.boolean(),
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Convert Quote',
      category: 'Business Operations',
      description: 'Convert an accepted quote to draft contract/invoice targets',
    },
    handler: async (input, ctx) =>
      withTenantTransaction(ctx, async (tx) => {
        await requirePermission(ctx, tx, { resource: 'billing', action: 'read' });
        await requirePermission(ctx, tx, { resource: 'billing', action: 'create' });
        await requirePermission(ctx, tx, { resource: 'billing', action: 'update' });

        const quote = await getAuthorizedQuoteForMutation(
          ctx,
          tx,
          input.quote_id,
          'Permission denied: Cannot convert quote'
        );

        if (quote.is_template) {
          throwActionError(ctx, {
            category: 'ValidationError',
            code: 'VALIDATION_ERROR',
            message: 'Quote templates cannot be converted',
            details: { quote_id: input.quote_id },
          });
        }

        const alreadyConverted = Boolean(quote.converted_contract_id || quote.converted_invoice_id || quote.status === 'converted');
        if (alreadyConverted && input.no_op_if_already_converted) {
          return {
            quote: toQuoteDetailSummary(quote),
            contract_id: typeof quote.converted_contract_id === 'string' ? quote.converted_contract_id : null,
            invoice_id: typeof quote.converted_invoice_id === 'string' ? quote.converted_invoice_id : null,
            no_op: true,
          };
        }

        try {
          if (input.target === 'contract') {
            const result = await convertQuoteToDraftContract(tx.trx, tx.tenantId, input.quote_id, tx.actorUserId);
            await writeRunAudit(ctx, tx, {
              operation: 'workflow_action:crm.convert_quote',
              changedData: {
                quote_id: input.quote_id,
                target: input.target,
                contract_id: result.contract.contract_id,
              },
              details: {
                action_id: 'crm.convert_quote',
                action_version: 1,
                quote_id: input.quote_id,
              },
            });
            return {
              quote: toQuoteDetailSummary(result.quote as any),
              contract_id: result.contract.contract_id,
              invoice_id: result.quote.converted_invoice_id ?? null,
              no_op: false,
            };
          }

          if (input.target === 'invoice') {
            const result = await convertQuoteToDraftInvoice(tx.trx, tx.tenantId, input.quote_id, tx.actorUserId);
            await writeRunAudit(ctx, tx, {
              operation: 'workflow_action:crm.convert_quote',
              changedData: {
                quote_id: input.quote_id,
                target: input.target,
                invoice_id: result.invoice.invoice_id,
              },
              details: {
                action_id: 'crm.convert_quote',
                action_version: 1,
                quote_id: input.quote_id,
              },
            });
            return {
              quote: toQuoteDetailSummary(result.quote as any),
              contract_id: result.quote.converted_contract_id ?? null,
              invoice_id: result.invoice.invoice_id,
              no_op: false,
            };
          }

          const result = await convertQuoteToDraftContractAndInvoice(tx.trx, tx.tenantId, input.quote_id, tx.actorUserId);
          await writeRunAudit(ctx, tx, {
            operation: 'workflow_action:crm.convert_quote',
            changedData: {
              quote_id: input.quote_id,
              target: input.target,
              contract_id: result.contract.contract_id,
              invoice_id: result.invoice.invoice_id,
            },
            details: {
              action_id: 'crm.convert_quote',
              action_version: 1,
              quote_id: input.quote_id,
            },
          });
          return {
            quote: toQuoteDetailSummary(result.quote as any),
            contract_id: result.contract.contract_id,
            invoice_id: result.invoice.invoice_id,
            no_op: false,
          };
        } catch (error) {
          rethrowAsStandardError(ctx, error);
        }
      }),
  });

  // ---------------------------------------------------------------------------
  // crm.tag_activity
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'crm.tag_activity',
    version: 1,
    inputSchema: tagActivityInputSchema,
    outputSchema: z.object({
      activity_id: uuidSchema,
      tagged_entity: z.object({
        type: z.enum(supportedActivityTagTargetTypes),
        id: uuidSchema,
      }),
      added_tags: z.array(z.object({ tag_id: uuidSchema, tag_text: z.string(), mapping_id: uuidSchema })),
      existing_tags: z.array(z.object({ tag_id: uuidSchema, tag_text: z.string(), mapping_id: uuidSchema })),
      added_count: z.number().int(),
      existing_count: z.number().int(),
    }),
    sideEffectful: true,
    idempotency: { mode: 'actionProvided', key: actionProvidedKey },
    ui: {
      label: 'Tag CRM Activity',
      category: 'Business Operations',
      description: 'Apply existing/new tags to a CRM interaction activity',
    },
    handler: async (input, ctx) =>
      withTenantTransaction(ctx, async (tx) => {
        await requirePermission(ctx, tx, { resource: 'interaction', action: 'update' });

        const interaction = await tx.trx('interactions')
          .where({ tenant: tx.tenantId, interaction_id: input.activity_id })
          .first();
        if (!interaction) {
          throwActionError(ctx, {
            category: 'ActionError',
            code: 'NOT_FOUND',
            message: 'Activity not found',
            details: { activity_id: input.activity_id },
          });
        }

        const tagTarget = resolveSupportedActivityTagTarget(ctx, interaction as Record<string, unknown>);
        await requirePermission(ctx, tx, { resource: tagTarget.type, action: 'update' });

        const normalizedTags = Array.from(new Set(input.tags.map((tag) => validateTagText(tag))));
        const addedTags: Array<{ tag_id: string; tag_text: string; mapping_id: string }> = [];
        const existingTags: Array<{ tag_id: string; tag_text: string; mapping_id: string }> = [];
        const createdDefinitions: Array<{ tag_id: string; tag_text: string; created_at?: Date }> = [];
        const createdMappings: Array<{ tag_id: string; tagged_id: string; created_at?: Date }> = [];

        for (const tagText of normalizedTags) {
          const maybeExistingDefinition = await TagDefinition.findByTextAndType(tx.trx, tx.tenantId, tagText, tagTarget.type);
          if (!maybeExistingDefinition) {
            await requirePermission(ctx, tx, { resource: 'tag', action: 'create' });
          }

          const { definition, created } = await TagDefinition.getOrCreateWithStatus(
            tx.trx,
            tx.tenantId,
            tagText,
            tagTarget.type,
            {}
          );

          const existingMapping = await tx.trx('tag_mappings')
            .where({
              tenant: tx.tenantId,
              tag_id: definition.tag_id,
              tagged_id: tagTarget.id,
              tagged_type: tagTarget.type,
            })
            .first();

          if (existingMapping) {
            if (input.if_exists === 'error') {
              throwActionError(ctx, {
                category: 'ActionError',
                code: 'CONFLICT',
                message: 'Tag is already applied to this activity target',
                details: { activity_id: input.activity_id, tagged_entity: tagTarget, tag_text: tagText },
              });
            }
            existingTags.push({
              tag_id: definition.tag_id,
              tag_text: definition.tag_text,
              mapping_id: String(existingMapping.mapping_id),
            });
            continue;
          }

          const mapping = await TagMapping.insert(tx.trx, tx.tenantId, {
            tag_id: definition.tag_id,
            tagged_id: tagTarget.id,
            tagged_type: tagTarget.type,
            created_by: tx.actorUserId,
          }, tx.actorUserId);

          if (created) {
            createdDefinitions.push({
              tag_id: definition.tag_id,
              tag_text: definition.tag_text,
              created_at: definition.created_at,
            });
          }
          createdMappings.push({
            tag_id: definition.tag_id,
            tagged_id: tagTarget.id,
            created_at: mapping.created_at,
          });
          addedTags.push({
            tag_id: definition.tag_id,
            tag_text: definition.tag_text,
            mapping_id: mapping.mapping_id,
          });
        }

        const occurredAt = new Date().toISOString();
        for (const definition of createdDefinitions) {
          await publishWorkflowDomainEvent({
            eventType: 'TAG_DEFINITION_CREATED',
            payload: buildTagDefinitionCreatedPayload({
              tagId: definition.tag_id,
              tagName: definition.tag_text,
              createdByUserId: tx.actorUserId,
              createdAt: definition.created_at ?? occurredAt,
            }),
            tenantId: tx.tenantId,
            occurredAt,
            actorUserId: tx.actorUserId,
            idempotencyKey: `tag_definition_created:${definition.tag_id}`,
          });
        }

        for (const mapping of createdMappings) {
          await publishWorkflowDomainEvent({
            eventType: 'TAG_APPLIED',
            payload: buildTagAppliedPayload({
              tagId: mapping.tag_id,
              entityType: tagTarget.type,
              entityId: mapping.tagged_id,
              appliedByUserId: tx.actorUserId,
              appliedAt: mapping.created_at ?? occurredAt,
            }),
            tenantId: tx.tenantId,
            occurredAt,
            actorUserId: tx.actorUserId,
            idempotencyKey: `tag_applied:${tagTarget.type}:${mapping.tagged_id}:${mapping.tag_id}`,
          });
        }

        await writeRunAudit(ctx, tx, {
          operation: 'workflow_action:crm.tag_activity',
          changedData: {
            activity_id: input.activity_id,
            tagged_entity_type: tagTarget.type,
            tagged_entity_id: tagTarget.id,
            tags: normalizedTags,
            added_count: addedTags.length,
            existing_count: existingTags.length,
          },
          details: {
            action_id: 'crm.tag_activity',
            action_version: 1,
            activity_id: input.activity_id,
            tagged_entity_type: tagTarget.type,
            tagged_entity_id: tagTarget.id,
          },
        });

        return {
          activity_id: input.activity_id,
          tagged_entity: tagTarget,
          added_tags: addedTags,
          existing_tags: existingTags,
          added_count: addedTags.length,
          existing_count: existingTags.length,
        };
      }),
  });

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

        const limit = input.limit ?? 25;
        query.orderBy('i.interaction_date', 'desc').limit(limit);

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
            limit,
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

        const quote = await getAuthorizedQuoteForMutation(
          ctx,
          tx,
          input.quote_id,
          'Permission denied: Cannot update quote'
        );

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
