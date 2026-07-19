import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { MarketingSuppressionReason, MarketingSuppressionSource } from '@alga-psa/types';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Hard guard consulted by every send path. */
export async function isSuppressed(
  knex: Knex | Knex.Transaction,
  tenant: string,
  email: string,
): Promise<boolean> {
  const db = tenantDb(knex, tenant);
  const row = await db.table('marketing_suppressions')
    .where({ tenant, email: normalizeEmail(email) })
    .first('suppression_id');
  return Boolean(row);
}

/**
 * Adds (idempotently) a suppression entry and stops every active enrollment
 * for the address. Keyed by email so suppression survives contact deletion
 * and re-import.
 */
export async function addSuppression(
  trx: Knex.Transaction,
  tenant: string,
  input: {
    email: string;
    contactId?: string | null;
    reason: MarketingSuppressionReason;
    source: MarketingSuppressionSource;
  },
): Promise<void> {
  const db = tenantDb(trx, tenant);
  const email = normalizeEmail(input.email);

  await db.table('marketing_suppressions')
    .insert({
      tenant,
      email,
      contact_id: input.contactId ?? null,
      reason: input.reason,
      source: input.source,
    })
    .onConflict(['tenant', 'email'])
    .ignore();

  const now = new Date().toISOString();
  if (input.contactId) {
    await db.table('marketing_contact_state')
      .insert({
        tenant,
        contact_id: input.contactId,
        consent: false,
        unsubscribed_at: now,
      })
      .onConflict(['tenant', 'contact_id'])
      .merge({ unsubscribed_at: now, updated_at: now });

    await db.table('marketing_sequence_enrollments')
      .where({ tenant, contact_id: input.contactId, state: 'active' })
      .update({ state: 'stopped', next_send_at: null, updated_at: now });
  }

  // Stop every other active enrollment for the address (duplicate contacts
  // sharing one email). Postgres cannot UPDATE through a knex join, so
  // resolve the enrollment ids first, then update by key.
  const emailMatched = await db.table('marketing_sequence_enrollments as e')
    .join('contacts as c', function joinContact() {
      this.on('c.tenant', '=', 'e.tenant').andOn('c.contact_name_id', '=', 'e.contact_id');
    })
    .where({ 'e.tenant': tenant, 'e.state': 'active' })
    .whereRaw('lower(c.email) = ?', [email])
    .pluck('e.enrollment_id');
  if (emailMatched.length > 0) {
    await db.table('marketing_sequence_enrollments')
      .where({ tenant, state: 'active' })
      .whereIn('enrollment_id', emailMatched)
      .update({ state: 'stopped', next_send_at: null, updated_at: now });
  }
}
