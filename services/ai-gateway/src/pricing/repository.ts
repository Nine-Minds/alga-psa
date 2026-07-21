import type { Knex } from 'knex';

import type { PricingConfigRow } from '../db/types.js';
import {
  resolvePricingRate,
  type DefaultPricingRate,
  type PricingRecord,
  type ResolvedPricingRate,
} from './pricing.js';

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export async function resolvePricingRateFromDatabase(
  database: Knex,
  model: string,
  now: Date,
  defaultRate: DefaultPricingRate,
): Promise<ResolvedPricingRate> {
  const rows = await database<PricingConfigRow>('pricing_config')
    .where('effective_from', '<=', now)
    .select('*');

  const records: PricingRecord[] = rows.map((row) => ({
    pricingId: row.pricing_id,
    modelPattern: row.model_pattern,
    inputCreditsPer1kTokens: row.credits_per_1k_input_tokens,
    outputCreditsPer1kTokens: row.credits_per_1k_output_tokens,
    effectiveFrom: toDate(row.effective_from),
  }));

  return resolvePricingRate(records, model, now, defaultRate);
}
