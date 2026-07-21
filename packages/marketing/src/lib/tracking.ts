import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { recordMarketingEngagement } from './engagements';

interface EnrollmentContext {
  contactId: string;
  clientId: string | null;
  userId: string;
  campaignId: string | null;
}

async function loadEnrollmentContext(
  db: ReturnType<typeof tenantDb>,
  tenant: string,
  enrollmentId: string,
): Promise<EnrollmentContext | null> {
  const enrollment = await db.table('marketing_sequence_enrollments')
    .where({ tenant, enrollment_id: enrollmentId })
    .first('contact_id', 'enrolled_by', 'sequence_id');
  if (!enrollment) return null;

  const contact = await db.table('contacts')
    .where({ tenant, contact_name_id: enrollment.contact_id })
    .first('contact_name_id', 'client_id');

  const sequence = await db.table('marketing_sequences')
    .where({ tenant, sequence_id: enrollment.sequence_id })
    .first('created_by', 'campaign_id');

  const userId = (enrollment.enrolled_by as string | null) ?? sequence?.created_by ?? null;
  if (!contact || !userId) return null;

  return {
    contactId: contact.contact_name_id,
    clientId: contact.client_id ?? null,
    userId,
    campaignId: (sequence?.campaign_id as string | null) ?? null,
  };
}

/** Public tracking endpoints call these; failures must never break the redirect/pixel response. */
export async function recordSequenceOpenInternal(
  knex: Knex,
  tenant: string,
  enrollmentId: string,
  stepId: string,
): Promise<void> {
  await withTransaction(knex, async (trx) => {
    const db = tenantDb(trx, tenant);
    const ctx = await loadEnrollmentContext(db, tenant, enrollmentId);
    if (!ctx) return;
    await recordMarketingEngagement(trx, tenant, {
      typeName: 'Marketing: Email Opened',
      title: 'Sequence email opened',
      contactId: ctx.contactId,
      clientId: ctx.clientId,
      userId: ctx.userId,
      campaignId: ctx.campaignId,
      stepId,
    });
  });
}

export async function recordSequenceClickInternal(
  knex: Knex,
  tenant: string,
  enrollmentId: string,
  stepId: string,
  url: string,
): Promise<void> {
  await withTransaction(knex, async (trx) => {
    const db = tenantDb(trx, tenant);
    const ctx = await loadEnrollmentContext(db, tenant, enrollmentId);
    if (!ctx) return;
    await recordMarketingEngagement(trx, tenant, {
      typeName: 'Marketing: Email Clicked',
      title: 'Sequence email link clicked',
      notes: url,
      contactId: ctx.contactId,
      clientId: ctx.clientId,
      userId: ctx.userId,
      campaignId: ctx.campaignId,
      stepId,
    });
  });
}
