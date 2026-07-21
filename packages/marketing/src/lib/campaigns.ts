import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IMarketingCampaign, IMarketingCampaignFunnel } from '@alga-psa/types';
import type { CampaignInput } from '../schemas/marketingSchemas';

type Db = Knex | Knex.Transaction;

// pg parses DATE columns to a Date at the server's local midnight; JSON
// serialization would then shift the calendar day for clients on the other
// side of UTC. Normalize campaign dates back to plain 'YYYY-MM-DD' strings
// at this boundary so date-only values stay timezone-neutral on the wire.
function toDateOnlyString(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return String(value).slice(0, 10);
}

function normalizeCampaign(row: IMarketingCampaign): IMarketingCampaign {
  return {
    ...row,
    start_date: toDateOnlyString(row.start_date),
    end_date: toDateOnlyString(row.end_date),
  };
}

export async function listCampaignsInternal(knex: Knex, tenant: string): Promise<IMarketingCampaign[]> {
  const db = tenantDb(knex, tenant);
  const rows = await db.table('marketing_campaigns').where({ tenant }).orderBy('created_at', 'desc');
  return rows.map(normalizeCampaign);
}

export async function getCampaignInternal(knex: Knex, tenant: string, campaignId: string): Promise<IMarketingCampaign | null> {
  const db = tenantDb(knex, tenant);
  const row = await db.table('marketing_campaigns').where({ tenant, campaign_id: campaignId }).first();
  return row ? normalizeCampaign(row) : null;
}

export async function createCampaignInternal(knex: Knex, tenant: string, input: CampaignInput, createdBy: string): Promise<IMarketingCampaign> {
  const db = tenantDb(knex, tenant);
  const [row] = await db.table('marketing_campaigns')
    .insert({
      tenant,
      name: input.name,
      goal: input.goal ?? null,
      source_channel: input.source_channel ?? null,
      status: input.status ?? 'draft',
      start_date: input.start_date ?? null,
      end_date: input.end_date ?? null,
      created_by: createdBy,
    })
    .returning('*');
  return normalizeCampaign(row);
}

export async function updateCampaignInternal(knex: Knex, tenant: string, campaignId: string, input: Partial<CampaignInput>): Promise<IMarketingCampaign> {
  const db = tenantDb(knex, tenant);
  const [row] = await db.table('marketing_campaigns')
    .where({ tenant, campaign_id: campaignId })
    .update({ ...input, updated_at: new Date().toISOString() })
    .returning('*');
  if (!row) throw new Error('Campaign not found');
  return normalizeCampaign(row);
}

/**
 * Campaign funnel: engagement counts by interaction type plus the inbound-lead
 * suggestion counts (attribution carried in the suggestion evidence payload).
 */
export async function getCampaignFunnelInternal(db: Db, tenant: string, campaignId: string): Promise<IMarketingCampaignFunnel> {
  const tdb = tenantDb(db, tenant);

  const engagementCounts = await tdb.table('marketing_engagements as e')
    .join('interactions as i', function joinInteraction() {
      this.on('i.tenant', '=', 'e.tenant').andOn('i.interaction_id', '=', 'e.interaction_id');
    })
    .join('system_interaction_types as it', 'it.type_id', '=', 'i.type_id')
    .where({ 'e.tenant': tenant, 'e.campaign_id': campaignId })
    .groupBy('it.type_name')
    .select('it.type_name')
    .count('* as count') as Array<{ type_name: string; count: string | number }>;

  const byType = new Map(engagementCounts.map((row) => [row.type_name, Number(row.count)]));

  const suggestionRows = await tdb.table('opportunity_suggestions')
    .where({ tenant, generator_key: 'inbound-lead' })
    .whereRaw("evidence->>'campaignId' = ?", [campaignId])
    .groupBy('status')
    .select('status')
    .count('* as count') as Array<{ status: string; count: string | number }>;

  const suggestionsCreated = suggestionRows.reduce((sum, row) => sum + Number(row.count), 0);
  const suggestionsAccepted = suggestionRows
    .filter((row) => row.status === 'accepted')
    .reduce((sum, row) => sum + Number(row.count), 0);

  return {
    posts_published: byType.get('Marketing: Post Published') ?? 0,
    emails_sent: byType.get('Marketing: Email Sent') ?? 0,
    emails_opened: byType.get('Marketing: Email Opened') ?? 0,
    emails_clicked: byType.get('Marketing: Email Clicked') ?? 0,
    forms_submitted: byType.get('Marketing: Form Submitted') ?? 0,
    suggestions_created: suggestionsCreated,
    suggestions_accepted: suggestionsAccepted,
  };
}
