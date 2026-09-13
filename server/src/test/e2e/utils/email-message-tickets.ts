import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

export async function readTicketsForEmailMessage(db: Knex, tenant: string, messageId: string | undefined) {
  const normalized = messageId?.trim().replace(/^<|>$/g, '');
  if (!normalized) throw new Error('Send and capture an email before reading its tickets');
  return tenantDb(db, tenant).table('tickets')
    .whereRaw("email_metadata->>'messageId' IN (?, ?)", [normalized, `<${normalized}>`])
    .select('*');
}
