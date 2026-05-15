import { z } from 'zod';
import { getActionRegistryV2 } from '../../registries/actionRegistry';
import {
  uuidSchema,
  isoDateTimeSchema,
  withTenantTransaction,
  requirePermission,
  throwActionError,
} from './shared';

export function registerAssetActions(): void {
  const registry = getActionRegistryV2();

  const associatedTicketSchema = z.object({
    ticket_id: uuidSchema,
    ticket_number: z.string(),
    title: z.string().nullable(),
    status_id: uuidSchema.nullable(),
    is_closed: z.boolean().nullable(),
    entered_at: isoDateTimeSchema.nullable(),
    updated_at: isoDateTimeSchema.nullable(),
    relationship_type: z.string(),
  });

  // ---------------------------------------------------------------------------
  // assets.find_associated_tickets
  // Look up tickets associated with an asset. Resolves the asset by either its
  // Alga UUID or an external_id mapped via tenant_external_entity_mappings, then
  // joins asset_associations → tickets and returns the matching tickets.
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'assets.find_associated_tickets',
    version: 1,
    inputSchema: z
      .object({
        asset_id: uuidSchema.optional().describe('Alga asset UUID'),
        asset_tag: z.string().optional().describe('Alga asset_tag value (typically matches RMM device tag/hostname)'),
        external_id: z.string().optional().describe('External asset identifier (resolves via tenant_external_entity_mappings)'),
        integration_type: z
          .string()
          .optional()
          .describe('Integration type to scope the external_id lookup (e.g. inbound webhook slug). Required when external_id is used unless tenant has a single mapping per external_id.'),
        external_realm_id: z
          .string()
          .nullable()
          .optional()
          .describe('Optional realm scope used when external systems namespace IDs by realm/org'),
        relationship_type: z
          .enum(['affected', 'related', 'any'])
          .default('affected')
          .describe('Filter associations by relationship_type'),
        status_filter: z
          .enum(['open', 'closed', 'all'])
          .default('open')
          .describe('Filter resulting tickets by closed flag'),
        limit: z.number().int().positive().max(50).default(10).describe('Maximum number of tickets to return'),
        on_not_found: z.enum(['return_empty', 'error']).default('return_empty'),
      })
      .refine((val) => Boolean(val.asset_id || val.asset_tag || val.external_id), {
        message: 'asset_id, asset_tag, or external_id is required',
      }),
    outputSchema: z.object({
      asset_id: uuidSchema.nullable(),
      tickets: z.array(associatedTicketSchema),
    }),
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Find Tickets for Asset',
      category: 'Business Operations',
      description: 'Return tickets associated with an asset, resolved by asset_id or external_id.',
    },
    examples: {
      minimal: {
        external_id: 'WL-WS-001',
        integration_type: 'workflow-webhook',
      },
    },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, { resource: 'asset', action: 'read' });
      await requirePermission(ctx, tx, { resource: 'ticket', action: 'read' });

      let resolvedAssetId: string | null = input.asset_id ?? null;

      if (!resolvedAssetId && input.asset_tag) {
        const asset = await tx.trx('assets')
          .where({ tenant: tx.tenantId, asset_tag: input.asset_tag })
          .first<{ asset_id: string }>('asset_id');
        resolvedAssetId = asset?.asset_id ?? null;
      }

      if (!resolvedAssetId && input.external_id) {
        const mappingQuery = tx.trx('tenant_external_entity_mappings')
          .where({
            tenant_id: tx.tenantId,
            alga_entity_type: 'asset',
            external_entity_id: input.external_id,
          });

        if (input.integration_type) {
          mappingQuery.andWhere('integration_type', input.integration_type);
        }

        if (input.external_realm_id !== undefined) {
          if (input.external_realm_id === null || input.external_realm_id === '') {
            mappingQuery.whereNull('external_realm_id');
          } else {
            mappingQuery.andWhere('external_realm_id', input.external_realm_id);
          }
        }

        const mapping = await mappingQuery
          .orderByRaw('external_realm_id IS NOT NULL ASC')
          .orderBy('updated_at', 'desc')
          .first<{ alga_entity_id: string }>('alga_entity_id');

        resolvedAssetId = mapping?.alga_entity_id ?? null;
      }

      if (!resolvedAssetId) {
        if (input.on_not_found === 'error') {
          throwActionError(ctx, {
            category: 'ActionError',
            code: 'NOT_FOUND',
            message: 'Asset could not be resolved from inputs',
          });
        }
        return { asset_id: null, tickets: [] };
      }

      // resolvedAssetId comes from tenant_external_entity_mappings.alga_entity_id which
      // is varchar(255); asset_associations.asset_id is uuid. Cast explicitly so the
      // join doesn't trip "operator does not exist: uuid = character varying".
      const associationsQuery = tx.trx('asset_associations as aa')
        .innerJoin('tickets as t', function joinTickets() {
          this.on('t.tenant', '=', 'aa.tenant').andOn('t.ticket_id', '=', 'aa.entity_id');
        })
        .where('aa.tenant', tx.tenantId)
        .andWhereRaw('aa.asset_id = ?::uuid', [resolvedAssetId])
        .andWhere('aa.entity_type', 'ticket');

      if (input.relationship_type !== 'any') {
        associationsQuery.andWhere('aa.relationship_type', input.relationship_type);
      }

      if (input.status_filter === 'open') {
        associationsQuery.andWhere(function openOnly() {
          this.whereNull('t.closed_at').orWhere('t.is_closed', false);
        });
      } else if (input.status_filter === 'closed') {
        associationsQuery.andWhere(function closedOnly() {
          this.whereNotNull('t.closed_at').orWhere('t.is_closed', true);
        });
      }

      const rows = await associationsQuery
        .select(
          't.ticket_id',
          't.ticket_number',
          't.title',
          't.status_id',
          't.is_closed',
          't.entered_at',
          't.updated_at',
          'aa.relationship_type as relationship_type',
        )
        .orderBy('t.updated_at', 'desc')
        .limit(input.limit ?? 10) as Array<{
          ticket_id: string;
          ticket_number: string;
          title: string | null;
          status_id: string | null;
          is_closed: boolean | null;
          entered_at: Date | string | null;
          updated_at: Date | string | null;
          relationship_type: string;
        }>;

      if (rows.length === 0 && input.on_not_found === 'error') {
        throwActionError(ctx, {
          category: 'ActionError',
          code: 'NOT_FOUND',
          message: 'No associated tickets found for asset',
        });
      }

      const tickets = rows.map((row) => associatedTicketSchema.parse({
        ticket_id: row.ticket_id,
        ticket_number: row.ticket_number,
        title: row.title ?? null,
        status_id: row.status_id ?? null,
        is_closed: row.is_closed ?? null,
        entered_at: row.entered_at ? new Date(row.entered_at).toISOString() : null,
        updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null,
        relationship_type: row.relationship_type,
      }));

      return { asset_id: resolvedAssetId, tickets };
    }),
  });
}
