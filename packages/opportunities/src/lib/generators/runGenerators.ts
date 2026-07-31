import type { Knex } from 'knex';
import logger from '@alga-psa/core/logger';
import { tenantDb } from '@alga-psa/db';
import type { OpportunityGeneratorKey } from '@alga-psa/types';
import { getOpportunitySettings } from '../../models/opportunitySettingsModel';
import { buildOpportunitySuggestionCreatedPayload } from '../opportunityEventBuilders';
import { publishOpportunityEventAfterCommit } from '../opportunityEvents';
import { assetAgingGenerator } from './assetAgingGenerator';
import { renewalGenerator } from './renewalGenerator';
import { tmConversionGenerator } from './tmConversionGenerator';
import type {
  GeneratedSuggestion,
  GeneratorRunSummary,
  SuggestionGenerator,
} from './types';
import { whitespaceGenerator } from './whitespaceGenerator';

/**
 * Generators that run on the scheduled sweep. 'inbound-lead' is deliberately
 * absent: marketing creates those suggestions synchronously at capture time
 * (via persistGeneratedSuggestions), not from a periodic scan.
 */
export type SweepGeneratorKey = Exclude<OpportunityGeneratorKey, 'inbound-lead'>;

export const GENERATORS: Record<SweepGeneratorKey, SuggestionGenerator> = {
  renewal: renewalGenerator,
  tm_conversion: tmConversionGenerator,
  whitespace: whitespaceGenerator,
  asset_aging: assetAgingGenerator,
};

export const OPPORTUNITY_GENERATOR_KEYS = Object.keys(GENERATORS) as SweepGeneratorKey[];

interface ExistingSuggestionRow {
  suggestion_id: string;
  status: 'pending' | 'accepted' | 'dismissed' | 'snoozed';
  snoozed_until: Date | string | null;
}

const snoozeExpired = (value: Date | string | null, now: Date): boolean => (
  value !== null && new Date(value).getTime() <= now.getTime()
);

export function classifyExistingSuggestion(
  existing: Pick<ExistingSuggestionRow, 'status' | 'snoozed_until'>,
  now: Date,
): 'refresh' | 'reopen' | 'dedupe' {
  if (existing.status === 'pending') return 'refresh';
  if (existing.status === 'snoozed' && snoozeExpired(existing.snoozed_until, now)) return 'reopen';
  return 'dedupe';
}

export async function persistGeneratedSuggestions(
  knex: Knex,
  tenant: string,
  key: OpportunityGeneratorKey,
  generated: GeneratedSuggestion[],
  now = new Date(),
): Promise<GeneratorRunSummary> {
  const unique = new Map<string, GeneratedSuggestion>();
  for (const item of generated) unique.set(item.dedupe_key, item);

  const summary: GeneratorRunSummary = {
    key,
    generated: generated.length,
    fired: 0,
    created: 0,
    reopened: 0,
    deduped: generated.length - unique.size,
  };

  await knex.transaction(async (trx) => {
    await trx.raw('select set_config(?, ?, true)', ['app.current_tenant', tenant]);
    await trx.raw('select set_config(?, ?, true)', ['app.current_user', 'system']);
    const db = tenantDb(trx, tenant);
    for (const item of unique.values()) {
      const values = {
        tenant,
        generator_key: key,
        client_id: item.client_id,
        title: item.title,
        evidence: item.evidence,
        mrr_cents: item.mrr_cents,
        nrr_cents: item.nrr_cents,
        currency_code: item.currency_code,
        dedupe_key: item.dedupe_key,
        updated_at: now.toISOString(),
      };
      const [created] = await db.table('opportunity_suggestions')
        .insert({
          ...values,
          status: 'pending',
          snoozed_until: null,
          created_at: now.toISOString(),
        })
        .onConflict(['tenant', 'generator_key', 'dedupe_key'])
        .ignore()
        .returning('*');

      if (created) {
        summary.created += 1;
        summary.fired += 1;
        publishOpportunityEventAfterCommit(
          trx,
          tenant,
          'OPPORTUNITY_SUGGESTION_CREATED',
          buildOpportunitySuggestionCreatedPayload({
            suggestionId: created.suggestion_id,
            clientId: created.client_id,
            generatorKey: key,
            createdAt: now.toISOString(),
          }),
          `opportunity_suggestion_created:${created.suggestion_id}`,
        );
        continue;
      }

      const existing = await db.table('opportunity_suggestions')
        .where({ generator_key: key, dedupe_key: item.dedupe_key })
        .forUpdate()
        .first() as ExistingSuggestionRow | undefined;
      if (!existing) throw new Error(`Suggestion dedupe conflict could not be resolved for ${item.dedupe_key}`);

      const decision = classifyExistingSuggestion(existing, now);
      if (decision === 'reopen') {
        await db.table('opportunity_suggestions')
          .where({ suggestion_id: existing.suggestion_id })
          .update({ ...values, status: 'pending', snoozed_until: null });
        summary.reopened += 1;
        summary.fired += 1;
        continue;
      }

      if (decision === 'refresh') {
        await db.table('opportunity_suggestions')
          .where({ suggestion_id: existing.suggestion_id })
          .update(values);
      }
      summary.deduped += 1;
    }
  });

  return summary;
}

export async function runGenerators(
  knex: Knex,
  tenant: string,
  keys: SweepGeneratorKey[] = OPPORTUNITY_GENERATOR_KEYS,
): Promise<GeneratorRunSummary[]> {
  const settings = await getOpportunitySettings(knex, tenant);
  const summaries: GeneratorRunSummary[] = [];
  for (const key of keys) {
    const generator = GENERATORS[key];
    const generated = await generator.run({ knex, tenant, settings });
    const summary = await persistGeneratedSuggestions(knex, tenant, key, generated);
    summaries.push(summary);
    logger.info('[opportunityGenerators] Generator run complete', {
      tenant,
      generatorKey: key,
      fired: summary.fired,
      deduped: summary.deduped,
      created: summary.created,
      reopened: summary.reopened,
    });
  }
  return summaries;
}
