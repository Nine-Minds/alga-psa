import { z } from 'zod';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { deleteEntityWithValidation, isEnterprise } from '@alga-psa/core';
import { ensureDefaultContractForClientIfBillingConfigured } from '../../../../billingClients/defaultContract';
import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { withWorkflowJsonSchemaMetadata } from '../../jsonSchemaMetadata';
import { ClientModel } from '../../../../models/clientModel';
import { buildClientArchivedPayload, buildClientCreatedPayload, buildClientUpdatedPayload } from '../../../streams/domainEventBuilders/clientEventBuilders';
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
  'client-location': 'Search locations',
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

const CLIENT_TABLE_ALLOWED_FIELDS = new Set([
  'client_name',
  'client_type',
  'url',
  'billing_email',
  'notes',
  'properties',
  'default_currency_code',
  'parent_client_id',
  'contract_line_id',
  'is_default',
  'is_inactive',
  'region_code',
  'tax_id_number',
  'is_tax_exempt',
  'tax_exemption_certificate',
  'payment_terms',
  'preferred_payment_method',
  'auto_invoice',
  'invoice_delivery_method',
  'billing_cycle',
  'timezone',
  'account_manager_id',
  'billing_contact_id',
]);

const LOCATION_TABLE_ALLOWED_FIELDS = new Set([
  'location_name',
  'address_line1',
  'address_line2',
  'city',
  'state_province',
  'postal_code',
  'country_code',
  'country_name',
  'phone',
  'email',
  'is_default',
  'is_billing_address',
  'is_shipping_address',
  'is_active',
]);

const clientSummarySchema = z.object({
  client_id: uuidSchema,
  client_name: z.string(),
  client_type: z.string().nullable().optional(),
  url: z.string().nullable(),
  billing_email: z.string().nullable().optional(),
  is_inactive: z.boolean(),
  properties: z.record(z.unknown()).nullable(),
  updated_at: isoDateTimeSchema.optional(),
});

const contactSummarySchema = z.object({
  contact_name_id: uuidSchema,
  full_name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  client_id: uuidSchema.nullable(),
});

const tagResultSchema = z.object({
  tag_id: uuidSchema,
  tag_text: z.string(),
  mapping_id: uuidSchema.optional(),
});

const nullableUuidSchema = z.union([uuidSchema, z.null()]);

type ClientRow = Record<string, any> & { client_id: string };

type ContractRow = { contract_id: string };
type ClientContractAssignmentRow = { client_contract_id: string; contract_id: string };

const clientCreateInputSchema = z.object({
  client_name: z.string().min(1),
  client_type: z.enum(['company', 'individual']).optional(),
  url: z.string().url().optional(),
  phone_no: z.string().optional(),
  email: z.string().email().optional(),
  address: z.string().optional(),
  address_2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  country: z.string().optional(),
  default_currency_code: z.string().optional(),
  notes: z.string().optional(),
  properties: z.record(z.unknown()).optional(),
  parent_client_id: nullableUuidSchema.optional(),
  contract_line_id: nullableUuidSchema.optional(),
  is_default: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  idempotency_key: z.string().optional().describe('Optional external idempotency key'),
});

const clientUpdatePatchSchema = z
  .object({
    client_name: z.string().min(1).optional(),
    client_type: z.enum(['company', 'individual']).nullable().optional(),
    url: z.string().url().nullable().optional(),
    phone_no: z.string().nullable().optional(),
    email: z.string().email().nullable().optional(),
    address: z.string().nullable().optional(),
    address_2: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    state: z.string().nullable().optional(),
    zip: z.string().nullable().optional(),
    country: z.string().nullable().optional(),
    default_currency_code: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    properties: z.record(z.unknown()).nullable().optional(),
    parent_client_id: nullableUuidSchema.optional(),
    contract_line_id: nullableUuidSchema.optional(),
    is_default: z.boolean().nullable().optional(),
    is_inactive: z.boolean().optional(),
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

const parseClientProperties = (value: unknown): Record<string, unknown> | null => {
  const parsed = parseJsonMaybe(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  return parsed as Record<string, unknown>;
};

const clientToSummary = (row: Record<string, unknown>) =>
  clientSummarySchema.parse({
    client_id: row.client_id,
    client_name: row.client_name,
    client_type: (row.client_type as string | null | undefined) ?? null,
    url: (row.url as string | null | undefined) ?? null,
    billing_email: (row.billing_email as string | null | undefined) ?? null,
    is_inactive: Boolean(row.is_inactive),
    properties: parseClientProperties(row.properties),
    updated_at:
      typeof row.updated_at === 'string'
        ? row.updated_at
        : row.updated_at instanceof Date
          ? row.updated_at.toISOString()
          : undefined,
  });

async function ensureClientExists(ctx: any, tx: TenantTxContext, clientId: string): Promise<ClientRow> {
  const client = await tx.trx('clients').where({ tenant: tx.tenantId, client_id: clientId }).first();
  if (!client) {
    throwActionError(ctx, {
      category: 'ActionError',
      code: 'NOT_FOUND',
      message: 'Client not found',
      details: { client_id: clientId },
    });
  }
  return client as ClientRow;
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

async function deactivateClientUsersForClient(tx: TenantTxContext, clientId: string): Promise<void> {
  const contacts = await tx.trx('contacts')
    .where({ tenant: tx.tenantId, client_id: clientId })
    .select('contact_name_id');

  await tx.trx('contacts').where({ tenant: tx.tenantId, client_id: clientId }).update({ is_inactive: true });

  const contactIds = contacts
    .map((row: { contact_name_id?: string | null }) => row.contact_name_id)
    .filter((value: string | null | undefined): value is string => Boolean(value));

  if (contactIds.length > 0) {
    await tx.trx('users')
      .where({ tenant: tx.tenantId, user_type: 'client' })
      .whereIn('contact_id', contactIds)
      .update({ is_inactive: true });
  }
}

async function upsertDefaultClientLocation(
  tx: TenantTxContext,
  clientId: string,
  input: {
    address?: string | null;
    address_2?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
    country?: string | null;
    email?: string | null;
    phone_no?: string | null;
  },
  options: { createIfMissing: boolean }
): Promise<void> {
  const locationColumns = await getTableColumns(tx, 'client_locations');

  const locationPatch = pickExistingFields(
    {
      address_line1: input.address,
      address_line2: input.address_2,
      city: input.city,
      state_province: input.state,
      postal_code: input.zip,
      country_name: input.country,
      email: input.email,
      phone: input.phone_no,
      is_default: true,
      is_billing_address: true,
      is_shipping_address: true,
      is_active: true,
      updated_at: new Date().toISOString(),
    },
    locationColumns,
    new Set([...LOCATION_TABLE_ALLOWED_FIELDS, 'updated_at'])
  );

  const hasAnyValue =
    input.address !== undefined ||
    input.address_2 !== undefined ||
    input.city !== undefined ||
    input.state !== undefined ||
    input.zip !== undefined ||
    input.country !== undefined ||
    input.email !== undefined ||
    input.phone_no !== undefined;

  if (!hasAnyValue) return;

  let location = await tx.trx('client_locations')
    .where({ tenant: tx.tenantId, client_id: clientId, is_default: true })
    .first();

  if (!location) {
    if (!options.createIfMissing) {
      return;
    }

    const insertRow = pickExistingFields(
      {
        location_id: uuidv4(),
        tenant: tx.tenantId,
        client_id: clientId,
        location_name: 'Main Office',
        address_line1: input.address ?? '',
        address_line2: input.address_2 ?? null,
        city: input.city ?? '',
        state_province: input.state ?? null,
        postal_code: input.zip ?? null,
        country_code: input.country ? String(input.country).slice(0, 2).toUpperCase() : 'US',
        country_name: input.country ?? 'United States',
        phone: input.phone_no ?? null,
        email: input.email ?? null,
        is_default: true,
        is_billing_address: true,
        is_shipping_address: true,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      locationColumns,
      new Set([...LOCATION_TABLE_ALLOWED_FIELDS, 'location_id', 'tenant', 'client_id', 'created_at', 'updated_at'])
    );

    if (Object.keys(insertRow).length > 0) {
      await tx.trx('client_locations').insert(insertRow);
    }
    return;
  }

  if (Object.keys(locationPatch).length > 0) {
    await tx.trx('client_locations')
      .where({ tenant: tx.tenantId, client_id: clientId, location_id: location.location_id })
      .update(locationPatch);
  }
}

async function ensureClientTagMappings(
  tx: TenantTxContext,
  clientId: string,
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
        tagged_type: 'client',
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
        tagged_type: 'client',
      })
      .first();

    if (!definition?.tag_id) {
      throw new Error(`Failed to resolve tag definition for \"${tagText}\"`);
    }

    const mappingId = uuidv4();
    const mappingRow = pickExistingFields(
      {
        tenant: tx.tenantId,
        mapping_id: mappingId,
        tag_id: definition.tag_id,
        tagged_id: clientId,
        tagged_type: 'client',
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
        tagged_id: clientId,
        tagged_type: 'client',
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

async function cleanupDefaultContractsForDeletedClient(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string
): Promise<void> {
  const existingTables = await getExistingPublicTables(trx, ['contracts', 'client_contracts', 'invoice_charges']);
  if (!existingTables.has('contracts') || !existingTables.has('client_contracts')) {
    return;
  }

  const defaultContracts = await trx('contracts')
    .where({
      tenant,
      owner_client_id: clientId,
      is_system_managed_default: true,
    })
    .select('contract_id') as ContractRow[];

  const assignmentsForClient = await trx('client_contracts')
    .where({ tenant, client_id: clientId })
    .select('client_contract_id', 'contract_id') as ClientContractAssignmentRow[];

  const assignmentsById = new Map<string, string>();
  for (const assignment of assignmentsForClient) {
    assignmentsById.set(assignment.client_contract_id, assignment.contract_id);
  }

  const invoicedDefaultContractIds = new Set<string>();
  if (assignmentsById.size > 0 && existingTables.has('invoice_charges')) {
    const invoiceRows = await trx('invoice_charges')
      .where({ tenant })
      .whereIn('client_contract_id', [...assignmentsById.keys()])
      .distinct('client_contract_id') as Array<{ client_contract_id: string }>;
    for (const row of invoiceRows) {
      const contractId = assignmentsById.get(row.client_contract_id);
      if (contractId) {
        invoicedDefaultContractIds.add(contractId);
      }
    }
  }

  await trx('client_contracts')
    .where({ tenant, client_id: clientId })
    .delete();

  for (const contract of defaultContracts) {
    const countRow = await trx('client_contracts')
      .where({ tenant, contract_id: contract.contract_id })
      .count<{ count?: string }>('client_contract_id as count')
      .first();
    const assignmentCount = Number(countRow?.count ?? 0);
    if (assignmentCount > 0) {
      continue;
    }

    if (invoicedDefaultContractIds.has(contract.contract_id)) {
      await trx('contracts')
        .where({ tenant, contract_id: contract.contract_id })
        .update({
          status: 'archived',
          is_active: false,
          updated_at: trx.fn.now(),
        });
    } else {
      await trx('contracts')
        .where({ tenant, contract_id: contract.contract_id })
        .delete();
    }
  }
}

async function cleanupClientDeleteArtifacts(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string
): Promise<void> {
  await cleanupDefaultContractsForDeletedClient(trx, tenant, clientId);
  await deleteFromTableIfExists(trx, 'client_billing_settings', { tenant, client_id: clientId });
  await deleteFromTableIfExists(trx, 'client_billing_cycles', { tenant, client_id: clientId });
  await deleteFromTableIfExists(trx, 'client_tax_settings', { tenant, client_id: clientId });
  await deleteFromTableIfExists(trx, 'client_tax_rates', { tenant, client_id: clientId });
  await deleteFromTableIfExists(trx, 'client_locations', { tenant, client_id: clientId });
  await deleteFromTableIfExists(trx, 'client_payment_customers', { tenant, client_id: clientId });
  await deleteFromTableIfExists(trx, 'tag_mappings', {
    tenant,
    tagged_type: 'client',
    tagged_id: clientId,
  });
}

async function cleanupClientNotesDocument(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string
): Promise<void> {
  const clientRecord = await trx('clients')
    .where({ client_id: clientId, tenant })
    .select('notes_document_id')
    .first();

  if (!clientRecord?.notes_document_id) {
    return;
  }

  await deleteFromTableIfExists(trx, 'document_block_content', {
    tenant,
    document_id: clientRecord.notes_document_id,
  });
  await deleteFromTableIfExists(trx, 'document_associations', {
    tenant,
    document_id: clientRecord.notes_document_id,
  });
  await deleteFromTableIfExists(trx, 'documents', {
    tenant,
    document_id: clientRecord.notes_document_id,
  });
}

async function cleanupEntraReferencesBeforeClientDelete(
  trx: Knex.Transaction,
  tenantId: string,
  clientId: string
): Promise<void> {
  if (!isEnterprise) {
    return;
  }

  const tableNames = [
    'entra_sync_run_tenants',
    'entra_contact_links',
    'entra_contact_reconciliation_queue',
    'entra_client_tenant_mappings',
  ];
  const existingTables = await getExistingPublicTables(trx, tableNames);
  if (existingTables.size === 0) {
    return;
  }

  const now = trx.fn.now();

  if (existingTables.has('entra_sync_run_tenants')) {
    await trx('entra_sync_run_tenants')
      .where({ tenant: tenantId, client_id: clientId })
      .update({ client_id: null, updated_at: now });
  }

  if (existingTables.has('entra_contact_links')) {
    await trx('entra_contact_links')
      .where({ tenant: tenantId, client_id: clientId })
      .update({ client_id: null, updated_at: now });
  }

  if (existingTables.has('entra_contact_reconciliation_queue')) {
    await trx('entra_contact_reconciliation_queue')
      .where({ tenant: tenantId, client_id: clientId })
      .update({ client_id: null, updated_at: now });
  }

  if (existingTables.has('entra_client_tenant_mappings')) {
    const activeMappings = await trx('entra_client_tenant_mappings')
      .where({
        tenant: tenantId,
        client_id: clientId,
        is_active: true,
      })
      .select('managed_tenant_id') as Array<{ managed_tenant_id: string }>;

    if (activeMappings.length > 0) {
      await trx('entra_client_tenant_mappings')
        .where({
          tenant: tenantId,
          client_id: clientId,
          is_active: true,
        })
        .update({
          is_active: false,
          updated_at: now,
        });

      const unmappedRows = activeMappings.map((mapping) => ({
        tenant: tenantId,
        managed_tenant_id: mapping.managed_tenant_id,
        client_id: null,
        mapping_state: 'unmapped',
        confidence_score: null,
        is_active: true,
        decided_by: null,
        decided_at: now,
        created_at: now,
        updated_at: now,
      }));

      await trx('entra_client_tenant_mappings').insert(unmappedRows);
    }

    await trx('entra_client_tenant_mappings')
      .where({ tenant: tenantId, client_id: clientId })
      .update({ client_id: null, updated_at: now });
  }
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

async function appendClientNoteBlock(
  tx: TenantTxContext,
  client: Record<string, any>,
  body: string
): Promise<{ document_id: string; created_document: boolean; updated_at: string }> {
  const nowIso = new Date().toISOString();
  const contentBlock = {
    type: 'paragraph',
    content: [{ type: 'text', text: body }],
  };

  if (client.notes_document_id) {
    const existing = await tx.trx('document_block_content')
      .where({ tenant: tx.tenantId, document_id: client.notes_document_id })
      .first();

    const existingBlocks = Array.isArray(existing?.block_data)
      ? existing.block_data
      : typeof existing?.block_data === 'string'
        ? (() => {
            try {
              return JSON.parse(existing.block_data);
            } catch {
              return [];
            }
          })()
        : [];

    const nextBlocks = [...(Array.isArray(existingBlocks) ? existingBlocks : []), contentBlock];

    if (existing) {
      await tx.trx('document_block_content')
        .where({ tenant: tx.tenantId, document_id: client.notes_document_id })
        .update({ block_data: JSON.stringify(nextBlocks), updated_at: nowIso });
    } else {
      await tx.trx('document_block_content').insert({
        content_id: uuidv4(),
        tenant: tx.tenantId,
        document_id: client.notes_document_id,
        block_data: JSON.stringify(nextBlocks),
        created_at: nowIso,
        updated_at: nowIso,
      });
    }

    await tx.trx('documents')
      .where({ tenant: tx.tenantId, document_id: client.notes_document_id })
      .update({ updated_at: nowIso, edited_by: tx.actorUserId });

    return {
      document_id: client.notes_document_id,
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
    document_name: `${client.client_name ?? 'Client'} Notes`,
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
      entity_id: client.client_id,
      entity_type: 'client',
      created_at: nowIso,
    })
    .onConflict(['tenant', 'document_id', 'entity_id', 'entity_type'])
    .ignore();

  await tx.trx('clients')
    .where({ tenant: tx.tenantId, client_id: client.client_id })
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

export function registerClientActions(): void {
  const registry = getActionRegistryV2();

  // ---------------------------------------------------------------------------
  // A09 — clients.find
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'clients.find',
    version: 1,
    inputSchema: z
      .object({
        client_id: withWorkflowPicker(uuidSchema.optional(), 'Client id', 'client'),
        name: z.string().optional().describe('Exact client name (case-insensitive)'),
        external_ref: z.string().optional().describe('External reference (stored in clients.properties.external_ref)'),
        include_primary_contact: z.boolean().default(false),
        on_not_found: z.enum(['return_null', 'error']).default('return_null'),
      })
      .refine((val) => Boolean(val.client_id || val.name || val.external_ref), { message: 'client_id, name, or external_ref required' })
      .refine((val) => !val.external_ref || /^[A-Za-z0-9._:-]+$/.test(String(val.external_ref)), { message: 'external_ref has invalid format' }),
    outputSchema: z.object({
      client: clientSummarySchema.nullable(),
      primary_contact: contactSummarySchema.nullable(),
    }),
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Find Client', category: 'Business Operations', description: 'Find a client by id, name, or external ref' },
    handler: async (input, ctx) =>
      withTenantTransaction(ctx, async (tx) => {
        await requirePermission(ctx, tx, { resource: 'client', action: 'read' });

        const startedAt = Date.now();
        let client: any = null;
        let matchedBy: 'client_id' | 'name' | 'external_ref' | null = null;
        if (input.client_id) {
          client = await ClientModel.getClientById(input.client_id, tx.tenantId, tx.trx);
          matchedBy = 'client_id';
        } else if (input.name) {
          const name = String(input.name).trim();
          client = await tx.trx('clients')
            .where({ tenant: tx.tenantId })
            .andWhereRaw('lower(client_name) = ?', [name.toLowerCase()])
            .first();
          matchedBy = 'name';
        } else if (input.external_ref) {
          client = await tx.trx('clients')
            .where({ tenant: tx.tenantId })
            .andWhereRaw(`(properties->>'external_ref') = ?`, [input.external_ref])
            .first();
          matchedBy = 'external_ref';
        }

        if (!client) {
          if (input.on_not_found === 'error') {
            throwActionError(ctx, {
              category: 'ActionError',
              code: 'NOT_FOUND',
              message: 'Client not found',
              details: { matched_by: matchedBy },
            });
          }
          return { client: null, primary_contact: null };
        }

        const parsedClient = clientToSummary(client);

        let primaryContact: any = null;
        if (input.include_primary_contact) {
          primaryContact = await tx.trx('contacts')
            .where({ tenant: tx.tenantId, client_id: client.client_id })
            .orderBy('is_inactive', 'asc')
            .orderBy('created_at', 'asc')
            .first();
        }

        const parsedPrimaryContact = primaryContact
          ? contactSummarySchema.parse({
              contact_name_id: primaryContact.contact_name_id,
              full_name: primaryContact.full_name ?? null,
              email: primaryContact.email ?? null,
              phone: primaryContact.phone ?? null,
              client_id: primaryContact.client_id ?? null,
            })
          : null;

        ctx.logger?.info('workflow_action:clients.find', {
          duration_ms: Date.now() - startedAt,
          matched_by: matchedBy,
          include_primary_contact: input.include_primary_contact,
        });

        return { client: parsedClient, primary_contact: parsedPrimaryContact };
      }),
  });

  // ---------------------------------------------------------------------------
  // A10 — clients.search
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'clients.search',
    version: 1,
    inputSchema: z.object({
      query: z.string().min(1).describe('Search query'),
      filters: z
        .object({
          include_inactive: z.boolean().optional(),
          tags: z.array(z.string()).optional(),
          sort_by: z.enum(['name', 'updated_at']).optional(),
          sort_order: z.enum(['asc', 'desc']).optional(),
        })
        .optional(),
      page: z.number().int().positive().default(1),
      page_size: z.number().int().positive().max(100).default(25),
    }),
    outputSchema: z.object({
      clients: z.array(clientSummarySchema),
      first_client: clientSummarySchema.nullable(),
      page: z.number().int(),
      page_size: z.number().int(),
      total: z.number().int(),
    }),
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Search Clients', category: 'Business Operations', description: 'Search clients by name' },
    handler: async (input, ctx) =>
      withTenantTransaction(ctx, async (tx) => {
        await requirePermission(ctx, tx, { resource: 'client', action: 'read' });

        const startedAt = Date.now();
        const minQueryLen = Number(process.env.WORKFLOW_CLIENT_SEARCH_MIN_QUERY_LEN ?? 2);
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

        let base = tx.trx('clients').where({ tenant: tx.tenantId });
        if (!filters.include_inactive) {
          base = base.where(function onlyActive() {
            this.where('is_inactive', false).orWhereNull('is_inactive');
          });
        }

        base = base.andWhereRaw(`client_name ILIKE ? ESCAPE '\\\\'`, [pattern]);

        if (filters.tags?.length) {
          base = base
            .join('tag_mappings as tm', function joinTagMappings() {
              this.on('tm.tenant', 'clients.tenant').andOn('tm.tagged_id', 'clients.client_id');
            })
            .join('tag_definitions as td', function joinTagDefs() {
              this.on('td.tenant', 'tm.tenant').andOn('td.tag_id', 'tm.tag_id');
            })
            .where('tm.tagged_type', 'client')
            .whereIn('td.tag_text', filters.tags);
        }

        const countRow = await base.clone().clearSelect().clearOrder().countDistinct({ count: 'clients.client_id' }).first();
        const total = parseInt(String((countRow as any)?.count ?? 0), 10);
        const sortBy = filters.sort_by ?? 'name';
        const sortOrder = filters.sort_order ?? 'asc';
        const clients = await base
          .clone()
          .clearSelect()
          .select('clients.*')
          .orderBy(sortBy === 'updated_at' ? 'clients.updated_at' : 'clients.client_name', sortOrder)
          .orderBy('clients.client_id', 'asc')
          .limit(pageSize)
          .offset(offset);

        const parsedClients = clients.map((row: any) => clientToSummary(row));

        ctx.logger?.info('workflow_action:clients.search', {
          duration_ms: Date.now() - startedAt,
          query_len: rawQuery.length,
          filters: {
            include_inactive: Boolean(filters.include_inactive),
            tags_count: Array.isArray(filters.tags) ? filters.tags.length : 0,
            sort_by: sortBy,
            sort_order: sortOrder,
          },
          result_count: parsedClients.length,
          page,
          page_size: pageSize,
          total,
        });

        return { clients: parsedClients, first_client: parsedClients[0] ?? null, page, page_size: pageSize, total };
      }),
  });

  // ---------------------------------------------------------------------------
  // A11 — clients.create
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'clients.create',
    version: 1,
    inputSchema: clientCreateInputSchema,
    outputSchema: z.object({
      client: clientSummarySchema,
      tags: z.array(tagResultSchema),
    }),
    sideEffectful: true,
    idempotency: { mode: 'actionProvided', key: actionProvidedKey },
    ui: {
      label: 'Create Client',
      category: 'Business Operations',
      description: 'Create a client and optionally attach initial tags',
    },
    handler: async (input, ctx) =>
      withTenantTransaction(ctx, async (tx) => {
        await requirePermission(ctx, tx, { resource: 'client', action: 'create' });

        if (input.parent_client_id) {
          await ensureClientExists(ctx, tx, input.parent_client_id);
        }

        const clientColumns = await getTableColumns(tx, 'clients');
        const createdId = uuidv4();
        const nowIso = new Date().toISOString();
        const createRow = pickExistingFields(
          {
            tenant: tx.tenantId,
            client_id: createdId,
            client_name: input.client_name,
            client_type: input.client_type ?? 'company',
            url: input.url ?? null,
            billing_email: input.email ?? null,
            notes: input.notes ?? null,
            properties: input.properties ? JSON.stringify(input.properties) : null,
            default_currency_code: input.default_currency_code ?? 'USD',
            parent_client_id: input.parent_client_id ?? null,
            contract_line_id: input.contract_line_id ?? null,
            is_default: input.is_default ?? false,
            is_inactive: false,
            created_at: nowIso,
            updated_at: nowIso,
          },
          clientColumns,
          new Set([...CLIENT_TABLE_ALLOWED_FIELDS, 'tenant', 'client_id', 'created_at', 'updated_at'])
        );
        try {
          await tx.trx('clients').insert(createRow);
        } catch (error) {
          rethrowAsStandardError(ctx, error);
        }

        try {
          await ensureDefaultContractForClientIfBillingConfigured(tx.trx, {
            tenant: tx.tenantId,
            clientId: createdId,
          });
        } catch {
          // Best-effort parity with product behavior.
        }

        const directPatch = pickExistingFields(
          {
            default_currency_code: input.default_currency_code,
            parent_client_id: input.parent_client_id,
            contract_line_id: input.contract_line_id,
            is_default: input.is_default,
            updated_at: new Date().toISOString(),
          },
          clientColumns,
          new Set([...CLIENT_TABLE_ALLOWED_FIELDS, 'updated_at'])
        );

        if (Object.keys(directPatch).length > 0) {
          await tx.trx('clients')
            .where({ tenant: tx.tenantId, client_id: createdId })
            .update(directPatch);
        }

        await upsertDefaultClientLocation(
          tx,
          createdId,
          {
            address: input.address,
            address_2: input.address_2,
            city: input.city,
            state: input.state,
            zip: input.zip,
            country: input.country,
            email: input.email,
            phone_no: input.phone_no,
          },
          { createIfMissing: true }
        );

        const tagResult = await ensureClientTagMappings(tx, createdId, input.tags ?? []);

        const after = await ensureClientExists(ctx, tx, createdId);

        await writeRunAudit(ctx, tx, {
          operation: 'workflow_action:clients.create',
          changedData: { client_id: createdId, client_name: after.client_name },
          details: { action_id: 'clients.create', action_version: 1, client_id: createdId },
        });

        await publishWorkflowDomainEvent({
          eventType: 'CLIENT_CREATED',
          payload: buildClientCreatedPayload({
            clientId: after.client_id,
            clientName: after.client_name,
            createdByUserId: tx.actorUserId,
            createdAt: (after.created_at as string | undefined) ?? new Date().toISOString(),
            status: Boolean(after.is_inactive) ? 'inactive' : 'active',
          }),
          tenantId: tx.tenantId,
          occurredAt: (after.created_at as string | undefined) ?? new Date().toISOString(),
          actorUserId: tx.actorUserId,
          idempotencyKey: `client_created:${after.client_id}`,
        });

        return {
          client: clientToSummary(after),
          tags: [...tagResult.added, ...tagResult.existing],
        };
      }),
  });

  // ---------------------------------------------------------------------------
  // A12 — clients.update
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'clients.update',
    version: 1,
    inputSchema: z.object({
      client_id: withWorkflowPicker(uuidSchema, 'Client id', 'client'),
      patch: clientUpdatePatchSchema,
    }),
    outputSchema: z.object({
      client_before: clientSummarySchema,
      client_after: clientSummarySchema,
      changed_fields: z.array(z.string()),
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Edit Client',
      category: 'Business Operations',
      description: 'Update editable fields on an existing client',
    },
    handler: async (input, ctx) =>
      withTenantTransaction(ctx, async (tx) => {
        await requirePermission(ctx, tx, { resource: 'client', action: 'update' });

        const before = await ensureClientExists(ctx, tx, input.client_id);

        const patch = input.patch;
        const changedFields: string[] = [];

        const hasPropertiesPatch = Object.prototype.hasOwnProperty.call(patch, 'properties');
        const clientPatchSource: Record<string, unknown> = {
          client_name: patch.client_name,
          client_type: patch.client_type,
          url: patch.url,
          billing_email: patch.email,
          notes: patch.notes,
          default_currency_code: patch.default_currency_code,
          parent_client_id: patch.parent_client_id,
          contract_line_id: patch.contract_line_id,
          is_default: patch.is_default,
          is_inactive: patch.is_inactive,
          updated_at: new Date().toISOString(),
        };

        if (hasPropertiesPatch) {
          const nextProperties = patch.properties === null
            ? null
            : { ...(parseClientProperties(before.properties) ?? {}), ...(patch.properties as Record<string, unknown>) };
          clientPatchSource.properties = nextProperties ? JSON.stringify(nextProperties) : null;
        }

        const clientColumns = await getTableColumns(tx, 'clients');
        const clientPatch = pickExistingFields(
          clientPatchSource,
          clientColumns,
          new Set([...CLIENT_TABLE_ALLOWED_FIELDS, 'updated_at'])
        );

        for (const key of Object.keys(clientPatch)) {
          if (key !== 'updated_at') changedFields.push(key);
        }

        if (Object.keys(clientPatch).length > 0) {
          try {
            await tx.trx('clients')
              .where({ tenant: tx.tenantId, client_id: input.client_id })
              .update(clientPatch);
          } catch (error) {
            rethrowAsStandardError(ctx, error);
          }
        }

        await upsertDefaultClientLocation(
          tx,
          input.client_id,
          {
            address: patch.address,
            address_2: patch.address_2,
            city: patch.city,
            state: patch.state,
            zip: patch.zip,
            country: patch.country,
            email: patch.email,
            phone_no: patch.phone_no,
          },
          { createIfMissing: false }
        );

        if (patch.is_inactive === true) {
          await deactivateClientUsersForClient(tx, input.client_id);
          if (!changedFields.includes('is_inactive')) {
            changedFields.push('is_inactive');
          }
        }

        const after = await ensureClientExists(ctx, tx, input.client_id);

        await writeRunAudit(ctx, tx, {
          operation: 'workflow_action:clients.update',
          changedData: { client_id: input.client_id, changed_fields: changedFields },
          details: { action_id: 'clients.update', action_version: 1, client_id: input.client_id },
        });

        const updatedPayload = buildClientUpdatedPayload({
          clientId: input.client_id,
          before,
          after,
          updatedFieldKeys: changedFields,
          updatedAt: (after.updated_at as string | undefined) ?? new Date().toISOString(),
        });
        const updatedFields = (updatedPayload as { updatedFields?: string[] }).updatedFields ?? [];
        if (updatedFields.length > 0) {
          await publishWorkflowDomainEvent({
            eventType: 'CLIENT_UPDATED',
            payload: updatedPayload,
            tenantId: tx.tenantId,
            occurredAt: (after.updated_at as string | undefined) ?? new Date().toISOString(),
            actorUserId: tx.actorUserId,
            idempotencyKey: `client_updated:${input.client_id}:${(after.updated_at as string | undefined) ?? new Date().toISOString()}`,
          });
        }

        return {
          client_before: clientToSummary(before),
          client_after: clientToSummary(after),
          changed_fields: changedFields,
        };
      }),
  });

  // ---------------------------------------------------------------------------
  // A13 — clients.archive
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'clients.archive',
    version: 1,
    inputSchema: z.object({
      client_id: withWorkflowPicker(uuidSchema, 'Client id', 'client'),
    }),
    outputSchema: z.object({
      client_id: uuidSchema,
      archived: z.boolean(),
      previous_is_inactive: z.boolean(),
      current_is_inactive: z.boolean(),
      archived_at: isoDateTimeSchema.nullable(),
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Archive Client',
      category: 'Business Operations',
      description: 'Set a client inactive with idempotent semantics',
    },
    handler: async (input, ctx) =>
      withTenantTransaction(ctx, async (tx) => {
        await requirePermission(ctx, tx, { resource: 'client', action: 'update' });

        const before = await ensureClientExists(ctx, tx, input.client_id);
        const previousInactive = Boolean(before.is_inactive);

        let archivedAt: string | null = null;
        if (!previousInactive) {
          archivedAt = new Date().toISOString();
          await tx.trx('clients')
            .where({ tenant: tx.tenantId, client_id: input.client_id })
            .update({ is_inactive: true, updated_at: archivedAt });
          await deactivateClientUsersForClient(tx, input.client_id);
        }

        const after = await ensureClientExists(ctx, tx, input.client_id);

        await writeRunAudit(ctx, tx, {
          operation: 'workflow_action:clients.archive',
          changedData: {
            client_id: input.client_id,
            previous_is_inactive: previousInactive,
            current_is_inactive: Boolean(after.is_inactive),
          },
          details: { action_id: 'clients.archive', action_version: 1, client_id: input.client_id },
        });

        if (!previousInactive && archivedAt) {
          await publishWorkflowDomainEvent({
            eventType: 'CLIENT_ARCHIVED',
            payload: buildClientArchivedPayload({
              clientId: input.client_id,
              archivedByUserId: tx.actorUserId,
              archivedAt,
            }),
            tenantId: tx.tenantId,
            occurredAt: archivedAt,
            actorUserId: tx.actorUserId,
            idempotencyKey: `client_archived:${input.client_id}:${archivedAt}`,
          });
        }

        return {
          client_id: input.client_id,
          archived: !previousInactive,
          previous_is_inactive: previousInactive,
          current_is_inactive: Boolean(after.is_inactive),
          archived_at: archivedAt,
        };
      }),
  });

  // ---------------------------------------------------------------------------
  // A14 — clients.delete
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'clients.delete',
    version: 1,
    inputSchema: z.object({
      client_id: withWorkflowPicker(uuidSchema, 'Client id', 'client'),
      confirm: z.boolean().refine((value) => value === true, { message: 'confirm must be true to delete a client' }),
      on_not_found: z.enum(['error', 'return_false']).default('error'),
    }),
    outputSchema: z.object({
      deleted: z.boolean(),
      client_id: uuidSchema,
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Delete Client',
      category: 'Business Operations',
      description: 'Hard-delete a client with dependency validation guardrails',
    },
    handler: async (input, ctx) =>
      withTenantTransaction(ctx, async (tx) => {
        await requirePermission(ctx, tx, { resource: 'client', action: 'delete' });

        const client = await tx.trx('clients')
          .where({ tenant: tx.tenantId, client_id: input.client_id })
          .select('client_id')
          .first();

        if (!client) {
          if (input.on_not_found === 'return_false') {
            return { deleted: false, client_id: input.client_id };
          }
          throwActionError(ctx, {
            category: 'ActionError',
            code: 'NOT_FOUND',
            message: 'Client not found',
            details: { client_id: input.client_id },
          });
        }

        const defaultClient = await tx.trx('tenant_companies')
          .where({ tenant: tx.tenantId, client_id: input.client_id, is_default: true })
          .first();

        if (defaultClient) {
          throwActionError(ctx, {
            category: 'ValidationError',
            code: 'VALIDATION_ERROR',
            message:
              'Cannot delete the default client. Please set another client as default in General Settings first.',
          });
        }

        const result = await deleteEntityWithValidation(
          'client',
          input.client_id,
          tx.trx,
          tx.tenantId,
          async (trx: Knex.Transaction, tenantId: string) => {
            await cleanupClientDeleteArtifacts(trx, tenantId, input.client_id);
            await cleanupClientNotesDocument(trx, tenantId, input.client_id);
            await cleanupEntraReferencesBeforeClientDelete(trx, tenantId, input.client_id);

            await trx('clients').where({ tenant: tenantId, client_id: input.client_id }).delete();
          }
        );

        if (!result?.deleted) {
          throwActionError(ctx, {
            category: 'ActionError',
            code: 'CONFLICT',
            message: result?.message ?? 'Unable to delete client due to dependencies',
            details: {
              dependencies: result?.dependencies ?? [],
              alternatives: result?.alternatives ?? [],
            },
          });
        }

        await writeRunAudit(ctx, tx, {
          operation: 'workflow_action:clients.delete',
          changedData: { client_id: input.client_id, deleted: true },
          details: { action_id: 'clients.delete', action_version: 1, client_id: input.client_id },
        });

        return { deleted: true, client_id: input.client_id };
      }),
  });

  // ---------------------------------------------------------------------------
  // A15 — clients.duplicate
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'clients.duplicate',
    version: 1,
    inputSchema: z.object({
      source_client_id: withWorkflowPicker(uuidSchema, 'Source client id', 'client'),
      client_name: z.string().min(1).describe('Name for the duplicated client'),
      copy_tags: z.boolean().default(true),
      copy_locations: z.boolean().default(false),
      idempotency_key: z.string().optional().describe('Optional external idempotency key'),
    }),
    outputSchema: z.object({
      source_client: clientSummarySchema,
      duplicate_client: clientSummarySchema,
      copied_tags: z.number().int(),
      copied_locations: z.number().int(),
    }),
    sideEffectful: true,
    idempotency: { mode: 'actionProvided', key: actionProvidedKey },
    ui: {
      label: 'Duplicate Client',
      category: 'Business Operations',
      description: 'Create a new client from a source profile with safe copy options',
    },
    handler: async (input, ctx) =>
      withTenantTransaction(ctx, async (tx) => {
        await requirePermission(ctx, tx, { resource: 'client', action: 'read' });
        await requirePermission(ctx, tx, { resource: 'client', action: 'create' });

        const source = await ensureClientExists(ctx, tx, input.source_client_id);

        const nowIso = new Date().toISOString();
        const duplicateId = uuidv4();
        const clientColumns = await getTableColumns(tx, 'clients');

        const duplicateRow = pickExistingFields(
          {
            client_id: duplicateId,
            tenant: tx.tenantId,
            client_name: input.client_name,
            client_type: source.client_type ?? null,
            url: source.url ?? null,
            billing_email: source.billing_email ?? null,
            notes: source.notes ?? null,
            properties: source.properties ?? null,
            default_currency_code: source.default_currency_code ?? null,
            parent_client_id: source.parent_client_id ?? null,
            is_default: false,
            is_inactive: false,
            region_code: source.region_code ?? null,
            tax_id_number: source.tax_id_number ?? null,
            is_tax_exempt: source.is_tax_exempt ?? false,
            tax_exemption_certificate: source.tax_exemption_certificate ?? null,
            payment_terms: source.payment_terms ?? null,
            preferred_payment_method: source.preferred_payment_method ?? null,
            auto_invoice: source.auto_invoice ?? false,
            invoice_delivery_method: source.invoice_delivery_method ?? null,
            billing_cycle: source.billing_cycle ?? null,
            timezone: source.timezone ?? null,
            account_manager_id: source.account_manager_id ?? null,
            created_at: nowIso,
            updated_at: nowIso,
            notes_document_id: null,
          },
          clientColumns,
          new Set([...CLIENT_TABLE_ALLOWED_FIELDS, 'client_id', 'tenant', 'created_at', 'updated_at', 'notes_document_id'])
        );

        try {
          await tx.trx('clients').insert(duplicateRow);
        } catch (error) {
          rethrowAsStandardError(ctx, error);
        }

        try {
          await ensureDefaultContractForClientIfBillingConfigured(tx.trx, {
            tenant: tx.tenantId,
            clientId: duplicateId,
          });
        } catch {
          // Non-fatal: duplicate creation remains valid.
        }

        let copiedTags = 0;
        if (input.copy_tags) {
          const sourceTags = await tx.trx('tag_mappings as tm')
            .join('tag_definitions as td', function joinTagDefs() {
              this.on('tm.tenant', 'td.tenant').andOn('tm.tag_id', 'td.tag_id');
            })
            .where({
              'tm.tenant': tx.tenantId,
              'tm.tagged_type': 'client',
              'tm.tagged_id': input.source_client_id,
              'td.tagged_type': 'client',
            })
            .select('td.tag_text');

          const tagResult = await ensureClientTagMappings(
            tx,
            duplicateId,
            sourceTags.map((row: { tag_text: string }) => row.tag_text)
          );
          copiedTags = tagResult.added.length + tagResult.existing.length;
        }

        let copiedLocations = 0;
        if (input.copy_locations) {
          const locationRows = await tx.trx('client_locations')
            .where({ tenant: tx.tenantId, client_id: input.source_client_id })
            .select('*');

          if (locationRows.length > 0) {
            const locationColumns = await getTableColumns(tx, 'client_locations');
            const inserts = locationRows.map((row: Record<string, unknown>) =>
              pickExistingFields(
                {
                  ...row,
                  location_id: uuidv4(),
                  client_id: duplicateId,
                  tenant: tx.tenantId,
                  created_at: nowIso,
                  updated_at: nowIso,
                },
                locationColumns,
                new Set([...LOCATION_TABLE_ALLOWED_FIELDS, 'location_id', 'tenant', 'client_id', 'created_at', 'updated_at'])
              )
            );

            await tx.trx('client_locations').insert(inserts);
            copiedLocations = inserts.length;
          }
        }

        const duplicateClient = await ensureClientExists(ctx, tx, duplicateId);

        await writeRunAudit(ctx, tx, {
          operation: 'workflow_action:clients.duplicate',
          changedData: {
            source_client_id: input.source_client_id,
            duplicate_client_id: duplicateId,
            copied_tags: copiedTags,
            copied_locations: copiedLocations,
          },
          details: { action_id: 'clients.duplicate', action_version: 1, client_id: duplicateId },
        });

        return {
          source_client: clientToSummary(source),
          duplicate_client: clientToSummary(duplicateClient),
          copied_tags: copiedTags,
          copied_locations: copiedLocations,
        };
      }),
  });

  // ---------------------------------------------------------------------------
  // A16 — clients.add_tag
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'clients.add_tag',
    version: 1,
    inputSchema: z.object({
      client_id: withWorkflowPicker(uuidSchema, 'Client id', 'client'),
      tags: z.array(z.string().min(1)).min(1).describe('One or more tags to attach to the client'),
      idempotency_key: z.string().optional().describe('Optional external idempotency key'),
    }),
    outputSchema: z.object({
      client_id: uuidSchema,
      added: z.array(tagResultSchema),
      existing: z.array(tagResultSchema),
      added_count: z.number().int(),
      existing_count: z.number().int(),
    }),
    sideEffectful: true,
    idempotency: { mode: 'actionProvided', key: actionProvidedKey },
    ui: {
      label: 'Add Tag to Client',
      category: 'Business Operations',
      description: 'Attach one or more tags to a client with idempotent mapping behavior',
    },
    handler: async (input, ctx) =>
      withTenantTransaction(ctx, async (tx) => {
        await requirePermission(ctx, tx, { resource: 'client', action: 'update' });

        await ensureClientExists(ctx, tx, input.client_id);
        const tagResult = await ensureClientTagMappings(tx, input.client_id, input.tags);

        await writeRunAudit(ctx, tx, {
          operation: 'workflow_action:clients.add_tag',
          changedData: {
            client_id: input.client_id,
            added_count: tagResult.added.length,
            existing_count: tagResult.existing.length,
          },
          details: { action_id: 'clients.add_tag', action_version: 1, client_id: input.client_id },
        });

        return {
          client_id: input.client_id,
          added: tagResult.added,
          existing: tagResult.existing,
          added_count: tagResult.added.length,
          existing_count: tagResult.existing.length,
        };
      }),
  });

  // ---------------------------------------------------------------------------
  // A17 — clients.assign_to_ticket
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'clients.assign_to_ticket',
    version: 1,
    inputSchema: z.object({
      client_id: withWorkflowPicker(uuidSchema, 'Client id', 'client'),
      ticket_id: withWorkflowPicker(uuidSchema, 'Ticket id', 'ticket'),
      contact_id: withWorkflowPicker(nullableUuidSchema.optional(), 'Optional contact id (null clears)', 'contact', ['client_id']),
      location_id: withWorkflowPicker(
        nullableUuidSchema.optional(),
        'Optional location id (null clears)',
        'client-location',
        ['client_id']
      ),
      reason: z.string().optional().describe('Optional reason/audit detail for the reassignment'),
      comment: z.string().optional().describe('Optional internal comment/audit detail for the reassignment'),
    }),
    outputSchema: z.object({
      ticket_id: uuidSchema,
      previous_client_id: nullableUuidSchema,
      current_client_id: nullableUuidSchema,
      previous_contact_id: nullableUuidSchema,
      current_contact_id: nullableUuidSchema,
      previous_location_id: nullableUuidSchema,
      current_location_id: nullableUuidSchema,
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Assign Client to Ticket',
      category: 'Business Operations',
      description: 'Move a ticket to a client and optionally set/clear contact and location',
    },
    handler: async (input, ctx) =>
      withTenantTransaction(ctx, async (tx) => {
        await requirePermission(ctx, tx, { resource: 'client', action: 'read' });
        await requirePermission(ctx, tx, { resource: 'ticket', action: 'update' });

        await ensureClientExists(ctx, tx, input.client_id);
        const ticket = await ensureTicketExists(ctx, tx, input.ticket_id);

        if (Object.prototype.hasOwnProperty.call(input, 'contact_id') && input.contact_id !== null && input.contact_id !== undefined) {
          const contact = await tx.trx('contacts')
            .where({ tenant: tx.tenantId, contact_name_id: input.contact_id })
            .first();
          if (!contact) {
            throwActionError(ctx, {
              category: 'ActionError',
              code: 'NOT_FOUND',
              message: 'Contact not found',
              details: { contact_id: input.contact_id },
            });
          }
          if (contact.client_id !== input.client_id) {
            throwActionError(ctx, {
              category: 'ValidationError',
              code: 'VALIDATION_ERROR',
              message: 'contact_id must belong to the selected client',
              details: { contact_id: input.contact_id, client_id: input.client_id },
            });
          }
        }

        if (Object.prototype.hasOwnProperty.call(input, 'location_id') && input.location_id !== null && input.location_id !== undefined) {
          const location = await tx.trx('client_locations')
            .where({ tenant: tx.tenantId, location_id: input.location_id })
            .first();
          if (!location) {
            throwActionError(ctx, {
              category: 'ActionError',
              code: 'NOT_FOUND',
              message: 'Location not found',
              details: { location_id: input.location_id },
            });
          }
          if (location.client_id !== input.client_id) {
            throwActionError(ctx, {
              category: 'ValidationError',
              code: 'VALIDATION_ERROR',
              message: 'location_id must belong to the selected client',
              details: { location_id: input.location_id, client_id: input.client_id },
            });
          }
        }

        const patch: Record<string, unknown> = {
          client_id: input.client_id,
          updated_at: new Date().toISOString(),
        };

        if (Object.prototype.hasOwnProperty.call(input, 'contact_id')) {
          patch.contact_name_id = input.contact_id ?? null;
        }

        if (Object.prototype.hasOwnProperty.call(input, 'location_id')) {
          patch.location_id = input.location_id ?? null;
        }

        await tx.trx('tickets').where({ tenant: tx.tenantId, ticket_id: input.ticket_id }).update(patch);

        const after = await ensureTicketExists(ctx, tx, input.ticket_id);

        await writeRunAudit(ctx, tx, {
          operation: 'workflow_action:clients.assign_to_ticket',
          changedData: {
            ticket_id: input.ticket_id,
            previous_client_id: ticket.client_id ?? null,
            current_client_id: after.client_id ?? null,
            previous_contact_id: ticket.contact_name_id ?? null,
            current_contact_id: after.contact_name_id ?? null,
            previous_location_id: ticket.location_id ?? null,
            current_location_id: after.location_id ?? null,
          },
          details: {
            action_id: 'clients.assign_to_ticket',
            action_version: 1,
            client_id: input.client_id,
            reason: input.reason ?? null,
            comment: input.comment ?? null,
          },
        });

        return {
          ticket_id: input.ticket_id,
          previous_client_id: ticket.client_id ?? null,
          current_client_id: after.client_id ?? null,
          previous_contact_id: ticket.contact_name_id ?? null,
          current_contact_id: after.contact_name_id ?? null,
          previous_location_id: ticket.location_id ?? null,
          current_location_id: after.location_id ?? null,
        };
      }),
  });

  // ---------------------------------------------------------------------------
  // A18 — clients.add_note
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'clients.add_note',
    version: 1,
    inputSchema: z.object({
      client_id: withWorkflowPicker(uuidSchema, 'Client id', 'client'),
      body: z.string().min(1).describe('Note content to append to the client notes document'),
      idempotency_key: z.string().optional().describe('Optional external idempotency key'),
    }),
    outputSchema: z.object({
      client_id: uuidSchema,
      document_id: uuidSchema,
      created_document: z.boolean(),
      updated_at: isoDateTimeSchema,
    }),
    sideEffectful: true,
    idempotency: { mode: 'actionProvided', key: actionProvidedKey },
    ui: {
      label: 'Add Note to Client',
      category: 'Business Operations',
      description: 'Append a note block to the client notes document',
    },
    handler: async (input, ctx) =>
      withTenantTransaction(ctx, async (tx) => {
        await requirePermission(ctx, tx, { resource: 'client', action: 'update' });

        const client = await ensureClientExists(ctx, tx, input.client_id);
        const result = await appendClientNoteBlock(tx, client, input.body);

        await writeRunAudit(ctx, tx, {
          operation: 'workflow_action:clients.add_note',
          changedData: {
            client_id: input.client_id,
            document_id: result.document_id,
            created_document: result.created_document,
          },
          details: { action_id: 'clients.add_note', action_version: 1, client_id: input.client_id },
        });

        if (result.created_document) {
          await publishWorkflowDomainEvent({
            eventType: 'NOTE_CREATED',
            payload: buildNoteCreatedPayload({
              noteId: result.document_id,
              entityType: 'client',
              entityId: input.client_id,
              createdByUserId: tx.actorUserId,
              createdAt: result.updated_at,
              visibility: 'internal',
              bodyPreview: input.body,
            }),
            tenantId: tx.tenantId,
            occurredAt: result.updated_at,
            actorUserId: tx.actorUserId,
            idempotencyKey: `note_created:client:${input.client_id}:${result.document_id}`,
          });
        }

        return {
          client_id: input.client_id,
          document_id: result.document_id,
          created_document: result.created_document,
          updated_at: result.updated_at,
        };
      }),
  });

  // ---------------------------------------------------------------------------
  // A19 — clients.add_interaction
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'clients.add_interaction',
    version: 1,
    inputSchema: z.object({
      client_id: withWorkflowPicker(uuidSchema, 'Client id', 'client'),
      type_id: uuidSchema.describe('Interaction type id (system or tenant type)'),
      title: z.string().min(1),
      contact_id: withWorkflowPicker(uuidSchema.optional(), 'Optional contact id', 'contact', ['client_id']),
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
      client_id: uuidSchema,
      contact_id: nullableUuidSchema,
      ticket_id: nullableUuidSchema,
      type_id: uuidSchema,
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
      label: 'Add Interaction to Client',
      category: 'Business Operations',
      description: 'Log an interaction against a client using the workflow actor as owner',
    },
    handler: async (input, ctx) =>
      withTenantTransaction(ctx, async (tx) => {
        await requirePermission(ctx, tx, { resource: 'client', action: 'update' });

        await ensureClientExists(ctx, tx, input.client_id);

        if (input.contact_id) {
          const contact = await tx.trx('contacts')
            .where({ tenant: tx.tenantId, contact_name_id: input.contact_id })
            .first();
          if (!contact) {
            throwActionError(ctx, {
              category: 'ActionError',
              code: 'NOT_FOUND',
              message: 'Contact not found',
              details: { contact_id: input.contact_id },
            });
          }
          if (contact.client_id !== input.client_id) {
            throwActionError(ctx, {
              category: 'ValidationError',
              code: 'VALIDATION_ERROR',
              message: 'contact_id must belong to the selected client',
              details: { contact_id: input.contact_id, client_id: input.client_id },
            });
          }
        }

        if (input.ticket_id) {
          const ticket = await tx.trx('tickets')
            .where({ tenant: tx.tenantId, ticket_id: input.ticket_id })
            .first();
          if (!ticket) {
            throwActionError(ctx, {
              category: 'ActionError',
              code: 'NOT_FOUND',
              message: 'Ticket not found',
              details: { ticket_id: input.ticket_id },
            });
          }

          if (ticket.client_id && ticket.client_id !== input.client_id) {
            throwActionError(ctx, {
              category: 'ValidationError',
              code: 'VALIDATION_ERROR',
              message: 'ticket_id must belong to the selected client',
              details: { ticket_id: input.ticket_id, client_id: input.client_id },
            });
          }
        }

        const statusId = input.status_id ?? (await getDefaultInteractionStatusId(ctx, tx));
        const interactionDate = input.interaction_date ?? new Date().toISOString();

        const insertRow = {
          tenant: tx.tenantId,
          interaction_id: uuidv4(),
          type_id: input.type_id,
          contact_name_id: input.contact_id ?? null,
          client_id: input.client_id,
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
          operation: 'workflow_action:clients.add_interaction',
          changedData: {
            interaction_id: created.interaction_id,
            client_id: created.client_id,
            ticket_id: created.ticket_id ?? null,
            contact_id: created.contact_name_id ?? null,
            type_id: created.type_id,
          },
          details: {
            action_id: 'clients.add_interaction',
            action_version: 1,
            client_id: created.client_id,
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
          client_id: created.client_id,
          contact_id: created.contact_name_id ?? null,
          ticket_id: created.ticket_id ?? null,
          type_id: created.type_id,
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
          duration: typeof created.duration === 'number' ? created.duration : created.duration ? Number(created.duration) : null,
          user_id: created.user_id,
        };
      }),
  });
}
