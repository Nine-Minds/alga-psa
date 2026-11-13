import type { Knex } from 'knex';

export type TicketChargeSourceKind = 'ticket_material' | 'ticket_fixed_fee';

export interface TicketChargeSourceClaim {
  sourceId: string;
  sourceUpdatedAt: string;
  expected?: {
    clientId?: string;
    serviceId?: string;
    quantity?: number;
    rate?: number;
    currencyCode?: string;
  };
}

const sourceConfig: Record<TicketChargeSourceKind, { table: string; idColumn: string }> = {
  ticket_material: { table: 'ticket_materials', idColumn: 'ticket_material_id' },
  ticket_fixed_fee: { table: 'ticket_fixed_fee_services', idColumn: 'entry_id' },
};

export async function claimTicketChargeSources(
  trx: Knex.Transaction,
  tenant: string,
  sourceKind: TicketChargeSourceKind,
  claims: TicketChargeSourceClaim[],
  invoiceId: string,
  claimedAt: string,
): Promise<Set<string>> {
  if (claims.length === 0) return new Set();

  const { table, idColumn } = sourceConfig[sourceKind];
  const orderedClaims = [...claims].sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  if (orderedClaims.some(({ sourceUpdatedAt }) => !sourceUpdatedAt)) {
    throw new Error(`${sourceKind} source versions are required.`);
  }

  const values = orderedClaims.map(() => (
    '(?::uuid, ?::timestamptz, ?::uuid, ?::uuid, ?::integer, ?::bigint, ?::text)'
  )).join(', ');
  const bindings: Array<string | number | null> = [invoiceId, claimedAt, claimedAt];
  bindings.push(...orderedClaims.flatMap(({ sourceId, sourceUpdatedAt, expected }) => [
    sourceId,
    sourceUpdatedAt,
    expected?.clientId ?? null,
    expected?.serviceId ?? null,
    expected?.quantity ?? null,
    expected?.rate ?? null,
    expected?.currencyCode ?? null,
  ]));
  bindings.push(tenant);

  const result = await trx.raw(
    `UPDATE ${table} AS source
     SET is_billed = TRUE,
         billed_invoice_id = ?,
         billed_at = ?,
         updated_at = ?
     FROM (VALUES ${values}) AS requested(
       source_id, source_updated_at, client_id, service_id, quantity, rate, currency_code
     )
     WHERE source.tenant = ?
       AND source.${idColumn} = requested.source_id
       AND source.updated_at = requested.source_updated_at
       AND source.is_billed = FALSE
       AND (requested.client_id IS NULL OR source.client_id = requested.client_id)
       AND (requested.service_id IS NULL OR source.service_id = requested.service_id)
       AND (requested.quantity IS NULL OR source.quantity = requested.quantity)
       AND (requested.rate IS NULL OR source.rate = requested.rate)
       AND (requested.currency_code IS NULL OR source.currency_code = requested.currency_code)
     RETURNING source.${idColumn} AS source_id`,
    bindings,
  ) as { rows: Array<{ source_id: string }> };

  return new Set(result.rows.map(({ source_id }) => source_id));
}
