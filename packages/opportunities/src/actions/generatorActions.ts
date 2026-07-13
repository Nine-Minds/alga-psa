'use server';

import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { hasPermission, withAuth } from '@alga-psa/auth';
import type {
  ITmConversionMonthBucket,
  ITmConversionOnePager,
  IWhitespaceGrid,
  OpportunityGeneratorKey,
} from '@alga-psa/types';
import { opportunityGeneratorKeySchema } from '../schemas/opportunitySchemas';
import {
  loadTmBillingFacts,
  loadWhitespaceGrid,
  runGenerators,
  trailingTwelveMonthKeys,
  type GeneratorRunSummary,
} from '../lib/generators';

async function requirePermission(user: unknown, action: 'read' | 'update'): Promise<void> {
  if (!await hasPermission(user as any, 'opportunities', action)) {
    throw new Error(`Permission denied: opportunities ${action} required`);
  }
}

export const runGeneratorNow = withAuth(async (
  user,
  { tenant },
  key: OpportunityGeneratorKey,
): Promise<GeneratorRunSummary> => {
  await requirePermission(user, 'update');
  const parsedKey = opportunityGeneratorKeySchema.parse(key);
  const { knex } = await createTenantKnex();
  const [summary] = await runGenerators(knex, tenant, [parsedKey]);
  return summary;
});

export const getWhitespaceGrid = withAuth(async (
  user,
  { tenant },
): Promise<IWhitespaceGrid> => {
  await requirePermission(user, 'read');
  const { knex } = await createTenantKnex();
  return (await loadWhitespaceGrid(knex, tenant)).grid;
});

function evidenceBuckets(value: unknown): ITmConversionMonthBucket[] | null {
  if (!Array.isArray(value)) return null;
  const buckets = value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const month = (item as Record<string, unknown>).month;
    const total = (item as Record<string, unknown>).total_cents;
    if (typeof month !== 'string' || !Number.isFinite(Number(total))) return [];
    return [{ month, total_cents: Number(total) }];
  });
  return buckets.length === 12 ? buckets : null;
}

export const getTmConversionOnePager = withAuth(async (
  user,
  { tenant },
  clientIdOrSuggestionId: string,
): Promise<ITmConversionOnePager> => {
  await requirePermission(user, 'read');
  const { knex } = await createTenantKnex();
  const db = tenantDb(knex, tenant);
  const suggestion = await db.table('opportunity_suggestions')
    .where({ suggestion_id: clientIdOrSuggestionId })
    .select('suggestion_id', 'client_id', 'generator_key', 'evidence', 'currency_code')
    .first();

  if (suggestion) {
    if (suggestion.generator_key !== 'tm_conversion') {
      throw new Error('Suggestion is not a T&M conversion suggestion');
    }
    const client = await db.table('clients')
      .where({ client_id: suggestion.client_id })
      .select('client_name')
      .first();
    if (!client) throw new Error('Client not found');
    const evidence = (suggestion.evidence ?? {}) as Record<string, unknown>;
    const monthlyTotals = evidenceBuckets(evidence.monthly_totals);
    if (!monthlyTotals) throw new Error('T&M suggestion evidence is incomplete');
    return {
      client_id: suggestion.client_id,
      client_name: client.client_name,
      suggestion_id: suggestion.suggestion_id,
      currency_code: suggestion.currency_code,
      monthly_totals: monthlyTotals,
      trailing_12_total_cents: Number(evidence.trailing_12_total_cents ?? 0),
      monthly_avg_cents: Number(evidence.monthly_avg_cents ?? 0),
    };
  }

  const client = await db.table('clients')
    .where({ client_id: clientIdOrSuggestionId })
    .select('client_id', 'client_name', 'default_currency_code')
    .first();
  if (!client) throw new Error('Client or suggestion not found');
  const tmFacts = await loadTmBillingFacts(knex, tenant);
  if (tmFacts.mixedCurrencyClientIds.includes(client.client_id)) {
    throw new Error('T&M one-pager cannot combine invoices in multiple currencies');
  }
  const fact = tmFacts.facts
    .find((candidate) => candidate.client_id === client.client_id);
  if (fact) return { ...fact, suggestion_id: null };
  return {
    client_id: client.client_id,
    client_name: client.client_name,
    suggestion_id: null,
    currency_code: client.default_currency_code,
    monthly_totals: trailingTwelveMonthKeys().map((month) => ({ month, total_cents: 0 })),
    trailing_12_total_cents: 0,
    monthly_avg_cents: 0,
  };
});
