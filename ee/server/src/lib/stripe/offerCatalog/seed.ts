import { LEGACY_ENV_BINDINGS, type CatalogOperator, type EnvLike } from './types';
import type { OfferCatalog } from './catalog';
import { legacyEnvPriceId } from './catalog';

export interface SeedReport { offerKey: string; priceId: string; outcome: 'seeded-current' | 'seeded-historical' | 'already-bound' | 'skipped'; detail?: string }

/**
 * Seed the catalog from the current environment bindings (plus operator-verified historical
 * prices). Idempotent: a price already bound is reported, never rewritten. A key that is already
 * managed with a different current version is left alone. Unknown prices are never mapped here.
 */
export async function seedFromLegacyEnv(catalog: OfferCatalog, actor: CatalogOperator, opts: { historicalPriceIds?: string[]; productId?: string; env?: EnvLike } = {}): Promise<SeedReport[]> {
  const report: SeedReport[] = [];
  for (const [offerKey, binding] of Object.entries(LEGACY_ENV_BINDINGS)) {
    const envPrice = legacyEnvPriceId(offerKey, binding.interval, opts.env);
    const { current } = await catalog.inspect(offerKey, binding.interval);
    for (const priceId of opts.historicalPriceIds ?? []) {
      const result = await catalog.publishBinding({ actor, offerKey, interval: binding.interval, priceId, expectedCurrentVersionId: current?.version_id ?? null, productId: opts.productId, mode: 'historical' });
      report.push({ offerKey, priceId, outcome: result.changed ? 'seeded-historical' : 'already-bound' });
    }
    if (!envPrice) { report.push({ offerKey, priceId: '', outcome: 'skipped', detail: `${binding.env} is not set` }); continue; }
    const { current: now, versions } = await catalog.inspect(offerKey, binding.interval);
    // Bound but not current means an operator paused (or retired) it: seeding must never reopen sales.
    if (!now && versions.some((version) => version.price_id === envPrice)) {
      report.push({ offerKey, priceId: envPrice, outcome: 'skipped', detail: 'bound but not current (new sales paused); resume with restore' }); continue;
    }
    if (now && now.price_id !== envPrice) { report.push({ offerKey, priceId: envPrice, outcome: 'skipped', detail: `already managed with ${now.price_id} as current` }); continue; }
    const result = await catalog.publishBinding({ actor, offerKey, interval: binding.interval, priceId: envPrice, expectedCurrentVersionId: now?.version_id ?? null, productId: opts.productId, mode: 'seed' });
    report.push({ offerKey, priceId: envPrice, outcome: result.changed ? 'seeded-current' : 'already-bound' });
  }
  return report;
}
