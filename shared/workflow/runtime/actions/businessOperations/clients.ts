import { z } from 'zod';
import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { ClientModel } from '../../../../models/clientModel';
import {
  uuidSchema,
  isoDateTimeSchema,
  withTenantTransaction,
  requirePermission,
  throwActionError,
  parseJsonMaybe
} from './shared';

export function registerClientActions(): void {
  const registry = getActionRegistryV2();

  const clientSummarySchema = z.object({
    client_id: uuidSchema,
    client_name: z.string(),
    url: z.string().nullable(),
    is_inactive: z.boolean(),
    properties: z.record(z.unknown()).nullable()
  });

  const contactSummarySchema = z.object({
    contact_name_id: uuidSchema,
    full_name: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    client_id: uuidSchema.nullable()
  });

  // ---------------------------------------------------------------------------
  // A09 — clients.find
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'clients.find',
    version: 1,
    inputSchema: z.object({
      client_id: uuidSchema.optional(),
      name: z.string().optional().describe('Exact client name (case-insensitive)'),
      external_ref: z.string().optional().describe('External reference (stored in clients.properties.external_ref)'),
      include_primary_contact: z.boolean().default(false),
      on_not_found: z.enum(['return_null', 'error']).default('return_null')
    }).refine((val) => Boolean(val.client_id || val.name || val.external_ref), { message: 'client_id, name, or external_ref required' })
      .refine((val) => !val.external_ref || /^[A-Za-z0-9._:-]+$/.test(String(val.external_ref)), { message: 'external_ref has invalid format' }),
    outputSchema: z.object({
      client: clientSummarySchema.nullable(),
      primary_contact: contactSummarySchema.nullable()
    }),
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Find Client', category: 'Business Operations', description: 'Find a client by id, name, or external ref' },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
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
          throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Client not found', details: { matched_by: matchedBy } });
        }
        return { client: null, primary_contact: null };
      }

      let properties: Record<string, unknown> | null = null;
      if (client && client.properties) {
        const parsed = parseJsonMaybe(client.properties);
        properties = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
      }

      const parsedClient = clientSummarySchema.parse({
        client_id: client.client_id,
        client_name: client.client_name,
        url: client.url ?? null,
        is_inactive: Boolean(client.is_inactive),
        properties
      });

      let primaryContact: any = null;
      if (input.include_primary_contact) {
        primaryContact = await tx.trx('contacts')
          .where({ tenant: tx.tenantId, client_id: client.client_id })
          .orderBy('is_inactive', 'asc')
          .orderBy('created_at', 'asc')
          .first();
      }

      const parsedPrimaryContact = primaryContact ? contactSummarySchema.parse({
        contact_name_id: primaryContact.contact_name_id,
        full_name: primaryContact.full_name ?? null,
        email: primaryContact.email ?? null,
        phone: primaryContact.phone ?? null,
        client_id: primaryContact.client_id ?? null
      }) : null;

      ctx.logger?.info('workflow_action:clients.find', {
        duration_ms: Date.now() - startedAt,
        matched_by: matchedBy,
        include_primary_contact: input.include_primary_contact
      });

      return { client: parsedClient, primary_contact: parsedPrimaryContact };
    })
  });

  // ---------------------------------------------------------------------------
  // A10 — clients.search
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'clients.search',
    version: 1,
    inputSchema: z.object({
      query: z.string().min(1).describe('Search query'),
      filters: z.object({
        include_inactive: z.boolean().optional(),
        tags: z.array(z.string()).optional(),
        sort_by: z.enum(['name', 'updated_at']).optional(),
        sort_order: z.enum(['asc', 'desc']).optional()
      }).optional(),
      page: z.number().int().positive().default(1),
      page_size: z.number().int().positive().max(100).default(25)
    }),
    outputSchema: z.object({
      clients: z.array(clientSummarySchema),
      first_client: clientSummarySchema.nullable(),
      page: z.number().int(),
      page_size: z.number().int(),
      total: z.number().int()
    }),
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Search Clients', category: 'Business Operations', description: 'Search clients by name' },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, { resource: 'client', action: 'read' });

      const startedAt = Date.now();
      const minQueryLen = Number(process.env.WORKFLOW_CLIENT_SEARCH_MIN_QUERY_LEN ?? 2);
      const rawQuery = String(input.query ?? '').trim();
      if (rawQuery.length < minQueryLen) {
        throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: `query must be at least ${minQueryLen} characters` });
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

      const parsedClients = clients.map((row: any) => {
        const props = row?.properties ? parseJsonMaybe(row.properties) : null;
        return clientSummarySchema.parse({
          client_id: row.client_id,
          client_name: row.client_name,
          url: row.url ?? null,
          is_inactive: Boolean(row.is_inactive),
          properties: (props && typeof props === 'object' && !Array.isArray(props)) ? props : null
        });
      });

      ctx.logger?.info('workflow_action:clients.search', {
        duration_ms: Date.now() - startedAt,
        query_len: rawQuery.length,
        filters: {
          include_inactive: Boolean(filters.include_inactive),
          tags_count: Array.isArray(filters.tags) ? filters.tags.length : 0,
          sort_by: sortBy,
          sort_order: sortOrder
        },
        result_count: parsedClients.length,
        page,
        page_size: pageSize,
        total
      });

      return { clients: parsedClients, first_client: parsedClients[0] ?? null, page, page_size: pageSize, total };
    })
  });
}

