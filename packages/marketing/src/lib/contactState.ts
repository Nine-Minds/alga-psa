import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IMarketingContactState, IMarketingEngagement } from '@alga-psa/types';
import { normalizeEmail } from './suppression';

export interface ContactMarketingProfile {
  contactState: IMarketingContactState | null;
  suppressed: boolean;
  suppressionReason: string | null;
  engagements: Array<IMarketingEngagement & { type_name: string; title: string; interaction_date: string }>;
  activeEnrollments: Array<{ enrollment_id: string; sequence_id: string; sequence_name: string; current_step_order: number; next_send_at: string | null }>;
}

/** Contact-record side panel: consent state, suppression, recent touches. */
export async function getContactMarketingProfileInternal(
  knex: Knex,
  tenant: string,
  contactId: string,
): Promise<ContactMarketingProfile | null> {
  const db = tenantDb(knex, tenant);
  const contact = await db.table('contacts')
    .where({ tenant, contact_name_id: contactId })
    .first('contact_name_id', 'email');
  if (!contact) return null;

  const contactState = await db.table('marketing_contact_state')
    .where({ tenant, contact_id: contactId })
    .first() as IMarketingContactState | undefined;

  let suppressed = false;
  let suppressionReason: string | null = null;
  if (contact.email) {
    const suppression = await db.table('marketing_suppressions')
      .where({ tenant, email: normalizeEmail(contact.email) })
      .first('reason');
    suppressed = Boolean(suppression);
    suppressionReason = suppression?.reason ?? null;
  }

  const engagements = await db.table('marketing_engagements as e')
    .join('interactions as i', function joinInteraction() {
      this.on('i.tenant', '=', 'e.tenant').andOn('i.interaction_id', '=', 'e.interaction_id');
    })
    .join('interaction_types as it', function joinType() {
      this.on('it.tenant', '=', 'i.tenant').andOn('it.type_id', '=', 'i.type_id');
    })
    .where({ 'e.tenant': tenant, 'i.contact_name_id': contactId })
    .orderBy('i.interaction_date', 'desc')
    .limit(50)
    .select('e.*', 'it.type_name', 'i.title', 'i.interaction_date');

  const activeEnrollments = await db.table('marketing_sequence_enrollments as e')
    .join('marketing_sequences as s', function joinSequence() {
      this.on('s.tenant', '=', 'e.tenant').andOn('s.sequence_id', '=', 'e.sequence_id');
    })
    .where({ 'e.tenant': tenant, 'e.contact_id': contactId, 'e.state': 'active' })
    .select('e.enrollment_id', 'e.sequence_id', 's.name as sequence_name', 'e.current_step_order', 'e.next_send_at');

  return {
    contactState: contactState ?? null,
    suppressed,
    suppressionReason,
    engagements: engagements as ContactMarketingProfile['engagements'],
    activeEnrollments: activeEnrollments as ContactMarketingProfile['activeEnrollments'],
  };
}
