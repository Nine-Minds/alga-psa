/**
 * Operator commands for the shared offer catalog: inspect / publish / restore / seed / inventory.
 * Pure of process concerns (dependencies and output are injected) so it is unit-testable; the entry
 * point is `scripts/billing-catalog.ts`. Every command needs an authenticated platform operator.
 */
import type Stripe from 'stripe';
import type { Knex } from 'knex';
import type { OfferCatalog } from './catalog';
import { seedFromLegacyEnv } from './seed';
import { assertCatalogOperator } from './operatorAuth';
import { CO_MANAGED_SEAT_OFFER_KEY, OfferPublishError, type BillingInterval, type CatalogOperator, type OfferTerms } from './types';

export interface CliDeps {
  catalog: OfferCatalog;
  db: Knex;
  stripe: Pick<Stripe, 'subscriptions'>;
  actor: CatalogOperator | null | undefined;
  out: (line: string) => void;
  env?: Record<string, string | undefined>;
}

/** Amount for review, formatted from Stripe's own minor units and currency. Never assumes either. */
export function formatTerms(terms: OfferTerms): string {
  const format = new Intl.NumberFormat('en', { style: 'currency', currency: terms.currency.toUpperCase() });
  const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
  return `${format.format(terms.unitAmount / 10 ** digits)} (${terms.unitAmount} minor units, ${terms.currency.toUpperCase()}) per seat per ${terms.intervalCount === 1 ? '' : `${terms.intervalCount} `}${terms.interval}`;
}

const flag = (args: string[], name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const has = (args: string[], name: string) => args.includes(`--${name}`);

export async function runCatalogCommand(command: string, args: string[], deps: CliDeps): Promise<number> {
  const actor = assertCatalogOperator(deps.actor, deps.env);
  const offerKey = flag(args, 'offer') ?? CO_MANAGED_SEAT_OFFER_KEY;
  const interval = (flag(args, 'interval') ?? 'month') as BillingInterval;
  const { catalog, out } = deps;

  if (command === 'inspect') {
    const view = await catalog.inspect(offerKey, interval);
    out(`Offer ${offerKey}/${interval} in ${view.scope.stripeAccount} (${view.scope.livemode ? 'LIVE' : 'test'} mode)`);
    out(view.current ? `Current: version ${view.current.version_number} ${view.current.price_id} [${view.current.version_id}]` : 'Current: none (new purchases are paused or the offer is unmanaged)');
    if (view.legacyEnvPriceId) out(`Legacy env binding: ${view.legacyEnvPriceId}${view.versions.length ? ' (ignored: the offer is managed)' : ' (serving, offer unmanaged)'}`);
    for (const version of view.versions) out(`  v${version.version_number} ${version.price_id} ${version.is_current ? 'CURRENT' : 'retired'} [${version.version_id}] by ${version.published_by}`);
    if (view.current) {
      try {
        const offer = await catalog.resolveCurrentOffer(offerKey, interval);
        out(`Stripe terms now: ${formatTerms(offer.terms)}`);
      } catch (error) { out(`Current price is NOT sellable: ${(error as Error).message}`); }
    }
    return 0;
  }

  if (command === 'publish' || command === 'restore') {
    let priceId = flag(args, 'price');
    if (command === 'restore') {
      const versionId = flag(args, 'version');
      if (!versionId) throw new Error('restore needs --version=<version id from inspect>');
      const version = await catalog.getVersion(versionId);
      if (!version || version.offer_key !== offerKey || version.billing_interval !== interval) throw new Error('That version does not belong to this offer');
      priceId = version.price_id;
    }
    if (!priceId) throw new Error('publish needs --price=<Stripe price id>');
    const before = await catalog.inspect(offerKey, interval);
    const expectedArg = flag(args, 'expect');
    const expected = expectedArg === undefined ? undefined : expectedArg === 'none' ? null : expectedArg;
    const dryRun = !has(args, 'confirm');
    // Review: candidate facts come from Stripe now. A dry run never writes.
    out(`Reviewing ${priceId} for ${offerKey}/${interval} in ${before.scope.livemode ? 'LIVE' : 'test'} mode`);
    if (dryRun || expected === undefined) {
      const probe = await catalog.reviewCandidateTerms(offerKey, interval, priceId, flag(args, 'product'));
      out(`  Stripe says: ${formatTerms(probe.terms)}; product ${probe.productId}`);
      out(`  Current version: ${before.current?.version_id ?? 'none'}`);
      out(dryRun ? 'Dry run. Re-run with --confirm --expect=<current version id|none> to publish.' : 'Refusing to publish without --expect=<current version id|none>.');
      return dryRun ? 0 : 2;
    }
    const result = await catalog.publishBinding({ actor, offerKey, interval, priceId, expectedCurrentVersionId: expected, productId: flag(args, 'product') });
    out(result.changed ? `${result.action === 'restore' ? 'Restored' : 'Published'} version ${result.version.version_number} (${priceId}). New purchases use it; existing subscriptions are unchanged.` : `Already current; nothing changed.`);
    out(`  ${formatTerms(result.terms)}`);
    return 0;
  }

  if (command === 'seed') {
    const dryRun = !has(args, 'confirm');
    if (dryRun) { out('Seed reads the current environment bindings. Re-run with --confirm to write (idempotent). Use inventory first.'); return 0; }
    const historical = (flag(args, 'historical') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    for (const row of await seedFromLegacyEnv(catalog, actor, { historicalPriceIds: historical, productId: flag(args, 'product'), env: deps.env })) {
      out(`${row.offerKey} ${row.priceId || '-'}: ${row.outcome}${row.detail ? ` (${row.detail})` : ''}`);
    }
    return 0;
  }

  if (command === 'inventory') return inventory(deps, offerKey, interval);
  throw new OfferPublishError('INVALID_CANDIDATE', `Unknown command ${command}. Use inspect | publish | restore | seed | inventory.`);
}

/**
 * Pre-cutover inventory: every distinct Price on a live co-managed subscription and on an open
 * purchase operation, and whether the catalog maps it. Unmapped prices are REPORTED, never mapped.
 * Exit code 2 when anything is unmapped so a rollout checklist can gate on it.
 */
async function inventory(deps: CliDeps, offerKey: string, interval: BillingInterval): Promise<number> {
  const scope = await deps.catalog.scope();
  const seen = new Map<string, { where: Set<string> }>();
  const note = (priceId: string, where: string) => { (seen.get(priceId) ?? seen.set(priceId, { where: new Set() }).get(priceId)!).where.add(where); };
  for await (const sub of deps.stripe.subscriptions.list({ status: 'all', limit: 100 })) {
    const ours = sub.metadata?.subscription_kind === 'co_managed' || Boolean(sub.metadata?.portal_purchase_id);
    if (!ours || ['canceled', 'incomplete_expired'].includes(sub.status)) continue;
    for (const item of sub.items.data) note(item.price.id, `subscription ${sub.id} (${sub.status})`);
  }
  const operations = await deps.db('co_managed_purchase_operations').whereIn('state', ['preparing', 'checkout', 'payment_failed']).select('operation_id', 'state', 'price_id');
  let unpinned = 0;
  for (const op of operations) { if (op.price_id) note(op.price_id, `open operation ${op.operation_id} (${op.state})`); else unpinned += 1; }
  let unmapped = 0;
  for (const [priceId, { where }] of seen) {
    const classified = await deps.catalog.classifyPrice(scope, priceId);
    if (!classified) unmapped += 1;
    deps.out(`${classified ? (classified.source === 'catalog' ? `mapped ${classified.offerKey}/${classified.interval} ${classified.current ? 'current' : 'retired'}` : 'mapped via legacy env') : 'UNMAPPED'}  ${priceId}  <- ${[...where].join('; ')}`);
  }
  if (unpinned) deps.out(`${unpinned} open operation(s) predate pinning; they resume on the offer's current price (${offerKey}/${interval}).`);
  deps.out(unmapped ? `${unmapped} unmapped price(s). Resolve with the operator (seed --historical=... or publish) before cutover. Nothing was mapped.` : 'All prices map.');
  return unmapped ? 2 : 0;
}
