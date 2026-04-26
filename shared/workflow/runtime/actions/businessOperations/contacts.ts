import { z } from 'zod';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { deleteEntityWithValidation, isEnterprise } from '@alga-psa/core';
import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { withWorkflowJsonSchemaMetadata } from '../../jsonSchemaMetadata';
import { ContactModel } from '../../../../models/contactModel';
import type {
  ContactEmailAddressInput as ContactModelEmailInput,
  ContactPhoneNumberInput as ContactModelPhoneInput,
} from '../../../../interfaces/contact.interfaces';
import { buildContactArchivedPayload, buildContactCreatedPayload, buildContactUpdatedPayload } from '../../../streams/domainEventBuilders/contactEventBuilders';
import { buildInteractionLoggedPayload, buildNoteCreatedPayload } from '../../../streams/domainEventBuilders/crmInteractionNoteEventBuilders';
import {
  uuidSchema,
  isoDateTimeSchema,
  actionProvidedKey,
  withTenantTransaction,
  requirePermission,
  writeRunAudit,
  throwActionError,
  rethrowAsStandardError,
  parseJsonMaybe,
  type TenantTxContext,
} from './shared';

const WORKFLOW_PICKER_HINTS = {
  client: 'Search clients',
  ticket: 'Search tickets',
  contact: 'Search contacts',
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

const contactSummarySchema = z.object({
  contact_name_id: uuidSchema,
  full_name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  client_id: uuidSchema.nullable(),
  is_inactive: z.boolean(),
});

const tagResultSchema = z.object({
  tag_id: uuidSchema,
  tag_text: z.string(),
  mapping_id: uuidSchema.optional(),
});

const nullableUuidSchema = z.union([uuidSchema, z.null()]);

const CONTACT_PHONE_CANONICAL_TYPES = ['work', 'mobile', 'home', 'fax', 'other'] as const;

const contactPhoneInputSchema = z.object({
  contact_phone_number_id: uuidSchema.optional(),
  phone_number: z.string().min(1),
  canonical_type: z.enum(CONTACT_PHONE_CANONICAL_TYPES).nullable().optional(),
  custom_type: z.string().nullable().optional(),
  is_default: z.boolean().optional(),
  display_order: z.number().int().min(0).optional(),
});

type ContactPhoneInput = z.infer<typeof contactPhoneInputSchema>;

const isContactPhoneCanonicalType = (value: unknown): value is ContactPhoneInput['canonical_type'] =>
  value === null || CONTACT_PHONE_CANONICAL_TYPES.includes(value as (typeof CONTACT_PHONE_CANONICAL_TYPES)[number]);

const contactAdditionalEmailInputSchema = z.object({
  contact_additional_email_address_id: uuidSchema.optional(),
  email_address: z.string().email(),
  canonical_type: z.enum(['work', 'personal', 'billing', 'other']).nullable().optional(),
  custom_type: z.string().nullable().optional(),
  display_order: z.number().int().min(0).optional(),
});

const contactCreateInputSchema = z.object({
  full_name: z.string().min(1),
  email: z.string().email(),
  client_id: withWorkflowPicker(nullableUuidSchema.optional(), 'Optional client id', 'client'),
  role: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  is_inactive: z.boolean().optional(),
  primary_email_canonical_type: z.enum(['work', 'personal', 'billing', 'other']).nullable().optional(),
  primary_email_custom_type: z.string().nullable().optional(),
  phone_numbers: z.array(contactPhoneInputSchema).optional(),
  additional_email_addresses: z.array(contactAdditionalEmailInputSchema).optional(),
  tags: z.array(z.string().min(1)).optional(),
  idempotency_key: z.string().optional().describe('Optional external idempotency key'),
});

const contactUpdatePatchSchema = z
  .object({
    full_name: z.string().min(1).optional(),
    email: z.string().email().nullable().optional(),
    client_id: nullableUuidSchema.optional(),
    role: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    is_inactive: z.boolean().optional(),
    primary_email_canonical_type: z.enum(['work', 'personal', 'billing', 'other']).nullable().optional(),
    primary_email_custom_type: z.string().nullable().optional(),
    primary_email_custom_type_id: uuidSchema.nullable().optional(),
    phone_numbers: z.array(contactPhoneInputSchema).optional(),
    additional_email_addresses: z.array(contactAdditionalEmailInputSchema).optional(),
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

    const hasDefinedValue = keys.some((key) => (value as Record<string, unknown>)[key] !== undefined);
    if (!hasDefinedValue) {
      refinementCtx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'patch must include at least one defined value',
      });
    }
  });

const contactDuplicateInputSchema = z.object({
  source_contact_id: withWorkflowPicker(uuidSchema, 'Source contact id', 'contact'),
  email: z.string().email().describe('New unique primary email for duplicated contact'),
  full_name: z.string().min(1).optional(),
  target_client_id: withWorkflowPicker(nullableUuidSchema.optional(), 'Target client id', 'client'),
  role: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  is_inactive: z.boolean().optional(),
  primary_email_canonical_type: z.enum(['work', 'personal', 'billing', 'other']).nullable().optional(),
  primary_email_custom_type: z.string().nullable().optional(),
  phone_numbers: z.array(contactPhoneInputSchema).optional(),
  additional_email_addresses: z.array(contactAdditionalEmailInputSchema).optional(),
  copy_tags: z.boolean().default(true),
  idempotency_key: z.string().optional().describe('Optional external idempotency key'),
});

const normalizeTagText = (value: string): string => value.trim();

const uniqueNormalizedTags = (tags: string[] | undefined): string[] => {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of tags) {
    const normalized = normalizeTagText(String(value));
    if (!normalized) continue;
    const lower = normalized.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(normalized);
  }

  return out;
};

const generateTagColors = (text: string): { backgroundColor: string; textColor: string } => {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = text.charCodeAt(i) + ((hash << 5) - hash);
  }

  const hue = Math.abs(hash) % 360;
  const saturation = 70;
  const lightness = 85;

  const hslToHex = (h: number, s: number, l: number): string => {
    const normalizedLightness = l / 100;
    const a = (s * Math.min(normalizedLightness, 1 - normalizedLightness)) / 100;
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      const color = normalizedLightness - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * color)
        .toString(16)
        .padStart(2, '0');
    };

    return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
  };

  return {
    backgroundColor: hslToHex(hue, saturation, lightness),
    textColor: '#2C3E50',
  };
};

const contactToSummary = (row: Record<string, unknown>) =>
  contactSummarySchema.parse({
    contact_name_id: row.contact_name_id,
    full_name: (row.full_name as string | null | undefined) ?? null,
    email: (row.email as string | null | undefined) ?? null,
    phone: (row.default_phone_number as string | null | undefined) ?? (row.phone as string | null | undefined) ?? null,
    client_id: (row.client_id as string | null | undefined) ?? null,
    is_inactive: Boolean(row.is_inactive),
  });

async function ensureContactExists(ctx: any, tx: TenantTxContext, contactId: string): Promise<Record<string, any>> {
  const contact = await ContactModel.getContactById(contactId, tx.tenantId, tx.trx);
  if (!contact) {
    throwActionError(ctx, {
      category: 'ActionError',
      code: 'NOT_FOUND',
      message: 'Contact not found',
      details: { contact_id: contactId },
    });
  }
  return contact;
}

async function ensureClientExists(ctx: any, tx: TenantTxContext, clientId: string): Promise<Record<string, any>> {
  const client = await tx.trx('clients').where({ tenant: tx.tenantId, client_id: clientId }).first();
  if (!client) {
    throwActionError(ctx, {
      category: 'ActionError',
      code: 'NOT_FOUND',
      message: 'Client not found',
      details: { client_id: clientId },
    });
  }
  return client;
}

async function ensureTicketExists(ctx: any, tx: TenantTxContext, ticketId: string): Promise<Record<string, any>> {
  const ticket = await tx.trx('tickets').where({ tenant: tx.tenantId, ticket_id: ticketId }).first();
  if (!ticket) {
    throwActionError(ctx, {
      category: 'ActionError',
      code: 'NOT_FOUND',
      message: 'Ticket not found',
      details: { ticket_id: ticketId },
    });
  }
  return ticket;
}

function rethrowContactModelError(ctx: any, error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);

  if (/^VALIDATION_ERROR:/i.test(message) || /^FOREIGN_KEY_ERROR:/i.test(message)) {
    throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message });
  }
  if (/^NOT_FOUND:/i.test(message)) {
    throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message });
  }
  if (/^EMAIL_EXISTS:/i.test(message)) {
    throwActionError(ctx, { category: 'ActionError', code: 'CONFLICT', message });
  }
  if (/^SYSTEM_ERROR:/i.test(message)) {
    throwActionError(ctx, { category: 'ActionError', code: 'INTERNAL_ERROR', message });
  }

  rethrowAsStandardError(ctx, error);
}

async function getTableColumns(tx: TenantTxContext, tableName: string): Promise<Set<string>> {
  const rows = await tx.trx('information_schema.columns')
    .select('column_name')
    .where({ table_schema: 'public', table_name: tableName });

  return new Set(rows.map((row: { column_name: string }) => row.column_name));
}

function pickExistingFields(
  data: Record<string, unknown>,
  availableColumns: Set<string>,
  allowedFields: Set<string>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (!allowedFields.has(key)) continue;
    if (!availableColumns.has(key)) continue;
    if (value === undefined) continue;
    out[key] = value;
  }

  return out;
}

async function ensureContactTagMappings(
  tx: TenantTxContext,
  contactId: string,
  tags: string[]
): Promise<{
  added: Array<z.infer<typeof tagResultSchema>>;
  existing: Array<z.infer<typeof tagResultSchema>>;
}> {
  const normalizedTags = uniqueNormalizedTags(tags);
  if (normalizedTags.length === 0) {
    return { added: [], existing: [] };
  }

  const added: Array<z.infer<typeof tagResultSchema>> = [];
  const existing: Array<z.infer<typeof tagResultSchema>> = [];
  const tagDefinitionColumns = await getTableColumns(tx, 'tag_definitions');
  const tagMappingColumns = await getTableColumns(tx, 'tag_mappings');

  for (const tagText of normalizedTags) {
    const { backgroundColor, textColor } = generateTagColors(tagText);

    const definitionRow = pickExistingFields(
      {
        tenant: tx.tenantId,
        tag_id: uuidv4(),
        tag_text: tagText,
        tagged_type: 'contact',
        background_color: backgroundColor,
        text_color: textColor,
        created_at: new Date().toISOString(),
      },
      tagDefinitionColumns,
      new Set([
        'tenant',
        'tag_id',
        'tag_text',
        'tagged_type',
        'background_color',
        'text_color',
        'created_at',
      ])
    );

    await tx.trx('tag_definitions')
      .insert(definitionRow)
      .onConflict(['tenant', 'tag_text', 'tagged_type'])
      .ignore();

    const definition = await tx.trx('tag_definitions')
      .where({
        tenant: tx.tenantId,
        tag_text: tagText,
        tagged_type: 'contact',
      })
      .first();

    if (!definition?.tag_id) {
      throw new Error(`Failed to resolve tag definition for "${tagText}"`);
    }

    const mappingId = uuidv4();
    const mappingRow = pickExistingFields(
      {
        tenant: tx.tenantId,
        mapping_id: mappingId,
        tag_id: definition.tag_id,
        tagged_id: contactId,
        tagged_type: 'contact',
        created_by: tx.actorUserId,
        created_at: new Date().toISOString(),
      },
      tagMappingColumns,
      new Set(['tenant', 'mapping_id', 'tag_id', 'tagged_id', 'tagged_type', 'created_by', 'created_at'])
    );

    const insertedMappings = await tx.trx('tag_mappings')
      .insert(mappingRow)
      .onConflict(['tenant', 'tag_id', 'tagged_id'])
      .ignore()
      .returning('mapping_id');

    if (insertedMappings.length > 0) {
      added.push(
        tagResultSchema.parse({
          tag_id: definition.tag_id,
          tag_text: definition.tag_text,
          mapping_id: typeof mappingRow.mapping_id === 'string' ? mappingRow.mapping_id : undefined,
        })
      );
      continue;
    }

    const mapping = await tx.trx('tag_mappings')
      .where({
        tenant: tx.tenantId,
        tag_id: definition.tag_id,
        tagged_id: contactId,
        tagged_type: 'contact',
      })
      .first();

    existing.push(
      tagResultSchema.parse({
        tag_id: definition.tag_id,
        tag_text: definition.tag_text,
        mapping_id: typeof mapping?.mapping_id === 'string' ? mapping.mapping_id : undefined,
      })
    );
  }

  return { added, existing };
}

async function deleteFromTableIfExists(
  trx: Knex.Transaction,
  tableName: string,
  where: Record<string, unknown>
): Promise<void> {
  const exists = await trx.schema.hasTable(tableName);
  if (!exists) return;
  await trx(tableName).where(where).delete();
}

async function getExistingPublicTables(
  trx: Knex.Transaction,
  tableNames: string[]
): Promise<Set<string>> {
  const rows = await trx('information_schema.tables')
    .select('table_name')
    .where({ table_schema: 'public' })
    .whereIn('table_name', tableNames);

  return new Set((rows as Array<{ table_name: string }>).map((row) => row.table_name));
}

async function cleanupEntraReferencesBeforeContactDelete(
  trx: Knex.Transaction,
  tenantId: string,
  contactId: string
): Promise<void> {
  if (!isEnterprise) {
    return;
  }

  const queueTableExists = await trx('information_schema.tables')
    .where({ table_schema: 'public', table_name: 'entra_contact_reconciliation_queue' })
    .first('table_name');

  if (!queueTableExists) {
    return;
  }

  await trx('entra_contact_reconciliation_queue')
    .where({ tenant: tenantId, resolved_contact_id: contactId })
    .update({
      resolved_contact_id: null,
      updated_at: trx.fn.now(),
    });
}

async function cleanupContactDeleteArtifacts(
  trx: Knex.Transaction,
  tenant: string,
  contactId: string
): Promise<void> {
  await deleteFromTableIfExists(trx, 'tag_mappings', {
    tenant,
    tagged_type: 'contact',
    tagged_id: contactId,
  });
  await deleteFromTableIfExists(trx, 'contact_phone_numbers', { tenant, contact_name_id: contactId });
  await deleteFromTableIfExists(trx, 'contact_additional_email_addresses', { tenant, contact_name_id: contactId });
  await deleteFromTableIfExists(trx, 'comments', { tenant, contact_id: contactId });
  await deleteFromTableIfExists(trx, 'portal_invitations', { tenant, contact_id: contactId });
}

async function cleanupContactNotesDocument(
  trx: Knex.Transaction,
  tenant: string,
  contactId: string
): Promise<void> {
  const contactRecord = await trx('contacts')
    .where({ contact_name_id: contactId, tenant })
    .select('notes_document_id')
    .first();

  if (!contactRecord?.notes_document_id) {
    return;
  }

  await deleteFromTableIfExists(trx, 'document_block_content', {
    tenant,
    document_id: contactRecord.notes_document_id,
  });
  await deleteFromTableIfExists(trx, 'document_associations', {
    tenant,
    document_id: contactRecord.notes_document_id,
  });
  await deleteFromTableIfExists(trx, 'documents', {
    tenant,
    document_id: contactRecord.notes_document_id,
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

  if (!status?.status_id) {
    throwActionError(ctx, {
      category: 'ActionError',
      code: 'INTERNAL_ERROR',
      message: 'No default interaction status found',
    });
  }

  return status.status_id;
}

async function appendContactNoteBlock(
  tx: TenantTxContext,
  contact: Record<string, any>,
  body: string
): Promise<{ document_id: string; created_document: boolean; updated_at: string }> {
  const nowIso = new Date().toISOString();
  const contentBlock = {
    type: 'paragraph',
    content: [{ type: 'text', text: body }],
  };

  if (contact.notes_document_id) {
    const existing = await tx.trx('document_block_content')
      .where({ tenant: tx.tenantId, document_id: contact.notes_document_id })
      .first();

    const existingBlocks = Array.isArray(existing?.block_data)
      ? existing.block_data
      : parseJsonMaybe(existing?.block_data) ?? [];

    const nextBlocks = [...(Array.isArray(existingBlocks) ? existingBlocks : []), contentBlock];

    if (existing) {
      await tx.trx('document_block_content')
        .where({ tenant: tx.tenantId, document_id: contact.notes_document_id })
        .update({ block_data: JSON.stringify(nextBlocks), updated_at: nowIso });
    } else {
      await tx.trx('document_block_content').insert({
        content_id: uuidv4(),
        tenant: tx.tenantId,
        document_id: contact.notes_document_id,
        block_data: JSON.stringify(nextBlocks),
        created_at: nowIso,
        updated_at: nowIso,
      });
    }

    await tx.trx('documents')
      .where({ tenant: tx.tenantId, document_id: contact.notes_document_id })
      .update({ updated_at: nowIso, edited_by: tx.actorUserId });

    return {
      document_id: contact.notes_document_id,
      created_document: false,
      updated_at: nowIso,
    };
  }

  const documentId = uuidv4();
  const documentType = await tx.trx('document_types')
    .where({ tenant: tx.tenantId })
    .orderBy('type_name', 'asc')
    .first();

  const documentInsert: Record<string, unknown> = {
    tenant: tx.tenantId,
    document_id: documentId,
    document_name: `${contact.full_name ?? 'Contact'} Notes`,
    created_by: tx.actorUserId,
    user_id: tx.actorUserId,
    updated_at: nowIso,
    entered_at: nowIso,
  };

  const documentColumns = await getTableColumns(tx, 'documents');
  if (documentColumns.has('type_id')) {
    documentInsert.type_id = documentType?.type_id ?? null;
  }
  if (documentColumns.has('shared_type_id')) {
    documentInsert.shared_type_id = null;
  }

  await tx.trx('documents').insert(documentInsert);

  await tx.trx('document_block_content').insert({
    content_id: uuidv4(),
    tenant: tx.tenantId,
    document_id: documentId,
    block_data: JSON.stringify([contentBlock]),
    created_at: nowIso,
    updated_at: nowIso,
  });

  await tx.trx('document_associations')
    .insert({
      association_id: uuidv4(),
      tenant: tx.tenantId,
      document_id: documentId,
      entity_id: contact.contact_name_id,
      entity_type: 'contact',
      created_at: nowIso,
    })
    .onConflict(['tenant', 'document_id', 'entity_id', 'entity_type'])
    .ignore();

  await tx.trx('contacts')
    .where({ tenant: tx.tenantId, contact_name_id: contact.contact_name_id })
    .update({ notes_document_id: documentId, updated_at: nowIso });

  return {
    document_id: documentId,
    created_document: true,
    updated_at: nowIso,
  };
}

const maybeWorkflowActor = (userId: string): { actorType: 'USER'; actorUserId: string } =>
  ({ actorType: 'USER', actorUserId: userId });

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
    // Best-effort publication; action persistence/audit remains source of truth.
  }
}

export function registerContactActions(): void {
  const registry = getActionRegistryV2();

  // ---------------------------------------------------------------------------
  // A11 — contacts.find
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'contacts.find',
    version: 1,
    inputSchema: z
      .object({
        contact_id: withWorkflowPicker(uuidSchema.optional(), 'Contact id', 'contact'),
        email: z.string().email().optional(),
        phone: z.string().optional().describe('Phone number (normalized digits match)'),
        client_id: withWorkflowPicker(uuidSchema.optional(), 'Optional client scope', 'client'),
        on_not_found: z.enum(['return_null', 'error']).default('return_null'),
        match_strategy: z
          .enum(['first_created', 'most_recent'])
          .default('first_created')
          .describe('Deterministic ordering when multiple matches exist'),
      })
      .refine((val) => Boolean(val.contact_id || val.email || val.phone), {
        message: 'contact_id, email, or phone required',
      }),
    outputSchema: z.object({
      contact: contactSummarySchema.nullable(),
    }),
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Find Contact', category: 'Business Operations', description: 'Find a contact by id or email' },
    handler: async (input, ctx) =>
      withTenantTransaction(ctx, async (tx) => {
        await requirePermission(ctx, tx, { resource: 'contact', action: 'read' });
        const startedAt = Date.now();
        let matchedBy: 'contact_id' | 'email' | 'phone' | null = null;
        let contacts: any[] = [];
        if (input.contact_id) {
          const contact = await ContactModel.getContactById(input.contact_id, tx.tenantId, tx.trx);
          if (contact) contacts = [contact];
          matchedBy = 'contact_id';
        } else if (input.email) {
          const email = input.email.toLowerCase().trim();
          matchedBy = 'email';
          const contact = await ContactModel.getContactByEmail(email, tx.tenantId, tx.trx);
          if (contact) {
            contacts = [contact];
          }
        } else if (input.phone) {
          const digits = String(input.phone).replace(/\D/g, '');
          if (digits.length < 7) {
            throwActionError(ctx, {
              category: 'ValidationError',
              code: 'VALIDATION_ERROR',
              message: 'phone is invalid',
            });
          }
          matchedBy = 'phone';
          contacts = await tx.trx('contacts')
            .where({ tenant: tx.tenantId })
            .andWhereRaw(`regexp_replace(coalesce(phone,''), '\\\\D', '', 'g') = ?`, [digits])
            .orderBy('is_inactive', 'asc')
            .orderBy(
              input.match_strategy === 'most_recent' ? 'created_at' : 'created_at',
              input.match_strategy === 'most_recent' ? 'desc' : 'asc'
            )
            .limit(5);
        }

        if (input.client_id) {
          contacts = contacts.filter((c) => c?.client_id === input.client_id);
        }

        const contact = contacts[0] ?? null;
        if (!contact) {
          if (input.on_not_found === 'error') {
            throwActionError(ctx, {
              category: 'ActionError',
              code: 'NOT_FOUND',
              message: 'Contact not found',
              details: { matched_by: matchedBy },
            });
          }
          return { contact: null };
        }

        const parsed = contactToSummary(contact);

        ctx.logger?.info('workflow_action:contacts.find', {
          duration_ms: Date.now() - startedAt,
          matched_by: matchedBy,
          match_count: contacts.length,
        });

        return { contact: parsed };
      }),
  });

  // ---------------------------------------------------------------------------
  // A12 — contacts.search
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'contacts.search',
    version: 1,
    inputSchema: z.object({
      query: z.string().min(1).describe('Search query (name/email/phone)'),
      client_id: withWorkflowPicker(uuidSchema.optional(), 'Optional client scope', 'client'),
      filters: z
        .object({
          tags: z.array(z.string()).optional(),
          sort_by: z.enum(['name', 'updated_at']).optional(),
          sort_order: z.enum(['asc', 'desc']).optional(),
        })
        .optional(),
      page: z.number().int().positive().default(1),
      page_size: z.number().int().positive().max(100).default(25),
    }),
    outputSchema: z.object({
      contacts: z.array(contactSummarySchema),
      first_contact: contactSummarySchema.nullable(),
      page: z.number().int(),
      page_size: z.number().int(),
      total: z.number().int(),
    }),
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Search Contacts', category: 'Business Operations', description: 'Search contacts by name or email' },
    handler: async (input, ctx) =>
      withTenantTransaction(ctx, async (tx) => {
        await requirePermission(ctx, tx, { resource: 'contact', action: 'read' });

        const startedAt = Date.now();
        const minQueryLen = Number(process.env.WORKFLOW_CONTACT_SEARCH_MIN_QUERY_LEN ?? 2);
        const rawQuery = String(input.query ?? '').trim();
        if (rawQuery.length < minQueryLen) {
          throwActionError(ctx, {
            category: 'ValidationError',
            code: 'VALIDATION_ERROR',
            message: `query must be at least ${minQueryLen} characters`,
          });
        }
        const escaped = rawQuery.replace(/[%_\\]/g, (m) => `\\${m}`);
        const pattern = `%${escaped}%`;

        const page = input.page ?? 1;
        const pageSize = input.page_size ?? 25;
        const offset = (page - 1) * pageSize;
        const filters = input.filters ?? {};

        let base = tx.trx('contacts').where({ tenant: tx.tenantId }).where(function q() {
          this.whereRaw(`full_name ILIKE ? ESCAPE '\\\\'`, [pattern])
            .orWhereRaw(`email ILIKE ? ESCAPE '\\\\'`, [pattern])
            .orWhereExists(function additionalEmailSearch() {
              this.select(tx.trx.raw('1'))
                .from('contact_additional_email_addresses as caea')
                .whereRaw('caea.contact_name_id = contacts.contact_name_id')
                .andWhere('caea.tenant', tx.tenantId)
                .andWhereRaw(`caea.email_address ILIKE ? ESCAPE '\\\\'`, [pattern]);
            })
            .orWhereRaw(`phone ILIKE ? ESCAPE '\\\\'`, [pattern]);
        });

        if (input.client_id) base = base.andWhere('client_id', input.client_id);

        if (filters.tags?.length) {
          base = base
            .join('tag_mappings as tm', function joinTagMappings() {
              this.on('tm.tenant', 'contacts.tenant').andOn('tm.tagged_id', 'contacts.contact_name_id');
            })
            .join('tag_definitions as td', function joinTagDefs() {
              this.on('td.tenant', 'tm.tenant').andOn('td.tag_id', 'tm.tag_id');
            })
            .where('tm.tagged_type', 'contact')
            .whereIn('td.tag_text', filters.tags);
        }

        const countRow = await base.clone().clearSelect().clearOrder().countDistinct({ count: 'contact_name_id' }).first();
        const total = parseInt(String((countRow as any)?.count ?? 0), 10);

        const sortBy = filters.sort_by ?? 'name';
        const sortOrder = filters.sort_order ?? 'asc';

        const rows = await base
          .clone()
          .clearSelect()
          .select('*')
          .orderBy(sortBy === 'updated_at' ? 'updated_at' : 'full_name', sortOrder)
          .orderBy('contact_name_id', 'asc')
          .limit(pageSize)
          .offset(offset);

        const contacts = rows.map((row: any) => contactToSummary(row));

        ctx.logger?.info('workflow_action:contacts.search', {
          duration_ms: Date.now() - startedAt,
          query_len: rawQuery.length,
          client_scope: input.client_id ?? null,
          filters: {
            tags_count: Array.isArray(filters.tags) ? filters.tags.length : 0,
            sort_by: sortBy,
            sort_order: sortOrder,
          },
          result_count: contacts.length,
          page,
          page_size: pageSize,
          total,
        });

        return { contacts, first_contact: contacts[0] ?? null, page, page_size: pageSize, total };
      }),
  });

  // ---------------------------------------------------------------------------
  // A13 — contacts.create
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'contacts.create',
    version: 1,
    inputSchema: contactCreateInputSchema,
    outputSchema: z.object({
      created: z.boolean(),
      contact: contactSummarySchema,
    }),
    sideEffectful: true,
    idempotency: { mode: 'actionProvided', key: actionProvidedKey },
    ui: {
      label: 'Create Contact',
      category: 'Business Operations',
      description: 'Create a contact with optional client assignment, details, and initial tags',
    },
    handler: async (input, ctx) =>
      withTenantTransaction(ctx, async (tx) => {
        await requirePermission(ctx, tx, { resource: 'contact', action: 'create' });

        if (input.client_id) {
          await ensureClientExists(ctx, tx, input.client_id);
        }

        let createdContact: Record<string, any>;
        try {
          createdContact = await ContactModel.createContact(
            {
              full_name: input.full_name,
              email: input.email,
              client_id: input.client_id ?? undefined,
              role: input.role ?? undefined,
              notes: input.notes ?? undefined,
              is_inactive: input.is_inactive,
              primary_email_canonical_type: input.primary_email_canonical_type ?? undefined,
              primary_email_custom_type: input.primary_email_custom_type ?? undefined,
              phone_numbers: input.phone_numbers as ContactModelPhoneInput[] | undefined,
              additional_email_addresses: input.additional_email_addresses as ContactModelEmailInput[] | undefined,
            },
            tx.tenantId,
            tx.trx
          ) as unknown as Record<string, any>;
        } catch (error) {
          rethrowContactModelError(ctx, error);
        }

        if (input.tags?.length) {
          await ensureContactTagMappings(tx, createdContact.contact_name_id, input.tags);
        }

        const after = await ensureContactExists(ctx, tx, createdContact.contact_name_id);

        await writeRunAudit(ctx, tx, {
          operation: 'workflow_action:contacts.create',
          changedData: {
            contact_id: after.contact_name_id,
            full_name: after.full_name,
            client_id: after.client_id ?? null,
          },
          details: { action_id: 'contacts.create', action_version: 1, contact_id: after.contact_name_id },
        });

        const occurredAt = (after.created_at as string | undefined) ?? new Date().toISOString();
        await publishWorkflowDomainEvent({
          eventType: 'CONTACT_CREATED',
          payload: buildContactCreatedPayload({
            contactId: after.contact_name_id,
            clientId: after.client_id ?? null,
            fullName: after.full_name,
            email: after.email ?? undefined,
            primaryEmailCanonicalType: after.primary_email_canonical_type ?? null,
            primaryEmailCustomTypeId: after.primary_email_custom_type_id ?? null,
            primaryEmailType: after.primary_email_type ?? null,
            additionalEmailAddresses: after.additional_email_addresses ?? [],
            phoneNumbers: after.phone_numbers ?? [],
            defaultPhoneNumber: after.default_phone_number ?? undefined,
            defaultPhoneType: after.default_phone_type ?? undefined,
            createdByUserId: tx.actorUserId,
            createdAt: occurredAt,
          }),
          tenantId: tx.tenantId,
          occurredAt,
          actorUserId: tx.actorUserId,
          idempotencyKey: `contact_created:${after.contact_name_id}`,
        });

        return {
          created: true,
          contact: contactToSummary(after),
        };
      }),
  });

  // ---------------------------------------------------------------------------
  // A14 — contacts.update
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'contacts.update',
    version: 1,
    inputSchema: z.object({
      contact_id: withWorkflowPicker(uuidSchema, 'Contact id', 'contact'),
      patch: contactUpdatePatchSchema,
    }),
    outputSchema: z.object({
      contact_before: contactSummarySchema,
      contact_after: contactSummarySchema,
      changed_fields: z.array(z.string()),
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Edit Contact',
      category: 'Business Operations',
      description: 'Patch editable fields on an existing contact',
    },
    handler: async (input, ctx) =>
      withTenantTransaction(ctx, async (tx) => {
        await requirePermission(ctx, tx, { resource: 'contact', action: 'update' });

        const before = await ensureContactExists(ctx, tx, input.contact_id);
        const patch = input.patch;
        const changedFields = Object.keys(patch).filter((key) => (patch as Record<string, unknown>)[key] !== undefined);

        if (patch.client_id && patch.client_id !== before.client_id) {
          await ensureClientExists(ctx, tx, patch.client_id);
        }

        const updatePayload: Record<string, unknown> = {};
        for (const key of changedFields) {
          updatePayload[key] = (patch as Record<string, unknown>)[key];
        }

        let after: Record<string, any>;
        try {
          after = await ContactModel.updateContact(
            input.contact_id,
            updatePayload as any,
            tx.tenantId,
            tx.trx
          ) as unknown as Record<string, any>;
        } catch (error) {
          rethrowContactModelError(ctx, error);
        }

        await writeRunAudit(ctx, tx, {
          operation: 'workflow_action:contacts.update',
          changedData: {
            contact_id: input.contact_id,
            changed_fields: changedFields,
          },
          details: { action_id: 'contacts.update', action_version: 1, contact_id: input.contact_id },
        });

        const eventClientId = (after.client_id ?? before.client_id) as string | null;
        const occurredAt = (after.updated_at as string | undefined) ?? new Date().toISOString();

        const updatedPayload = buildContactUpdatedPayload({
          contactId: input.contact_id,
          clientId: eventClientId,
          before: {
            ...before,
            contact_name_id: String(before.contact_name_id ?? input.contact_id),
          },
          after: {
            ...after,
            contact_name_id: String(after.contact_name_id ?? input.contact_id),
          },
          updatedFieldKeys: changedFields,
          updatedByUserId: tx.actorUserId,
          updatedAt: occurredAt,
        });
        const updatedFields = (updatedPayload as { updatedFields?: string[] }).updatedFields ?? [];
        if (updatedFields.length > 0) {
          await publishWorkflowDomainEvent({
            eventType: 'CONTACT_UPDATED',
            payload: updatedPayload,
            tenantId: tx.tenantId,
            occurredAt,
            actorUserId: tx.actorUserId,
            idempotencyKey: `contact_updated:${input.contact_id}:${occurredAt}`,
          });
        }

        const wasInactive = Boolean(before.is_inactive);
        const isInactive = Boolean(after.is_inactive);
        if (!wasInactive && isInactive) {
          await publishWorkflowDomainEvent({
            eventType: 'CONTACT_ARCHIVED',
            payload: buildContactArchivedPayload({
              contactId: input.contact_id,
              clientId: eventClientId,
              archivedByUserId: tx.actorUserId,
              archivedAt: occurredAt,
            }),
            tenantId: tx.tenantId,
            occurredAt,
            actorUserId: tx.actorUserId,
            idempotencyKey: `contact_archived:${input.contact_id}:${occurredAt}`,
          });
        }

        return {
          contact_before: contactToSummary(before),
          contact_after: contactToSummary(after),
          changed_fields: changedFields,
        };
      }),
  });

  // ---------------------------------------------------------------------------
  // A15 — contacts.deactivate
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'contacts.deactivate',
    version: 1,
    inputSchema: z.object({
      contact_id: withWorkflowPicker(uuidSchema, 'Contact id', 'contact'),
      reason: z.string().optional().describe('Optional reason/audit detail for deactivation'),
    }),
    outputSchema: z.object({
      contact_id: uuidSchema,
      deactivated: z.boolean(),
      noop: z.boolean(),
      previous_is_inactive: z.boolean(),
      current_is_inactive: z.boolean(),
      contact: contactSummarySchema,
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Deactivate Contact',
      category: 'Business Operations',
      description: 'Set a contact inactive without deleting records',
    },
    handler: async (input, ctx) =>
      withTenantTransaction(ctx, async (tx) => {
        await requirePermission(ctx, tx, { resource: 'contact', action: 'update' });

        const before = await ensureContactExists(ctx, tx, input.contact_id);
        const previousInactive = Boolean(before.is_inactive);
        let currentInactive = previousInactive;
        let after = before;

        if (!previousInactive) {
          const nowIso = new Date().toISOString();
          await tx.trx('contacts')
            .where({ tenant: tx.tenantId, contact_name_id: input.contact_id })
            .update({ is_inactive: true, updated_at: nowIso });
          after = await ensureContactExists(ctx, tx, input.contact_id);
          currentInactive = Boolean(after.is_inactive);

          await publishWorkflowDomainEvent({
            eventType: 'CONTACT_ARCHIVED',
            payload: buildContactArchivedPayload({
              contactId: input.contact_id,
              clientId: after.client_id ?? null,
              archivedByUserId: tx.actorUserId,
              archivedAt: nowIso,
              reason: input.reason,
            }),
            tenantId: tx.tenantId,
            occurredAt: nowIso,
            actorUserId: tx.actorUserId,
            idempotencyKey: `contact_archived:${input.contact_id}:${nowIso}`,
          });
        }

        await writeRunAudit(ctx, tx, {
          operation: 'workflow_action:contacts.deactivate',
          changedData: {
            contact_id: input.contact_id,
            previous_is_inactive: previousInactive,
            current_is_inactive: currentInactive,
            noop: previousInactive,
          },
          details: {
            action_id: 'contacts.deactivate',
            action_version: 1,
            contact_id: input.contact_id,
            reason: input.reason ?? null,
          },
        });

        return {
          contact_id: input.contact_id,
          deactivated: !previousInactive,
          noop: previousInactive,
          previous_is_inactive: previousInactive,
          current_is_inactive: currentInactive,
          contact: contactToSummary(after),
        };
      }),
  });

  // ---------------------------------------------------------------------------
  // A16 — contacts.delete
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'contacts.delete',
    version: 1,
    inputSchema: z.object({
      contact_id: withWorkflowPicker(uuidSchema, 'Contact id', 'contact'),
      confirm: z.boolean().refine((value) => value === true, { message: 'confirm must be true to delete a contact' }),
      on_not_found: z.enum(['error', 'return_false']).default('error'),
    }),
    outputSchema: z.object({
      deleted: z.boolean(),
      contact_id: uuidSchema,
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Delete Contact',
      category: 'Business Operations',
      description: 'Destructive hard-delete for a contact with dependency validation',
    },
    handler: async (input, ctx) =>
      withTenantTransaction(ctx, async (tx) => {
        await requirePermission(ctx, tx, { resource: 'contact', action: 'delete' });

        const existing = await tx.trx('contacts')
          .where({ tenant: tx.tenantId, contact_name_id: input.contact_id })
          .first();

        if (!existing) {
          if (input.on_not_found === 'return_false') {
            return { deleted: false, contact_id: input.contact_id };
          }
          throwActionError(ctx, {
            category: 'ActionError',
            code: 'NOT_FOUND',
            message: 'Contact not found',
            details: { contact_id: input.contact_id },
          });
        }

        const result = await deleteEntityWithValidation(
          'contact',
          input.contact_id,
          tx.trx,
          tx.tenantId,
          async (trx: Knex.Transaction, tenantId: string) => {
            await cleanupContactDeleteArtifacts(trx, tenantId, input.contact_id);
            await cleanupContactNotesDocument(trx, tenantId, input.contact_id);
            await cleanupEntraReferencesBeforeContactDelete(trx, tenantId, input.contact_id);
            await trx('contacts').where({ tenant: tenantId, contact_name_id: input.contact_id }).delete();
          }
        );

        if (!result?.deleted) {
          throwActionError(ctx, {
            category: 'ActionError',
            code: 'CONFLICT',
            message: result?.message ?? 'Unable to delete contact due to dependencies',
            details: {
              dependencies: result?.dependencies ?? [],
              alternatives: result?.alternatives ?? [],
            },
          });
        }

        await writeRunAudit(ctx, tx, {
          operation: 'workflow_action:contacts.delete',
          changedData: { contact_id: input.contact_id, deleted: true },
          details: { action_id: 'contacts.delete', action_version: 1, contact_id: input.contact_id },
        });

        return { deleted: true, contact_id: input.contact_id };
      }),
  });

  // ---------------------------------------------------------------------------
  // A17 — contacts.duplicate
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'contacts.duplicate',
    version: 1,
    inputSchema: contactDuplicateInputSchema,
    outputSchema: z.object({
      source_contact: contactSummarySchema,
      duplicate_contact: contactSummarySchema,
      copied_tags: z.number().int(),
    }),
    sideEffectful: true,
    idempotency: { mode: 'actionProvided', key: actionProvidedKey },
    ui: {
      label: 'Duplicate Contact',
      category: 'Business Operations',
      description: 'Create a new contact from a source contact with explicit email override',
    },
    handler: async (input, ctx) =>
      withTenantTransaction(ctx, async (tx) => {
        await requirePermission(ctx, tx, { resource: 'contact', action: 'read' });
        await requirePermission(ctx, tx, { resource: 'contact', action: 'create' });

        const source = await ensureContactExists(ctx, tx, input.source_contact_id);

        const targetClientId = Object.prototype.hasOwnProperty.call(input, 'target_client_id')
          ? input.target_client_id
          : source.client_id ?? null;

        if (typeof targetClientId === 'string' && targetClientId) {
          await ensureClientExists(ctx, tx, targetClientId);
        }

        let duplicate: Record<string, any>;
        const sourcePhoneNumbers: ContactModelPhoneInput[] = Array.isArray(source.phone_numbers)
          ? source.phone_numbers.map((phone: Record<string, unknown>, index: number) => ({
              phone_number: phone.phone_number as string,
              canonical_type: isContactPhoneCanonicalType(phone.canonical_type) ? phone.canonical_type : undefined,
              custom_type: (phone.custom_type as string | null | undefined) ?? undefined,
              is_default: Boolean(phone.is_default),
              display_order: typeof phone.display_order === 'number' ? phone.display_order : index,
            }))
          : [];
        try {
          duplicate = await ContactModel.createContact(
            {
              full_name: input.full_name ?? source.full_name,
              email: input.email,
              client_id: targetClientId ?? undefined,
              role: Object.prototype.hasOwnProperty.call(input, 'role') ? (input.role ?? undefined) : (source.role ?? undefined),
              notes: Object.prototype.hasOwnProperty.call(input, 'notes') ? (input.notes ?? undefined) : (source.notes ?? undefined),
              is_inactive: input.is_inactive ?? Boolean(source.is_inactive),
              primary_email_canonical_type:
                input.primary_email_canonical_type ?? source.primary_email_canonical_type ?? undefined,
              primary_email_custom_type: input.primary_email_custom_type ?? undefined,
              phone_numbers: (input.phone_numbers as ContactModelPhoneInput[] | undefined) ?? sourcePhoneNumbers,
              additional_email_addresses: (input.additional_email_addresses as ContactModelEmailInput[] | undefined) ?? [],
            },
            tx.tenantId,
            tx.trx
          ) as unknown as Record<string, any>;
        } catch (error) {
          rethrowContactModelError(ctx, error);
        }

        let copiedTags = 0;
        if (input.copy_tags) {
          const sourceTags = await tx.trx('tag_mappings as tm')
            .join('tag_definitions as td', function joinTagDefs() {
              this.on('tm.tenant', 'td.tenant').andOn('tm.tag_id', 'td.tag_id');
            })
            .where({
              'tm.tenant': tx.tenantId,
              'tm.tagged_type': 'contact',
              'tm.tagged_id': input.source_contact_id,
              'td.tagged_type': 'contact',
            })
            .select('td.tag_text');

          const tagResult = await ensureContactTagMappings(
            tx,
            duplicate.contact_name_id,
            sourceTags.map((row: { tag_text: string }) => row.tag_text)
          );
          copiedTags = tagResult.added.length + tagResult.existing.length;
        }

        const duplicateLoaded = await ensureContactExists(ctx, tx, duplicate.contact_name_id);

        await writeRunAudit(ctx, tx, {
          operation: 'workflow_action:contacts.duplicate',
          changedData: {
            source_contact_id: input.source_contact_id,
            duplicate_contact_id: duplicateLoaded.contact_name_id,
            copied_tags: copiedTags,
          },
          details: {
            action_id: 'contacts.duplicate',
            action_version: 1,
            contact_id: duplicateLoaded.contact_name_id,
          },
        });

        return {
          source_contact: contactToSummary(source),
          duplicate_contact: contactToSummary(duplicateLoaded),
          copied_tags: copiedTags,
        };
      }),
  });

  // ---------------------------------------------------------------------------
  // A18 — contacts.add_tag
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'contacts.add_tag',
    version: 1,
    inputSchema: z.object({
      contact_id: withWorkflowPicker(uuidSchema, 'Contact id', 'contact'),
      tags: z.array(z.string().min(1)).min(1).describe('One or more tags to attach to the contact'),
      idempotency_key: z.string().optional().describe('Optional external idempotency key'),
    }),
    outputSchema: z.object({
      contact_id: uuidSchema,
      added: z.array(tagResultSchema),
      existing: z.array(tagResultSchema),
      added_count: z.number().int(),
      existing_count: z.number().int(),
    }),
    sideEffectful: true,
    idempotency: { mode: 'actionProvided', key: actionProvidedKey },
    ui: {
      label: 'Add Tag to Contact',
      category: 'Business Operations',
      description: 'Attach one or more tags to a contact with idempotent behavior',
    },
    handler: async (input, ctx) =>
      withTenantTransaction(ctx, async (tx) => {
        await requirePermission(ctx, tx, { resource: 'contact', action: 'update' });

        await ensureContactExists(ctx, tx, input.contact_id);
        const tagResult = await ensureContactTagMappings(tx, input.contact_id, input.tags);

        await writeRunAudit(ctx, tx, {
          operation: 'workflow_action:contacts.add_tag',
          changedData: {
            contact_id: input.contact_id,
            added_count: tagResult.added.length,
            existing_count: tagResult.existing.length,
          },
          details: { action_id: 'contacts.add_tag', action_version: 1, contact_id: input.contact_id },
        });

        return {
          contact_id: input.contact_id,
          added: tagResult.added,
          existing: tagResult.existing,
          added_count: tagResult.added.length,
          existing_count: tagResult.existing.length,
        };
      }),
  });

  // ---------------------------------------------------------------------------
  // A19 — contacts.assign_to_ticket
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'contacts.assign_to_ticket',
    version: 1,
    inputSchema: z.object({
      contact_id: withWorkflowPicker(uuidSchema, 'Contact id', 'contact'),
      ticket_id: withWorkflowPicker(uuidSchema, 'Ticket id', 'ticket'),
      reason: z.string().optional().describe('Optional reason/audit detail for assignment'),
      comment: z.string().optional().describe('Optional internal comment/audit detail for assignment'),
    }),
    outputSchema: z.object({
      ticket_id: uuidSchema,
      previous_contact_id: nullableUuidSchema,
      current_contact_id: nullableUuidSchema,
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Assign Contact to Ticket',
      category: 'Business Operations',
      description: 'Set a ticket contact with tenant/client relationship validation',
    },
    handler: async (input, ctx) =>
      withTenantTransaction(ctx, async (tx) => {
        await requirePermission(ctx, tx, { resource: 'ticket', action: 'update' });
        await requirePermission(ctx, tx, { resource: 'contact', action: 'read' });

        const ticket = await ensureTicketExists(ctx, tx, input.ticket_id);
        const contact = await ensureContactExists(ctx, tx, input.contact_id);

        if (ticket.client_id && contact.client_id !== ticket.client_id) {
          throwActionError(ctx, {
            category: 'ValidationError',
            code: 'VALIDATION_ERROR',
            message: 'Contact must belong to the ticket client',
            details: {
              contact_id: input.contact_id,
              contact_client_id: contact.client_id ?? null,
              ticket_id: input.ticket_id,
              ticket_client_id: ticket.client_id,
            },
          });
        }

        const previousContactId = ticket.contact_name_id ?? null;
        await tx.trx('tickets')
          .where({ tenant: tx.tenantId, ticket_id: input.ticket_id })
          .update({ contact_name_id: input.contact_id, updated_at: new Date().toISOString() });

        const after = await ensureTicketExists(ctx, tx, input.ticket_id);

        await writeRunAudit(ctx, tx, {
          operation: 'workflow_action:contacts.assign_to_ticket',
          changedData: {
            ticket_id: input.ticket_id,
            previous_contact_id: previousContactId,
            current_contact_id: after.contact_name_id ?? null,
          },
          details: {
            action_id: 'contacts.assign_to_ticket',
            action_version: 1,
            contact_id: input.contact_id,
            reason: input.reason ?? null,
            comment: input.comment ?? null,
          },
        });

        return {
          ticket_id: input.ticket_id,
          previous_contact_id: previousContactId,
          current_contact_id: after.contact_name_id ?? null,
        };
      }),
  });

  // ---------------------------------------------------------------------------
  // A20 — contacts.add_note
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'contacts.add_note',
    version: 1,
    inputSchema: z.object({
      contact_id: withWorkflowPicker(uuidSchema, 'Contact id', 'contact'),
      body: z.string().min(1).describe('Note content to append to the contact notes document'),
      idempotency_key: z.string().optional().describe('Optional external idempotency key'),
    }),
    outputSchema: z.object({
      contact_id: uuidSchema,
      document_id: uuidSchema,
      created_document: z.boolean(),
      updated_at: isoDateTimeSchema,
    }),
    sideEffectful: true,
    idempotency: { mode: 'actionProvided', key: actionProvidedKey },
    ui: {
      label: 'Add Note to Contact',
      category: 'Business Operations',
      description: 'Append a note block to the contact notes document',
    },
    handler: async (input, ctx) =>
      withTenantTransaction(ctx, async (tx) => {
        await requirePermission(ctx, tx, { resource: 'contact', action: 'update' });

        const contact = await ensureContactExists(ctx, tx, input.contact_id);
        const result = await appendContactNoteBlock(tx, contact, input.body);

        await writeRunAudit(ctx, tx, {
          operation: 'workflow_action:contacts.add_note',
          changedData: {
            contact_id: input.contact_id,
            document_id: result.document_id,
            created_document: result.created_document,
          },
          details: { action_id: 'contacts.add_note', action_version: 1, contact_id: input.contact_id },
        });

        if (result.created_document) {
          await publishWorkflowDomainEvent({
            eventType: 'NOTE_CREATED',
            payload: buildNoteCreatedPayload({
              noteId: result.document_id,
              entityType: 'contact',
              entityId: input.contact_id,
              createdByUserId: tx.actorUserId,
              createdAt: result.updated_at,
              visibility: 'internal',
              bodyPreview: input.body,
            }),
            tenantId: tx.tenantId,
            occurredAt: result.updated_at,
            actorUserId: tx.actorUserId,
            idempotencyKey: `note_created:contact:${input.contact_id}:${result.document_id}`,
          });
        }

        return {
          contact_id: input.contact_id,
          document_id: result.document_id,
          created_document: result.created_document,
          updated_at: result.updated_at,
        };
      }),
  });

  // ---------------------------------------------------------------------------
  // A21 — contacts.add_interaction
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'contacts.add_interaction',
    version: 1,
    inputSchema: z.object({
      contact_id: withWorkflowPicker(uuidSchema, 'Contact id', 'contact'),
      interaction_type_id: uuidSchema.describe('Interaction type id'),
      title: z.string().min(1),
      ticket_id: withWorkflowPicker(uuidSchema.optional(), 'Optional ticket id', 'ticket'),
      notes: z.string().optional(),
      start_time: isoDateTimeSchema.optional(),
      end_time: isoDateTimeSchema.optional(),
      duration: z.number().int().nonnegative().optional(),
      status_id: uuidSchema.optional(),
      interaction_date: isoDateTimeSchema.optional(),
      idempotency_key: z.string().optional().describe('Optional external idempotency key'),
    }),
    outputSchema: z.object({
      interaction_id: uuidSchema,
      contact_id: uuidSchema,
      client_id: uuidSchema,
      ticket_id: nullableUuidSchema,
      interaction_type_id: uuidSchema,
      status_id: nullableUuidSchema,
      title: z.string(),
      notes: z.string().nullable(),
      interaction_date: isoDateTimeSchema,
      start_time: isoDateTimeSchema.nullable(),
      end_time: isoDateTimeSchema.nullable(),
      duration: z.number().int().nullable(),
      user_id: uuidSchema,
    }),
    sideEffectful: true,
    idempotency: { mode: 'actionProvided', key: actionProvidedKey },
    ui: {
      label: 'Add Interaction to Contact',
      category: 'Business Operations',
      description: 'Log an interaction for a contact using the workflow actor as owner',
    },
    handler: async (input, ctx) =>
      withTenantTransaction(ctx, async (tx) => {
        await requirePermission(ctx, tx, { resource: 'contact', action: 'update' });

        const contact = await ensureContactExists(ctx, tx, input.contact_id);
        if (!contact.client_id) {
          throwActionError(ctx, {
            category: 'ValidationError',
            code: 'VALIDATION_ERROR',
            message: 'Contact must be assigned to a client before logging interactions',
            details: { contact_id: input.contact_id },
          });
        }

        if (input.ticket_id) {
          const ticket = await ensureTicketExists(ctx, tx, input.ticket_id);
          if (ticket.client_id && ticket.client_id !== contact.client_id) {
            throwActionError(ctx, {
              category: 'ValidationError',
              code: 'VALIDATION_ERROR',
              message: 'ticket_id must belong to the contact client',
              details: {
                ticket_id: input.ticket_id,
                ticket_client_id: ticket.client_id,
                contact_client_id: contact.client_id,
              },
            });
          }
        }

        if (input.status_id) {
          const status = await tx.trx('statuses')
            .where({ tenant: tx.tenantId, status_id: input.status_id, status_type: 'interaction' })
            .first();
          if (!status) {
            throwActionError(ctx, {
              category: 'ActionError',
              code: 'NOT_FOUND',
              message: 'Interaction status not found',
              details: { status_id: input.status_id },
            });
          }
        }

        const statusId = input.status_id ?? (await getDefaultInteractionStatusId(ctx, tx));
        const interactionDate = input.interaction_date ?? new Date().toISOString();

        const insertRow = {
          tenant: tx.tenantId,
          interaction_id: uuidv4(),
          type_id: input.interaction_type_id,
          contact_name_id: input.contact_id,
          client_id: contact.client_id,
          user_id: tx.actorUserId,
          ticket_id: input.ticket_id ?? null,
          title: input.title,
          notes: input.notes ?? null,
          interaction_date: interactionDate,
          start_time: input.start_time ?? interactionDate,
          end_time: input.end_time ?? interactionDate,
          duration: input.duration ?? 0,
          status_id: statusId,
        };

        let created: any;
        try {
          [created] = await tx.trx('interactions').insert(insertRow).returning('*');
        } catch (error) {
          rethrowAsStandardError(ctx, error);
        }

        await writeRunAudit(ctx, tx, {
          operation: 'workflow_action:contacts.add_interaction',
          changedData: {
            interaction_id: created.interaction_id,
            contact_id: created.contact_name_id,
            client_id: created.client_id,
            ticket_id: created.ticket_id ?? null,
            type_id: created.type_id,
          },
          details: {
            action_id: 'contacts.add_interaction',
            action_version: 1,
            contact_id: input.contact_id,
            interaction_id: created.interaction_id,
          },
        });

        await publishWorkflowDomainEvent({
          eventType: 'INTERACTION_LOGGED',
          payload: buildInteractionLoggedPayload({
            interactionId: created.interaction_id,
            clientId: created.client_id,
            contactId: created.contact_name_id ?? undefined,
            interactionType: String(created.type_name ?? created.type_id ?? 'interaction'),
            interactionOccurredAt:
              created.interaction_date instanceof Date
                ? created.interaction_date.toISOString()
                : String(created.interaction_date),
            loggedByUserId: created.user_id,
            subject: created.title ?? undefined,
            outcome: created.status_name ?? undefined,
          }),
          tenantId: tx.tenantId,
          occurredAt:
            created.interaction_date instanceof Date
              ? created.interaction_date.toISOString()
              : String(created.interaction_date),
          actorUserId: tx.actorUserId,
          idempotencyKey: `interaction_logged:${created.interaction_id}`,
        });

        return {
          interaction_id: created.interaction_id,
          contact_id: created.contact_name_id,
          client_id: created.client_id,
          ticket_id: created.ticket_id ?? null,
          interaction_type_id: created.type_id,
          status_id: created.status_id ?? null,
          title: created.title,
          notes: created.notes ?? null,
          interaction_date:
            created.interaction_date instanceof Date
              ? created.interaction_date.toISOString()
              : String(created.interaction_date),
          start_time:
            created.start_time instanceof Date
              ? created.start_time.toISOString()
              : created.start_time
                ? String(created.start_time)
                : null,
          end_time:
            created.end_time instanceof Date
              ? created.end_time.toISOString()
              : created.end_time
                ? String(created.end_time)
                : null,
          duration:
            typeof created.duration === 'number' ? created.duration : created.duration ? Number(created.duration) : null,
          user_id: created.user_id,
        };
      }),
  });

  // ---------------------------------------------------------------------------
  // A22 — contacts.add_to_client
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'contacts.add_to_client',
    version: 1,
    inputSchema: z.object({
      contact_id: withWorkflowPicker(uuidSchema, 'Contact id', 'contact'),
      client_id: withWorkflowPicker(uuidSchema, 'Client id', 'client'),
    }),
    outputSchema: z.object({
      contact_id: uuidSchema,
      previous_client_id: nullableUuidSchema,
      current_client_id: nullableUuidSchema,
      noop: z.boolean(),
      contact: contactSummarySchema,
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Add Contact to Client',
      category: 'Business Operations',
      description: 'Assign an unassigned contact to a client with idempotent semantics',
    },
    handler: async (input, ctx) =>
      withTenantTransaction(ctx, async (tx) => {
        await requirePermission(ctx, tx, { resource: 'contact', action: 'update' });

        await ensureClientExists(ctx, tx, input.client_id);
        const before = await ensureContactExists(ctx, tx, input.contact_id);

        const previousClientId = before.client_id ?? null;
        if (previousClientId && previousClientId !== input.client_id) {
          throwActionError(ctx, {
            category: 'ActionError',
            code: 'CONFLICT',
            message: 'Contact is already assigned to a different client; use contacts.move_to_client',
            details: {
              contact_id: input.contact_id,
              previous_client_id: previousClientId,
              requested_client_id: input.client_id,
            },
          });
        }

        let after = before;
        const noop = previousClientId === input.client_id;
        if (!noop) {
          await tx.trx('contacts')
            .where({ tenant: tx.tenantId, contact_name_id: input.contact_id })
            .update({ client_id: input.client_id, updated_at: new Date().toISOString() });
          after = await ensureContactExists(ctx, tx, input.contact_id);
        }

        await writeRunAudit(ctx, tx, {
          operation: 'workflow_action:contacts.add_to_client',
          changedData: {
            contact_id: input.contact_id,
            previous_client_id: previousClientId,
            current_client_id: after.client_id ?? null,
            noop,
          },
          details: {
            action_id: 'contacts.add_to_client',
            action_version: 1,
            contact_id: input.contact_id,
          },
        });

        return {
          contact_id: input.contact_id,
          previous_client_id: previousClientId,
          current_client_id: after.client_id ?? null,
          noop,
          contact: contactToSummary(after),
        };
      }),
  });

  // ---------------------------------------------------------------------------
  // A23 — contacts.move_to_client
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'contacts.move_to_client',
    version: 1,
    inputSchema: z.object({
      contact_id: withWorkflowPicker(uuidSchema, 'Contact id', 'contact'),
      target_client_id: withWorkflowPicker(uuidSchema, 'Target client id', 'client'),
      expected_current_client_id: withWorkflowPicker(nullableUuidSchema.optional(), 'Optional expected current client id', 'client'),
    }),
    outputSchema: z.object({
      contact_id: uuidSchema,
      previous_client_id: nullableUuidSchema,
      current_client_id: nullableUuidSchema,
      noop: z.boolean(),
      contact: contactSummarySchema,
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Move Contact to Client',
      category: 'Business Operations',
      description: 'Move a contact to another client with optional source-client guard',
    },
    handler: async (input, ctx) =>
      withTenantTransaction(ctx, async (tx) => {
        await requirePermission(ctx, tx, { resource: 'contact', action: 'update' });

        await ensureClientExists(ctx, tx, input.target_client_id);
        const before = await ensureContactExists(ctx, tx, input.contact_id);
        const previousClientId = before.client_id ?? null;

        if (Object.prototype.hasOwnProperty.call(input, 'expected_current_client_id')) {
          const expected = input.expected_current_client_id ?? null;
          if (expected !== previousClientId) {
            throwActionError(ctx, {
              category: 'ActionError',
              code: 'CONFLICT',
              message: 'Contact current client did not match expected_current_client_id',
              details: {
                contact_id: input.contact_id,
                expected_current_client_id: expected,
                actual_current_client_id: previousClientId,
              },
            });
          }
        }

        let after = before;
        const noop = previousClientId === input.target_client_id;

        if (!noop) {
          await tx.trx('contacts')
            .where({ tenant: tx.tenantId, contact_name_id: input.contact_id })
            .update({ client_id: input.target_client_id, updated_at: new Date().toISOString() });
          after = await ensureContactExists(ctx, tx, input.contact_id);
        }

        await writeRunAudit(ctx, tx, {
          operation: 'workflow_action:contacts.move_to_client',
          changedData: {
            contact_id: input.contact_id,
            previous_client_id: previousClientId,
            current_client_id: after.client_id ?? null,
            noop,
          },
          details: {
            action_id: 'contacts.move_to_client',
            action_version: 1,
            contact_id: input.contact_id,
            expected_current_client_id: input.expected_current_client_id ?? null,
          },
        });

        return {
          contact_id: input.contact_id,
          previous_client_id: previousClientId,
          current_client_id: after.client_id ?? null,
          noop,
          contact: contactToSummary(after),
        };
      }),
  });
}
