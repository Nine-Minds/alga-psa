/**
 * Write-admission primitive.
 *
 * A domain that must veto or condition a native write (for example a read-only
 * workspace) registers ONE provider here. Native write paths call `admitWrite`
 * inside the transaction that performs the write, before row access.
 *
 * With no provider registered, `admitWrite` returns before reading `trx`: an
 * unregistered deployment pays one property read and issues zero SQL. A registered
 * provider gets the strict contract: it must run inside an open transaction.
 *
 * The provider lives on `globalThis` so separately bundled copies of this package
 * (Next server bundle, worker adapters) share one registration.
 *
 * Adoption at native call sites is deliberately not part of this module.
 *
 * ## Two seams, one decision source (CM L0c)
 *
 * - The PROVIDER (above) is the exact, in-transaction seam. A domain that must
 *   serialize with its own state machine (acceptance, allocation, termination)
 *   registers one and calls `admitWrite` inside its lock order.
 * - The RESOLVER answers "may this tenant write?" lock-free and cached. It backs
 *   the `tenantDb` write terminals (`admitTenantWrite`) and, when registered, ALSO
 *   backs `admitWrite`, so a refusal is decided in one place and every door
 *   (tenantDb, BaseService, assertCoManagedOperationalWrite) agrees. `admitWrite`
 *   consults the resolver first, then the provider.
 *
 * The providers stay separate because their consistency contracts differ: the
 * resolver is allowed to be up to `WRITE_ADMISSION_TTL_MS` stale and must never
 * take a row lock; the provider must be exact and runs under the owner's locks.
 *
 * Cost model: no resolver registered => nothing is read and nothing is issued
 * (one warning per tenant). A resolver registered => one `tenants.product_code`
 * read per process per tenant, ever; a tenant that is not co-managed is then
 * remembered forever and never reaches the resolver again.
 */
import type { Knex } from 'knex';
import { isOperationalWriteTable } from './operationalWriteTables';
import { tenantDb } from './tenantDb';

export interface WriteAdmissionContext {
  tenant: string;
  /** Stable operation name, e.g. `workflow-tag-write`. */
  operation: string;
  resource?: string;
}

/** Resolve to admit; throw to refuse. */
export type WriteAdmissionProvider = (trx: Knex.Transaction, context: WriteAdmissionContext) => Promise<void>;

/** What a resolver answers for one co-managed tenant. */
export interface WriteAdmissionDecision {
  canWrite: boolean;
  /** The refusal to throw when `canWrite` is false. Built by the registering
   * package: `@alga-psa/db` never imports the domain that owns the error type. */
  denial?: Error;
}

/** Called only for tenants whose `product_code` is `co_managed`. Must be lock-free. */
export type WriteAdmissionResolver = ((db: Knex | Knex.Transaction, tenant: string) => Promise<WriteAdmissionDecision>) & {
  /** Changes when external inputs invalidate cached decisions. */
  cacheKey?: () => string;
};

export interface TenantWriteContext {
  table?: string;
  operation: string;
}

interface WriteAdmissionState {
  /** Tenants known not to be co-managed. Permanent: a tenant only ever leaves the product. */
  negative: Set<string>;
  /** Short-lived decisions for co-managed tenants. */
  decisions: Map<string, { until: number; decision: WriteAdmissionDecision; key?: string; resolver: WriteAdmissionResolver }>;
  inflight: Map<string, { promise: Promise<WriteAdmissionDecision | null>; key?: string; revision: number; tenantRevision: number; resolver: WriteAdmissionResolver }>;
  warned: Set<string>;
  /** Tenants invalidated and not yet re-read: product-code hints are ignored for them. */
  mustLookup: Set<string>;
  revision: number;
  tenantRevisions: Map<string, number>;
}

declare global {
  // eslint-disable-next-line no-var
  var __algaWriteAdmissionProvider: WriteAdmissionProvider | undefined;
  // eslint-disable-next-line no-var
  var __algaWriteAdmissionResolver: WriteAdmissionResolver | undefined;
  // eslint-disable-next-line no-var
  var __algaWriteAdmissionState: WriteAdmissionState | undefined;
}

/** Plan §11.2: a co-managed decision may be this stale. */
export const WRITE_ADMISSION_TTL_MS = 5_000;

/** The `tenants.product_code` value of a co-managed workspace. */
export const CO_MANAGED_PRODUCT_CODE = 'co_managed';

const LOOKUP_TENANT = '__write_admission_lookup__';

// State is on globalThis for the same reason as the registrations: separately
// bundled copies of this package must share one negative set and one cache.
function state(): WriteAdmissionState {
  return (globalThis.__algaWriteAdmissionState ??= {
    negative: new Set(),
    decisions: new Map(),
    inflight: new Map(),
    warned: new Set(),
    mustLookup: new Set(),
    revision: 0,
    tenantRevisions: new Map(),
  });
}

/** Register the single provider. A later registration replaces the earlier one. */
export function registerWriteAdmissionProvider(provider: WriteAdmissionProvider): void {
  globalThis.__algaWriteAdmissionProvider = provider;
}

export function resetWriteAdmissionProvider(): void {
  globalThis.__algaWriteAdmissionProvider = undefined;
}

/** Register the single resolver. A later registration replaces the earlier one. */
export function registerWriteAdmissionResolver(resolver: WriteAdmissionResolver): void {
  globalThis.__algaWriteAdmissionResolver = resolver;
}

export function resetWriteAdmissionResolver(): void {
  globalThis.__algaWriteAdmissionResolver = undefined;
}

export function hasWriteAdmissionResolver(): boolean {
  return Boolean(globalThis.__algaWriteAdmissionResolver);
}

/** True when this tenant's writes need a decision: a resolver exists and the
 * tenant is not known to be a non-participant. `tenantDb` attaches no guard when false. */
export function isTenantWriteGuarded(tenant: string): boolean {
  return Boolean(globalThis.__algaWriteAdmissionResolver) && !state().negative.has(tenant);
}

/** Forget a tenant's cached decision (and a stale negative) after a lifecycle transition. */
export function invalidateWriteAdmission(tenant?: string): void {
  const s = state();
  if (tenant === undefined) {
    s.revision++;
    s.decisions.clear();
    s.negative.clear();
    s.inflight.clear();
    s.mustLookup.clear();
    return;
  }
  s.decisions.delete(tenant);
  s.negative.delete(tenant);
  s.tenantRevisions.set(tenant, (s.tenantRevisions.get(tenant) ?? 0) + 1);
  s.inflight.delete(tenant);
  // A session minted before the transition still says the old product; until one real
  // lookup has run, such hints must not re-seed the negative set.
  s.mustLookup.add(tenant);
}

/** Reset everything this module remembers. For tests. */
export function resetWriteAdmissionCache(): void {
  const s = state();
  s.negative.clear();
  s.decisions.clear();
  s.inflight.clear();
  s.warned.clear();
  s.mustLookup.clear();
  s.revision++;
  s.tenantRevisions.clear();
}

/**
 * Seed the decision from a product code the caller already holds (the session carries
 * `product_code`), so a plain PSA request pays no `tenants` read at all. Only a
 * non-`co_managed` code is acted on: it goes straight into the negative set. A
 * `co_managed` (or unknown) code changes nothing; the lookup decides. Ignored for a
 * tenant that was invalidated and not yet re-read, because the hint may predate the change.
 */
export function noteTenantProductCode(tenant: string | undefined | null, productCode: string | undefined | null): void {
  if (!tenant || (productCode !== 'psa' && productCode !== 'algadesk')) return;
  const s = state();
  if (s.mustLookup.has(tenant) || s.decisions.has(tenant) || s.inflight.has(tenant)) return;
  s.negative.add(tenant);
}

async function decide(db: Knex | Knex.Transaction, tenant: string, resolver: WriteAdmissionResolver, valid: () => boolean): Promise<WriteAdmissionDecision | null> {
  const s = state();
  let productCode: string | null | undefined;
  try {
    const row = await tenantDb(db, LOOKUP_TENANT)
      .unscoped<{ product_code: string | null }>('tenants', 'write admission product lookup')
      .where('tenant', tenant)
      .first('product_code');
    productCode = row?.product_code;
  } catch (error) {
    // Fail open and do not remember: a PSA tenant must never lose writes to a lookup fault.
    console.warn('[WriteAdmission] product lookup failed; admitting write', {
      tenant,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
  if (!valid()) return null;
  if (productCode !== CO_MANAGED_PRODUCT_CODE) {
    s.mustLookup.delete(tenant);
    s.negative.add(tenant);
    return null;
  }
  const key = resolver.cacheKey?.();
  const decision = await resolver(db, tenant);
  if (valid()) {
    s.mustLookup.delete(tenant);
    s.decisions.set(tenant, { until: Date.now() + WRITE_ADMISSION_TTL_MS, decision, key, resolver });
  }
  return decision;
}

/**
 * The tenant-write decision: throws the resolver's denial, or returns.
 * No resolver => allow without reading anything. Not transactional: it never
 * opens one, so the PSA fast path adds no BEGIN/COMMIT.
 */
export async function admitTenantWrite(
  db: Knex | Knex.Transaction,
  tenant: string,
  context: TenantWriteContext,
): Promise<void> {
  const resolver = globalThis.__algaWriteAdmissionResolver;
  const s = state();
  if (!resolver) {
    if (!s.warned.has(tenant)) {
      s.warned.add(tenant);
      console.warn('[WriteAdmission] no resolver registered; admitting write', { tenant, operation: context.operation });
    }
    return;
  }
  if (s.negative.has(tenant)) return;

  let decision: WriteAdmissionDecision | null | undefined;
  const cached = s.decisions.get(tenant);
  if (cached && cached.until > Date.now() && cached.resolver === resolver && cached.key === resolver.cacheKey?.()) {
    decision = cached.decision;
  } else {
    const revision = s.revision;
    const tenantRevision = s.tenantRevisions.get(tenant) ?? 0;
    const key = resolver.cacheKey?.();
    const valid = () => s.revision === revision && (s.tenantRevisions.get(tenant) ?? 0) === tenantRevision && globalThis.__algaWriteAdmissionResolver === resolver && resolver.cacheKey?.() === key;
    let pending = s.inflight.get(tenant);
    if (!pending || pending.key !== key || pending.revision !== revision || pending.tenantRevision !== tenantRevision || pending.resolver !== resolver) {
      const entry = { promise: undefined as unknown as Promise<WriteAdmissionDecision | null>, key, revision, tenantRevision, resolver };
      entry.promise = decide(db, tenant, resolver, valid).finally(() => {
        if (s.inflight.get(tenant) === entry) s.inflight.delete(tenant);
      });
      pending = entry;
      s.inflight.set(tenant, entry);
    }
    decision = await pending.promise;
    if (!valid()) return admitTenantWrite(db, tenant, context);
  }
  if (decision && !decision.canWrite) {
    throw decision.denial ?? new Error(`Writes are not admitted for this workspace (${context.operation})`);
  }
}

export async function admitWrite(trx: Knex.Transaction, context: WriteAdmissionContext): Promise<void> {
  const provider = globalThis.__algaWriteAdmissionProvider;
  if (!provider && !globalThis.__algaWriteAdmissionResolver) return; // before touching trx
  if (!trx?.isTransaction) throw new Error('Write admission requires an open transaction');
  if (globalThis.__algaWriteAdmissionResolver) {
    await admitTenantWrite(trx, context.tenant, { operation: context.operation, table: context.resource });
  }
  if (provider) await provider(trx, context);
}

/**
 * Explicit admission for a write that cannot go through a `tenantDb` builder (raw SQL, a
 * bare knex builder). Free for plain PSA tenants: no resolver or a known-negative tenant
 * returns before any read. Also the single implementation behind the `BaseService`
 * default guard and `insertParentScoped`.
 */
export async function admitOperationalWrite(
  db: Knex | Knex.Transaction,
  tenant: string,
  table: string,
  operation: string,
): Promise<void> {
  if (!isOperationalWriteTable(table) || !isTenantWriteGuarded(tenant)) return;
  await admitTenantWrite(db, tenant, { table, operation });
}
