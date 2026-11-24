import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/**
 * Recent tickets for a picker over simulated or explained access, newest first, optionally narrowed by ticket
 * number or title. A ticket is named by its number and title, never by its id.
 *
 * Shared by the authorization simulator's record list (which gates on the advanced-bundles tier) and by
 * seat-technician effective access (which does not); the gate belongs to the caller, not to this read.
 */
export interface SimulationTicketOption {
  id: string;
  label: string;
}

export async function listSimulationTicketOptions(
  knex: Knex | Knex.Transaction,
  tenant: string,
  search?: string
): Promise<SimulationTicketOption[]> {
  const query = tenantDb(knex, tenant).table('tickets').orderBy('updated_at', 'desc').limit(50);
  const term = (search ?? '').trim();
  if (term) {
    const like = `%${term.replace(/[\\%_]/g, '\\$&')}%`;
    query.where((builder) => builder.whereILike('title', like).orWhereILike('ticket_number', like));
  }
  const rows = await query.select<{ ticket_id: string; title: string | null; ticket_number: string | null }[]>(
    'ticket_id', 'title', 'ticket_number'
  );
  return rows.map((row) => ({
    id: row.ticket_id,
    label: [row.ticket_number, row.title].filter(Boolean).join(' — ') || '—',
  }));
}
