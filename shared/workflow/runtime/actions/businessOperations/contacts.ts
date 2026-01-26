import { z } from 'zod';
import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { ContactModel } from '../../../../models/contactModel';
import {
  uuidSchema,
  isoDateTimeSchema,
  withTenantTransaction,
  requirePermission,
  throwActionError
} from './shared';

export function registerContactActions(): void {
  const registry = getActionRegistryV2();

  const contactDetailsSchema = z.object({
    contact_name_id: uuidSchema,
    full_name: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    client_id: uuidSchema.nullable(),
    is_inactive: z.boolean()
  });

  // ---------------------------------------------------------------------------
  // A11 — contacts.find
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'contacts.find',
    version: 1,
    inputSchema: z.object({
      contact_id: uuidSchema.optional(),
      email: z.string().email().optional(),
      phone: z.string().optional().describe('Phone number (normalized digits match)'),
      client_id: uuidSchema.optional().describe('Optional client scope'),
      on_not_found: z.enum(['return_null', 'error']).default('return_null'),
      match_strategy: z.enum(['first_created', 'most_recent']).default('first_created').describe('Deterministic ordering when multiple matches exist')
    }).refine((val) => Boolean(val.contact_id || val.email || val.phone), { message: 'contact_id, email, or phone required' }),
    outputSchema: z.object({
      contact: contactDetailsSchema.nullable()
    }),
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Find Contact', category: 'Business Operations', description: 'Find a contact by id or email' },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
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
        contacts = await tx.trx('contacts')
          .where({ tenant: tx.tenantId })
          .andWhereRaw('lower(email) = ?', [email])
          .orderBy('is_inactive', 'asc')
          .orderBy(input.match_strategy === 'most_recent' ? 'created_at' : 'created_at', input.match_strategy === 'most_recent' ? 'desc' : 'asc')
          .limit(5);
      } else if (input.phone) {
        const digits = String(input.phone).replace(/\D/g, '');
        if (digits.length < 7) {
          throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: 'phone is invalid' });
        }
        matchedBy = 'phone';
        contacts = await tx.trx('contacts')
          .where({ tenant: tx.tenantId })
          .andWhereRaw(`regexp_replace(coalesce(phone,''), '\\\\D', '', 'g') = ?`, [digits])
          .orderBy('is_inactive', 'asc')
          .orderBy(input.match_strategy === 'most_recent' ? 'created_at' : 'created_at', input.match_strategy === 'most_recent' ? 'desc' : 'asc')
          .limit(5);
      }

      // Apply client scope filter and choose first match deterministically.
      if (input.client_id) {
        contacts = contacts.filter((c) => c?.client_id === input.client_id);
      }

      const contact = contacts[0] ?? null;
      if (!contact) {
        if (input.on_not_found === 'error') {
          throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Contact not found', details: { matched_by: matchedBy } });
        }
        return { contact: null };
      }

      const parsed = contactDetailsSchema.parse({
        contact_name_id: contact.contact_name_id,
        full_name: contact.full_name ?? null,
        email: contact.email ?? null,
        phone: contact.phone ?? null,
        client_id: contact.client_id ?? null,
        is_inactive: Boolean(contact.is_inactive)
      });

      ctx.logger?.info('workflow_action:contacts.find', {
        duration_ms: Date.now() - startedAt,
        matched_by: matchedBy,
        match_count: contacts.length
      });

      return { contact: parsed };
    })
  });

  // ---------------------------------------------------------------------------
  // A12 — contacts.search
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'contacts.search',
    version: 1,
    inputSchema: z.object({
      query: z.string().min(1).describe('Search query (name/email/phone)'),
      client_id: uuidSchema.optional().describe('Optional client scope'),
      filters: z.object({
        tags: z.array(z.string()).optional(),
        sort_by: z.enum(['name', 'updated_at']).optional(),
        sort_order: z.enum(['asc', 'desc']).optional()
      }).optional(),
      page: z.number().int().positive().default(1),
      page_size: z.number().int().positive().max(100).default(25)
    }),
    outputSchema: z.object({
      contacts: z.array(contactDetailsSchema),
      first_contact: contactDetailsSchema.nullable(),
      page: z.number().int(),
      page_size: z.number().int(),
      total: z.number().int()
    }),
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Search Contacts', category: 'Business Operations', description: 'Search contacts by name or email' },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, { resource: 'contact', action: 'read' });

      const startedAt = Date.now();
      const minQueryLen = Number(process.env.WORKFLOW_CONTACT_SEARCH_MIN_QUERY_LEN ?? 2);
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

      let base = tx.trx('contacts')
        .where({ tenant: tx.tenantId })
        .where(function q() {
          this.whereRaw(`full_name ILIKE ? ESCAPE '\\\\'`, [pattern])
            .orWhereRaw(`email ILIKE ? ESCAPE '\\\\'`, [pattern])
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

      const contacts = rows.map((row: any) => contactDetailsSchema.parse({
        contact_name_id: row.contact_name_id,
        full_name: row.full_name ?? null,
        email: row.email ?? null,
        phone: row.phone ?? null,
        client_id: row.client_id ?? null,
        is_inactive: Boolean(row.is_inactive)
      }));

      ctx.logger?.info('workflow_action:contacts.search', {
        duration_ms: Date.now() - startedAt,
        query_len: rawQuery.length,
        client_scope: input.client_id ?? null,
        filters: { tags_count: Array.isArray(filters.tags) ? filters.tags.length : 0, sort_by: sortBy, sort_order: sortOrder },
        result_count: contacts.length,
        page,
        page_size: pageSize,
        total
      });

      return { contacts, first_contact: contacts[0] ?? null, page, page_size: pageSize, total };
    })
  });
}

