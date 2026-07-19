import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { persistGeneratedSuggestions, type GeneratedSuggestion } from '@alga-psa/opportunities/lib';
import { recordMarketingEngagement } from './engagements';
import { normalizeEmail } from './suppression';
import type { CaptureSubmission } from '../schemas/marketingSchemas';

export interface CaptureResult {
  contactId: string;
  clientId: string;
  contactCreated: boolean;
  clientCreated: boolean;
  suggestionCreated: boolean;
}

async function tenantDefaultCurrency(db: ReturnType<typeof tenantDb>, tenant: string): Promise<string> {
  const settings = await db.table('default_billing_settings')
    .where({ tenant })
    .first('default_currency_code');
  return (settings?.default_currency_code as string | undefined) ?? 'USD';
}

/**
 * Handles one public capture-form submission. Everything runs in a single
 * transaction: find-or-create contact (+ prospect client when the email is
 * unknown), upsert marketing contact state, log the form_submitted
 * engagement, and — when the form opts in — register an inbound-lead
 * suggestion through the opportunities module's own generator persistence
 * (dedupe key: one live suggestion per form per email).
 */
export async function submitCaptureInternal(
  knex: Knex,
  tenant: string,
  slug: string,
  payload: CaptureSubmission,
): Promise<CaptureResult> {
  const email = normalizeEmail(payload.email);
  const now = new Date().toISOString();

  const { contactId, clientId, contactCreated, clientCreated, form, campaignName } =
    await withTransaction(knex, async (trx) => {
      const db = tenantDb(trx, tenant);

      const form = await db.table('marketing_capture_forms')
        .where({ tenant, slug, is_active: true })
        .first();
      if (!form) throw new Error('Capture form not found');

      let campaignName: string | null = null;
      if (form.campaign_id) {
        const campaign = await db.table('marketing_campaigns')
          .where({ tenant, campaign_id: form.campaign_id })
          .first('name');
        campaignName = campaign?.name ?? null;
      }

      // 1. Find the contact by email, or create them (and their client). An
      // existing contact without a client (imported, portal-created) gets a
      // prospect client attached the same way a brand-new contact does.
      let contact = await db.table('contacts')
        .where({ tenant })
        .whereRaw('lower(email) = ?', [email])
        .first('contact_name_id', 'client_id', 'full_name');

      let clientCreated = false;
      let contactCreated = false;
      let clientId: string;

      if (contact?.client_id) {
        clientId = String(contact.client_id);
      } else {
        const companyName = payload.company?.trim() || null;
        let client = companyName
          ? await db.table('clients')
              .where({ tenant })
              .whereRaw('lower(client_name) = ?', [companyName.toLowerCase()])
              .first('client_id')
          : null;

        if (!client) {
          const currency = await tenantDefaultCurrency(db, tenant);
          const [created] = await db.table('clients')
            .insert({
              tenant,
              client_name: companyName ?? payload.name.trim(),
              lifecycle_status: 'prospect',
              default_currency_code: currency,
              properties: { source: `capture:${slug}` },
            })
            .returning('client_id');
          client = created;
          clientCreated = true;
        }
        clientId = String(client.client_id);

        if (contact) {
          await db.table('contacts')
            .where({ tenant, contact_name_id: contact.contact_name_id })
            .update({ client_id: clientId, updated_at: now });
          contact = { ...contact, client_id: clientId };
        } else {
          const [createdContact] = await db.table('contacts')
            .insert({
              tenant,
              full_name: payload.name.trim(),
              email,
              client_id: clientId,
            })
            .returning(['contact_name_id', 'full_name']);
          contact = { ...createdContact, client_id: clientId };
          contactCreated = true;
        }
      }

      const contactId = String(contact.contact_name_id);

      // 2. Marketing contact state: form submission is consent to follow up —
      // including a re-submission after an earlier opt-out (the suppression
      // table stays authoritative for sends either way).
      await db.table('marketing_contact_state')
        .insert({
          tenant,
          contact_id: contactId,
          consent: true,
          source: `capture:${slug}`,
        })
        .onConflict(['tenant', 'contact_id'])
        .merge({ consent: true, source: `capture:${slug}`, updated_at: now });

      // 3. Engagement log entry.
      await recordMarketingEngagement(trx, tenant, {
        typeName: 'Marketing: Form Submitted',
        title: `Form submitted: ${form.name}`,
        notes: payload.message ?? null,
        contactId,
        clientId,
        userId: form.created_by,
        campaignId: form.campaign_id ?? null,
        occurredAt: now,
      });

      return { contactId, clientId, contactCreated, clientCreated, form, campaignName };
    });

  // 4. Inbound-lead suggestion via the opportunities module's generator
  // persistence (handles dedupe/reopen + event). Outside the capture
  // transaction: persistGeneratedSuggestions manages its own.
  let suggestionCreated = false;
  if (form.creates_suggestion) {
    const currency = await tenantDefaultCurrency(tenantDb(knex, tenant), tenant);
    const contactName = payload.name.trim();
    const generated: GeneratedSuggestion = {
      client_id: clientId,
      title: `Inbound lead: ${contactName} (${form.name})`,
      evidence: {
        source: 'capture_form',
        formId: String(form.form_id),
        formName: String(form.name),
        formSlug: slug,
        campaignId: form.campaign_id ? String(form.campaign_id) : null,
        campaignName,
        contactId,
        contactName,
        contactEmail: email,
        message: payload.message ? payload.message.slice(0, 500) : null,
        submittedAt: now,
      },
      mrr_cents: 0,
      nrr_cents: 0,
      currency_code: currency,
      dedupe_key: `inbound-lead:${String(form.form_id)}:${email}`,
    };
    const summary = await persistGeneratedSuggestions(knex, tenant, 'inbound-lead', [generated]);
    suggestionCreated = summary.created + summary.reopened > 0;
  }

  return { contactId, clientId, contactCreated, clientCreated, suggestionCreated };
}
