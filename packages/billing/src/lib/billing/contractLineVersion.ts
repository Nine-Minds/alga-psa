import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

const iso = (value: unknown): string => (value == null ? '' : new Date(value as string | number | Date).toISOString());

/**
 * Optimistic-concurrency token for a live contract line, as the Contract Lines
 * editor loads it. It is a version, not a lock.
 *
 * `updated_at` alone is not enough: dated recurring-unit revisions are written
 * by other editors (the scheduling panel) without touching the line row, and the
 * save may replace them. So the token also fingerprints the line's revisions
 * (count, version sum, newest update). Returns null when the line does not exist.
 */
export async function computeContractLineVersion(
  trx: Knex | Knex.Transaction,
  tenant: string,
  contractLineId: string,
): Promise<string | null> {
  const db = tenantDb(trx as Knex, tenant);
  const line = await db.table('contract_lines')
    .where({ contract_line_id: contractLineId })
    .first<{ updated_at: Date | string | null }>('updated_at');
  if (!line) return null;
  const rev = await db.table('contract_line_unit_pricing_revisions')
    .where({ contract_line_id: contractLineId })
    .first<{ n: string; v: string | null; u: Date | string | null }>(
      trx.raw('count(*) as n'),
      trx.raw('coalesce(sum(version), 0) as v'),
      trx.raw('max(updated_at) as u'),
    );
  return `${iso(line.updated_at)}|${Number(rev?.n ?? 0)}|${Number(rev?.v ?? 0)}|${iso(rev?.u)}`;
}
