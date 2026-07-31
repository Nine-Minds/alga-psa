import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type {
  IOpportunity,
  IOpportunityQbrTrigger,
  IOpportunityQbrTriggerPack,
  IOpportunityQbrYieldRow,
} from '@alga-psa/types';
import { OpportunityModel } from '@alga-psa/opportunities/models/opportunityModel';
import { getOpportunitySettings } from '@alga-psa/opportunities/models/opportunitySettingsModel';
import { buildAssetAgingSuggestions } from '@alga-psa/opportunities/lib/generators/assetAgingGenerator';
import { buildRenewalSuggestions } from '@alga-psa/opportunities/lib/generators/renewalGenerator';
import { loadWhitespaceGrid } from '@alga-psa/opportunities/lib/generators/whitespaceGenerator';
import { buildOpportunityCreatedPayload } from '@alga-psa/opportunities/lib/opportunityEventBuilders';
import { publishOpportunityEventAfterCommit } from '@alga-psa/opportunities/lib/opportunityEvents';
import type { GeneratedSuggestion } from '@alga-psa/opportunities/lib/generators/types';

interface QbrClient {
  client_id: string;
  client_name: string;
  account_manager_id: string | null;
  default_currency_code: string;
}

export interface TicketTrendCounts {
  current_90_days: number;
  prior_90_days: number;
  window_end: string;
}

export function assembleQbrTriggerPack(input: {
  client: QbrClient;
  renewals: GeneratedSuggestion[];
  assetAging: GeneratedSuggestion[];
  ticketTrend: TicketTrendCounts;
  whitespace: Array<{
    category_id: string;
    category_name: string;
    adoption_percentage: number;
    adopted_client_count: number;
    comparable_client_count: number;
  }>;
}): IOpportunityQbrTriggerPack {
  const triggers: IOpportunityQbrTrigger[] = [];

  for (const renewal of input.renewals) {
    const subject = String(renewal.evidence.client_contract_id ?? renewal.dedupe_key);
    triggers.push({
      trigger_key: `renewal:${subject}`,
      kind: 'renewal',
      title: renewal.title,
      evidence: renewal.evidence,
      opportunity_type: 'renewal',
      generator_key: 'renewal',
      mrr_cents: renewal.mrr_cents,
      nrr_cents: renewal.nrr_cents,
      currency_code: renewal.currency_code,
      default_next_action: 'Schedule the renewal review',
    });
  }

  for (const aging of input.assetAging) {
    triggers.push({
      trigger_key: `asset_aging:${input.client.client_id}:${input.ticketTrend.window_end.slice(0, 4)}`,
      kind: 'asset_aging',
      title: aging.title,
      evidence: aging.evidence,
      opportunity_type: 'project',
      generator_key: 'asset_aging',
      mrr_cents: aging.mrr_cents,
      nrr_cents: aging.nrr_cents,
      currency_code: aging.currency_code,
      default_next_action: 'Review asset refresh options with the client',
    });
  }

  if (input.ticketTrend.current_90_days > input.ticketTrend.prior_90_days) {
    triggers.push({
      trigger_key: `ticket_trend:${input.client.client_id}:${input.ticketTrend.window_end}`,
      kind: 'ticket_trend',
      title: `${input.client.client_name} support-volume review`,
      evidence: {
        current_90_days: input.ticketTrend.current_90_days,
        prior_90_days: input.ticketTrend.prior_90_days,
        change: input.ticketTrend.current_90_days - input.ticketTrend.prior_90_days,
        window_end: input.ticketTrend.window_end,
      },
      opportunity_type: 'expansion',
      generator_key: null,
      mrr_cents: 0,
      nrr_cents: 0,
      currency_code: input.client.default_currency_code,
      default_next_action: 'Review the support trend with the client',
    });
  }

  for (const gap of input.whitespace) {
    triggers.push({
      trigger_key: `whitespace:${input.client.client_id}:${gap.category_id}`,
      kind: 'whitespace',
      title: `${input.client.client_name}: ${gap.category_name} opportunity`,
      evidence: gap,
      opportunity_type: 'expansion',
      generator_key: 'whitespace',
      mrr_cents: 0,
      nrr_cents: 0,
      currency_code: input.client.default_currency_code,
      default_next_action: `Validate the need for ${gap.category_name}`,
    });
  }

  return {
    client_id: input.client.client_id,
    client_name: input.client.client_name,
    account_manager_id: input.client.account_manager_id,
    triggers,
  };
}

async function loadTicketTrend(
  knex: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
  now: Date,
): Promise<TicketTrendCounts> {
  const currentStart = new Date(now);
  currentStart.setUTCDate(currentStart.getUTCDate() - 90);
  const priorStart = new Date(now);
  priorStart.setUTCDate(priorStart.getUTCDate() - 180);
  const rows = await tenantDb(knex, tenant).table('tickets')
    .where({ client_id: clientId })
    .where('entered_at', '>=', priorStart.toISOString())
    .where('entered_at', '<', now.toISOString())
    .select('entered_at');
  return {
    current_90_days: rows.filter((row) => new Date(row.entered_at) >= currentStart).length,
    prior_90_days: rows.filter((row) => new Date(row.entered_at) < currentStart).length,
    window_end: now.toISOString().slice(0, 10),
  };
}

async function persistFiredTriggers(
  trx: Knex | Knex.Transaction,
  tenant: string,
  pack: IOpportunityQbrTriggerPack,
  now: Date,
): Promise<void> {
  const db = tenantDb(trx, tenant);
  for (const trigger of pack.triggers) {
    await db.table('opportunity_qbr_triggers')
      .insert({
        tenant,
        client_id: pack.client_id,
        trigger_key: trigger.trigger_key,
        trigger_kind: trigger.kind,
        fired_at: now.toISOString(),
        last_seen_at: now.toISOString(),
      })
      .onConflict(['tenant', 'client_id', 'trigger_key'])
      .merge({ trigger_kind: trigger.kind, last_seen_at: now.toISOString() });
  }
}

export async function getQbrTriggerPackData(
  knex: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
  options: { now?: Date; persist?: boolean } = {},
): Promise<IOpportunityQbrTriggerPack> {
  const now = options.now ?? new Date();
  const db = tenantDb(knex, tenant);
  const client = await db.table('clients')
    .where({ client_id: clientId })
    .first<QbrClient>('client_id', 'client_name', 'account_manager_id', 'default_currency_code');
  if (!client) throw new Error('Client not found');

  const settings = await getOpportunitySettings(knex, tenant);
  const [renewals, assetAging, whitespaceData, ticketTrend] = await Promise.all([
    buildRenewalSuggestions(knex as Knex, tenant, 120, now),
    buildAssetAgingSuggestions(knex as Knex, tenant, settings.asset_age_years, now),
    loadWhitespaceGrid(knex as Knex, tenant, now),
    loadTicketTrend(knex, tenant, clientId, now),
  ]);
  const gridClient = whitespaceData.grid.clients.find((candidate) => candidate.client_id === clientId);
  const categoryById = new Map(whitespaceData.grid.categories.map((category) => [category.category_id, category]));
  const whitespace = (gridClient?.cells ?? []).flatMap((cell) => {
    const category = categoryById.get(cell.category_id);
    if (!category?.is_comparable || cell.has_category) return [];
    return [{
      category_id: category.category_id,
      category_name: category.category_name,
      adoption_percentage: category.adoption_percentage,
      adopted_client_count: category.adopted_client_count,
      comparable_client_count: whitespaceData.grid.active_contract_client_count,
    }];
  });
  const pack = assembleQbrTriggerPack({
    client,
    renewals: renewals.filter((suggestion) => {
      if (suggestion.client_id !== clientId) return false;
      const endDate = suggestion.evidence.end_date;
      if (typeof endDate !== 'string') return false;
      const renewal = new Date(`${endDate.slice(0, 10)}T00:00:00.000Z`);
      const horizon = new Date(now);
      horizon.setUTCDate(horizon.getUTCDate() + 120);
      return renewal >= now && renewal <= horizon;
    }),
    assetAging: assetAging.filter((suggestion) => suggestion.client_id === clientId),
    ticketTrend,
    whitespace,
  });
  if (options.persist !== false) await persistFiredTriggers(knex, tenant, pack, now);
  return pack;
}

async function nextOpportunityNumber(trx: Knex.Transaction, tenant: string): Promise<string> {
  const result = await trx.raw(
    'SELECT generate_next_number(:tenant::uuid, :type::text) as number',
    { tenant, type: 'OPPORTUNITY' },
  );
  const number = result.rows?.[0]?.number;
  if (!number) throw new Error('Failed to generate opportunity number');
  return number;
}

export async function createOpportunitiesFromQbrTriggersData(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
  triggerKeys: string[],
  actorId: string,
  now = new Date(),
): Promise<IOpportunity[]> {
  const pack = await getQbrTriggerPackData(trx, tenant, clientId, { now, persist: true });
  const byKey = new Map(pack.triggers.map((trigger) => [trigger.trigger_key, trigger]));
  const keys = [...new Set(triggerKeys)];
  const missing = keys.filter((key) => !byKey.has(key));
  if (missing.length) throw new Error(`QBR trigger not found: ${missing.join(', ')}`);
  const due = new Date(now);
  due.setUTCDate(due.getUTCDate() + 7);
  const created: IOpportunity[] = [];

  for (const key of keys) {
    const trigger = byKey.get(key)!;
    const existingTrigger = await tenantDb(trx, tenant).table('opportunity_qbr_triggers')
      .where({ client_id: clientId, trigger_key: key })
      .first('created_opportunity_id');
    if (existingTrigger?.created_opportunity_id) {
      const existing = await OpportunityModel.getById(trx, tenant, existingTrigger.created_opportunity_id);
      if (existing) {
        created.push(existing);
        continue;
      }
    }

    const timestamp = now.toISOString();
    const opportunity = await OpportunityModel.create(trx, tenant, {
      opportunity_number: await nextOpportunityNumber(trx, tenant),
      client_id: clientId,
      contact_id: null,
      title: trigger.title,
      opportunity_type: trigger.opportunity_type,
      owner_id: pack.account_manager_id ?? actorId,
      status: 'open',
      stage: 'identified',
      confidence: 'medium',
      mrr_cents: trigger.mrr_cents,
      nrr_cents: trigger.nrr_cents,
      hardware_cents: 0,
      currency_code: trigger.currency_code,
      values_locked_by_quote: false,
      expected_close_date: null,
      next_action: trigger.default_next_action,
      next_action_due: due.toISOString(),
      last_activity_at: timestamp,
      loss_reason: null,
      loss_notes: null,
      lost_to: null,
      generator_key: trigger.generator_key ?? null,
      generator_context: {
        qbr: true,
        qbr_trigger_key: trigger.trigger_key,
        qbr_trigger_kind: trigger.kind,
        qbr_evidence: trigger.evidence,
      },
      suggestion_id: null,
      converted_contract_id: null,
      converted_project_id: null,
      won_at: null,
      lost_at: null,
      created_by: actorId,
      created_at: timestamp,
      updated_at: timestamp,
    } as Omit<IOpportunity, 'tenant' | 'opportunity_id'>);
    await tenantDb(trx, tenant).table('opportunity_qbr_triggers')
      .where({ client_id: clientId, trigger_key: key })
      .update({ created_opportunity_id: opportunity.opportunity_id, accepted_at: timestamp });
    publishOpportunityEventAfterCommit(
      trx,
      tenant,
      'OPPORTUNITY_CREATED',
      buildOpportunityCreatedPayload({
        opportunityId: opportunity.opportunity_id,
        clientId,
        ownerId: opportunity.owner_id,
        stage: opportunity.stage,
        createdAt: timestamp,
      }),
      `opportunity_created:${opportunity.opportunity_id}`,
    );
    created.push(opportunity);
  }
  return created;
}

export async function getQbrYieldData(
  knex: Knex,
  tenant: string,
): Promise<IOpportunityQbrYieldRow[]> {
  const db = tenantDb(knex, tenant);
  const query = db.table('opportunity_qbr_triggers as qt');
  db.tenantJoin(query, 'clients as c', 'qt.client_id', 'c.client_id');
  query.leftJoin('users as u', function joinManager() {
    this.on('u.tenant', '=', 'c.tenant').andOn('u.user_id', '=', 'c.account_manager_id');
  });
  query.leftJoin('opportunities as o', function joinOpportunity() {
    this.on('o.tenant', '=', 'qt.tenant').andOn('o.opportunity_id', '=', 'qt.created_opportunity_id');
  });
  const rows = await query
    .groupBy('qt.client_id', 'c.client_name', 'c.account_manager_id', 'u.first_name', 'u.last_name')
    .select(
      'qt.client_id',
      'c.client_name',
      'c.account_manager_id',
      knex.raw("NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), '') AS account_manager_name"),
      knex.raw('COUNT(*)::integer AS triggers_fired'),
      knex.raw('COUNT(qt.created_opportunity_id)::integer AS opportunities_created'),
      knex.raw("COUNT(*) FILTER (WHERE o.status = 'won')::integer AS opportunities_won"),
    ) as any[];
  return rows.map((row) => ({
    ...row,
    triggers_fired: Number(row.triggers_fired),
    opportunities_created: Number(row.opportunities_created),
    opportunities_won: Number(row.opportunities_won),
  }));
}
