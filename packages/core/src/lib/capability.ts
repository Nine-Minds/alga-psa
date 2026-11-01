/**
 * @alga-psa/core/capability — release capability gate (pure entry).
 *
 * A capability is a product surface that rolls out behind a release flag AND a
 * durable per-tenant condition. This module is imported by workers
 * (jobs, subscribers, Temporal activities), so it must stay free of `next`,
 * `react` and `posthog-*`. Next-bound adapters live in `./capability/server`.
 *
 *   admits(tenant)  may START: forced, else (release flag AND eligibility).
 *   serves(tenant)  keeps SERVING existing state: forced, else participation.
 *
 * The release flag alone never admits anything, and `serves` has no flag term
 * at all, so a flag flip can never strand a workspace and a PostHog outage can
 * never close reads. A throwing flag checker or resolver fails that branch
 * closed; the error never escapes the gate (a 500 would reveal that a closed
 * capability exists).
 */

import { isFeatureFlagEnabled } from './features';
import logger from './logger-universal';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CapabilityKey = 'co-managed';
export type CapabilityMode = 'admits' | 'serves';

export type CapabilityReason =
  | 'open'
  | 'forced-on'
  | 'forced-off'
  | 'forced-malformed'
  | 'flag-off'
  | 'flag-unavailable'
  | 'not-eligible'
  | 'eligibility-error'
  | 'not-participating'
  | 'participation-error'
  | 'resolver-unregistered'
  /** The other half of a single-mode decision; call evaluateCapability for both. */
  | 'not-evaluated';

export interface CapabilityDecision {
  capability: CapabilityKey;
  /** admits(): may start (provision, purchase, entry points). */
  admitted: boolean;
  /** serves(): keep serving existing state (reads, workers, inbound). */
  served: boolean;
  forced: 'on' | 'off' | null;
  reasons: { admitted: CapabilityReason; served: CapabilityReason };
}

export type EligibilityResolver = (ctx: { tenantId: string }) => Promise<boolean>;
export type ParticipationResolver = (ctx: {
  tenantIds: readonly string[];
}) => Promise<ReadonlySet<string> | readonly string[]>;

export interface CapabilityGateDefinition {
  capability: CapabilityKey;
  /** The rollout flag. Evaluated tenant-only; never a user context. */
  featureFlag: string;
  /** Absent = nobody is eligible (L1a registers the durable-entitlement read). */
  eligibility?: EligibilityResolver;
  /** Absent = nobody participates (L1a registers the relationship read). */
  participation?: ParticipationResolver;
}

export class UnknownCapabilityError extends Error {
  constructor(capability: string) {
    super(`Unknown capability: ${capability}`);
    this.name = 'UnknownCapabilityError';
  }
}

/** Returned by Temporal activities whose capability is closed (adapter 6). */
export interface CapabilitySkip {
  skipped: true;
  capability: CapabilityKey;
}

// ---------------------------------------------------------------------------
// FORCE_CAPABILITIES grammar — one parser shared by server and client
// ---------------------------------------------------------------------------

export type ForcedState = 'on' | 'off' | 'malformed' | null;

export interface ParsedForcedCapabilities {
  values: Record<string, boolean>;
  /** Keys that were configured but with an unusable value. They force off. */
  malformed: string[];
}

const FORCE_KEY_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Grammar: `key:on|off[,key:on|off]*`. Keys are lower-cased (a shouted
 * kill-switch key must still bite), values are case-insensitive, whitespace is
 * trimmed, empty entries are ignored. Entries whose key is not a valid key are
 * ignored. A valid key with a missing or unrecognised value is malformed.
 */
export function parseForcedCapabilities(raw: string | null | undefined): ParsedForcedCapabilities {
  const values: Record<string, boolean> = {};
  const malformed = new Set<string>();
  if (typeof raw !== 'string') return { values, malformed: [] };

  for (const part of raw.split(',')) {
    const entry = part.trim();
    if (entry.length === 0) continue;
    const idx = entry.indexOf(':');
    const key = (idx === -1 ? entry : entry.slice(0, idx)).trim().toLowerCase();
    if (!FORCE_KEY_PATTERN.test(key)) continue;
    const value = idx === -1 ? '' : entry.slice(idx + 1).trim().toLowerCase();
    if (value === 'on') values[key] = true;
    else if (value === 'off') values[key] = false;
    else malformed.add(key);
  }
  return { values, malformed: [...malformed] };
}

/** Forced state for one capability. `malformed` must be treated as off. */
export function forcedValue(raw: string | null | undefined, capability: string): ForcedState {
  const parsed = parseForcedCapabilities(raw);
  const key = capability.toLowerCase();
  if (parsed.malformed.includes(key)) return 'malformed';
  if (!Object.prototype.hasOwnProperty.call(parsed.values, key)) return null;
  return parsed.values[key] ? 'on' : 'off';
}

export function forceFingerprint(state: ForcedState): string {
  return state === null ? '-' : `f:${state}`;
}

function serverForceRaw(): string | undefined {
  return typeof process !== 'undefined' ? process.env.FORCE_CAPABILITIES : undefined;
}

// ---------------------------------------------------------------------------
// Client-side resolution (no server round trip; shared so parity is testable)
// ---------------------------------------------------------------------------

export const capabilityServedBootstrapKey = (capability: CapabilityKey): string =>
  `capability:${capability}`;
export const capabilityAdmitBootstrapKey = (capability: CapabilityKey): string =>
  `capability:${capability}:admit`;

export interface ClientCapabilityState {
  enabled: boolean;
  admitted: boolean;
  /** False when neither the bootstrap nor a usable force answered. */
  resolved: boolean;
  forced: 'on' | 'off' | null;
}

/**
 * The browser's view of a capability. The server bootstrap always wins; the
 * build-time `NEXT_PUBLIC_FORCE_CAPABILITIES` is only a fallback for a missing
 * key (self-host/dev/CI) and is ignored in production builds, where an inlined
 * variable cannot be a kill switch. Missing everything fails closed.
 */
export function resolveClientCapability(input: {
  capability: CapabilityKey;
  bootstrap: Readonly<Record<string, boolean | string>>;
  publicForceRaw?: string | null;
  production?: boolean;
}): ClientCapabilityState {
  const { capability, bootstrap } = input;
  const has = (key: string) => Object.prototype.hasOwnProperty.call(bootstrap, key);
  const servedKey = capabilityServedBootstrapKey(capability);
  const admitKey = capabilityAdmitBootstrapKey(capability);

  if (has(servedKey) || has(admitKey)) {
    const servedValue = has(servedKey) ? bootstrap[servedKey] === true : false;
    const admitValue = has(admitKey) ? bootstrap[admitKey] === true : false;
    return { enabled: servedValue, admitted: admitValue, resolved: true, forced: null };
  }

  const raw = input.publicForceRaw;
  if (typeof raw === 'string' && raw.trim().length > 0) {
    if (input.production) {
      logger.warn(
        '[capability] NEXT_PUBLIC_FORCE_CAPABILITIES is inlined at build time and is ignored in production builds; use FORCE_CAPABILITIES on the server.',
      );
    } else {
      const state = forcedValue(raw, capability);
      if (state !== null) {
        const on = state === 'on';
        return { enabled: on, admitted: on, resolved: true, forced: on ? 'on' : 'off' };
      }
    }
  }
  return { enabled: false, admitted: false, resolved: false, forced: null };
}

// ---------------------------------------------------------------------------
// Registry + cache (on globalThis: Next bundles this module more than once)
// ---------------------------------------------------------------------------

interface CacheEntry {
  expiresAt: number;
  decision: CapabilityDecision;
}

interface CapabilityRegistry {
  gates: Map<CapabilityKey, CapabilityGateDefinition>;
  cache: Map<string, CacheEntry>;
}

const REGISTRY_KEY = Symbol.for('alga.core.capabilityRegistry');
type RegistryHost = typeof globalThis & { [REGISTRY_KEY]?: CapabilityRegistry };

function registry(): CapabilityRegistry {
  const host = globalThis as RegistryHost;
  if (!host[REGISTRY_KEY]) {
    const gates = new Map<CapabilityKey, CapabilityGateDefinition>();
    gates.set('co-managed', { capability: 'co-managed', featureFlag: 'release-v2-0-feature' });
    host[REGISTRY_KEY] = { gates, cache: new Map() };
  }
  return host[REGISTRY_KEY]!;
}

function gateFor(capability: CapabilityKey): CapabilityGateDefinition {
  const gate = registry().gates.get(capability);
  if (!gate) throw new UnknownCapabilityError(String(capability));
  return gate;
}

/**
 * Define or update a gate. Merges into the existing definition: a field the
 * caller leaves out (or passes as `undefined`) keeps its registered value, so
 * re-declaring the gate (e.g. a second module load, or changing the flag) never
 * silently drops eligibility/participation resolvers another module registered.
 * Removing a resolver is explicit: `registerCapabilityEligibility(key, null)`.
 */
export function registerCapabilityGate(
  def: Pick<CapabilityGateDefinition, 'capability'> & Partial<CapabilityGateDefinition>,
): void {
  const existing = registry().gates.get(def.capability);
  const defined = Object.fromEntries(
    Object.entries(def).filter(([, value]) => value !== undefined),
  ) as Partial<CapabilityGateDefinition>;
  const merged = { ...existing, ...defined } as CapabilityGateDefinition;
  if (typeof merged.featureFlag !== 'string' || merged.featureFlag.length === 0) {
    throw new Error(`registerCapabilityGate: capability '${def.capability}' has no featureFlag`);
  }
  registry().gates.set(def.capability, merged);
  invalidateCapability(def.capability);
}

export function registerCapabilityEligibility(
  capability: CapabilityKey,
  resolver: EligibilityResolver | null,
): void {
  const gate = gateFor(capability);
  gate.eligibility = resolver ?? undefined;
  invalidateCapability(capability);
}

export function registerCapabilityParticipation(
  capability: CapabilityKey,
  resolver: ParticipationResolver | null,
): void {
  const gate = gateFor(capability);
  gate.participation = resolver ?? undefined;
  invalidateCapability(capability);
}

/** The rollout flag that guards a capability (for bootstrap and the probe). */
export function capabilityFeatureFlag(capability: CapabilityKey): string {
  return gateFor(capability).featureFlag;
}

export function capabilityResolverStatus(capability: CapabilityKey): {
  eligibility: 'registered' | 'unregistered';
  participation: 'registered' | 'unregistered';
} {
  const gate = gateFor(capability);
  return {
    eligibility: gate.eligibility ? 'registered' : 'unregistered',
    participation: gate.participation ? 'registered' : 'unregistered',
  };
}

/** Drop cached decisions for a capability, optionally for one tenant only. */
export function invalidateCapability(capability: CapabilityKey, tenantId?: string): void {
  const { cache } = registry();
  for (const key of [...cache.keys()]) {
    const [cap, , tenant] = key.split('|');
    if (cap === capability && (tenantId === undefined || tenant === tenantId)) cache.delete(key);
  }
}

// Test-only hatches (clear the cache, reset the registry) live in
// `src/capability/testing.ts`, which production code may not import (enforced
// by the capability entry-point contract) and which is not a package export.

const DEFAULT_TTL_MS = 30_000;
const MAX_TTL_MS = 300_000;

function cacheTtlMs(): number {
  const raw = typeof process !== 'undefined' ? process.env.CAPABILITY_CACHE_TTL_MS : undefined;
  const parsed = raw === undefined || raw === '' ? DEFAULT_TTL_MS : Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_TTL_MS;
  return Math.min(MAX_TTL_MS, Math.max(0, parsed));
}

function cacheKey(
  capability: CapabilityKey,
  mode: CapabilityMode,
  tenantId: string,
  forced: ForcedState,
): string {
  return `${capability}|${mode}|${tenantId}|${forceFingerprint(forced)}`;
}

function readCache(key: string): CapabilityDecision | null {
  const { cache } = registry();
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() >= hit.expiresAt) {
    cache.delete(key);
    return null;
  }
  return hit.decision;
}

function writeCache(key: string, decision: CapabilityDecision): void {
  const ttl = cacheTtlMs();
  if (ttl <= 0) return;
  registry().cache.set(key, { expiresAt: Date.now() + ttl, decision });
}

function warnDowngrade(
  capability: CapabilityKey,
  tenantId: string,
  mode: CapabilityMode,
  resolver: string,
  error: unknown,
): void {
  // Never log the resolved value, only that a branch failed closed.
  logger.warn('capability_decision_failed', {
    event: 'capability_decision_failed',
    capability,
    tenantId,
    mode,
    resolver,
    error: error instanceof Error ? error.message : String(error),
  });
}

function decision(
  capability: CapabilityKey,
  mode: CapabilityMode,
  forced: 'on' | 'off' | null,
  value: boolean,
  reason: CapabilityReason,
): CapabilityDecision {
  const other: CapabilityReason = 'not-evaluated';
  return mode === 'admits'
    ? { capability, admitted: value, served: false, forced, reasons: { admitted: reason, served: other } }
    : { capability, admitted: false, served: value, forced, reasons: { admitted: other, served: reason } };
}

function forcedDecision(
  capability: CapabilityKey,
  mode: CapabilityMode,
  state: Exclude<ForcedState, null>,
): CapabilityDecision {
  const on = state === 'on';
  const reason: CapabilityReason = on ? 'forced-on' : state === 'off' ? 'forced-off' : 'forced-malformed';
  if (state === 'malformed') {
    logger.warn('capability_force_malformed', {
      event: 'capability_force_malformed',
      capability,
      note: 'FORCE_CAPABILITIES value for this key is not on|off; forcing off.',
    });
  }
  return decision(capability, mode, on ? 'on' : 'off', on, reason);
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

/**
 * May this tenant START using the capability?
 * forced, else (release flag AND eligibility). The flag is evaluated with
 * `{ tenantId }` only, so PostHog's distinctId is `tenant_<id>` and every user
 * of a tenant gets the same answer.
 */
export async function admits(capability: CapabilityKey, tenantId: string): Promise<CapabilityDecision> {
  const gate = gateFor(capability);
  const state = forcedValue(serverForceRaw(), capability);
  if (state !== null) return forcedDecision(capability, 'admits', state);

  const key = cacheKey(capability, 'admits', tenantId, state);
  const cached = readCache(key);
  if (cached) return cached;

  const result = await computeAdmits(gate, tenantId);
  writeCache(key, result);
  return result;
}

async function computeAdmits(gate: CapabilityGateDefinition, tenantId: string): Promise<CapabilityDecision> {
  const { capability } = gate;
  // No eligibility resolver: nobody can be admitted, so do not even ask PostHog.
  if (!gate.eligibility) return decision(capability, 'admits', null, false, 'resolver-unregistered');

  let flagOn: boolean;
  try {
    flagOn = await isFeatureFlagEnabled(gate.featureFlag, { tenantId });
  } catch (error) {
    warnDowngrade(capability, tenantId, 'admits', 'featureFlag', error);
    return decision(capability, 'admits', null, false, 'flag-unavailable');
  }
  if (!flagOn) return decision(capability, 'admits', null, false, 'flag-off');

  try {
    const eligible = await gate.eligibility({ tenantId });
    return eligible === true
      ? decision(capability, 'admits', null, true, 'open')
      : decision(capability, 'admits', null, false, 'not-eligible');
  } catch (error) {
    warnDowngrade(capability, tenantId, 'admits', 'eligibility', error);
    return decision(capability, 'admits', null, false, 'eligibility-error');
  }
}

/**
 * Should existing state keep being served for this tenant?
 * forced, else participation. Deliberately has no reference to the flag
 * evaluator: workers and reads must never depend on PostHog.
 */
export async function serves(capability: CapabilityKey, tenantId: string): Promise<CapabilityDecision> {
  const [only] = await servesBatch(capability, [tenantId]);
  return only;
}

async function servesBatch(
  capability: CapabilityKey,
  tenantIds: readonly string[],
): Promise<CapabilityDecision[]> {
  const gate = gateFor(capability);
  const state = forcedValue(serverForceRaw(), capability);
  if (state !== null) return tenantIds.map(() => forcedDecision(capability, 'serves', state));

  const results = new Map<string, CapabilityDecision>();
  const misses: string[] = [];
  for (const tenantId of new Set(tenantIds)) {
    const hit = readCache(cacheKey(capability, 'serves', tenantId, state));
    if (hit) results.set(tenantId, hit);
    else misses.push(tenantId);
  }

  if (misses.length > 0) {
    if (!gate.participation) {
      for (const t of misses) results.set(t, decision(capability, 'serves', null, false, 'resolver-unregistered'));
    } else {
      let participating: Set<string> | null = null;
      try {
        const returned = await gate.participation({ tenantIds: misses });
        // Defensive intersect: a resolver can never serve a tenant it was not asked about.
        participating = new Set([...returned].filter((id) => misses.includes(id)));
      } catch (error) {
        for (const t of misses) warnDowngrade(capability, t, 'serves', 'participation', error);
      }
      for (const t of misses) {
        const d = participating === null
          ? decision(capability, 'serves', null, false, 'participation-error')
          : participating.has(t)
            ? decision(capability, 'serves', null, true, 'open')
            : decision(capability, 'serves', null, false, 'not-participating');
        results.set(t, d);
      }
    }
    for (const t of misses) writeCache(cacheKey(capability, 'serves', t, state), results.get(t)!);
  }

  return tenantIds.map((t) => results.get(t)!);
}

/**
 * Batch form of `serves`: the subset of `tenantIds` that are served, input
 * order preserved, duplicates removed. One participation call for the misses.
 */
export async function filterServed(
  capability: CapabilityKey,
  tenantIds: readonly string[],
): Promise<string[]> {
  const unique = [...new Set(tenantIds)];
  const decisions = await servesBatch(capability, unique);
  return unique.filter((_, i) => decisions[i].served);
}

/** Both halves, for the probe and the root-layout bootstrap. */
export async function evaluateCapability(
  capability: CapabilityKey,
  tenantId: string,
): Promise<CapabilityDecision> {
  const [a, s] = await Promise.all([admits(capability, tenantId), serves(capability, tenantId)]);
  return {
    capability,
    admitted: a.admitted,
    served: s.served,
    forced: a.forced ?? s.forced,
    reasons: { admitted: a.reasons.admitted, served: s.reasons.served },
  };
}

// ---------------------------------------------------------------------------
// Worker-safe guards (adapters 5 and 6)
// ---------------------------------------------------------------------------

/** Subscriber/inbound adapter: enter the co-managed branch only when true. */
export async function isCapabilityServed(capability: CapabilityKey, tenantId: string): Promise<boolean> {
  return (await serves(capability, tenantId)).served;
}

/** Batch form; the only shape permitted in fanout/inbound fleet code. */
export function filterCapabilityServed(
  capability: CapabilityKey,
  tenantIds: readonly string[],
): Promise<string[]> {
  return filterServed(capability, tenantIds);
}

/**
 * Temporal adapter: `null` = proceed, otherwise return the sentinel from the
 * activity without touching the DB. A returned sentinel (not a throw) keeps the
 * workflow alive; the activity's return union must include `CapabilitySkip`.
 */
export async function activityServesCapability(
  capability: CapabilityKey,
  tenantId: string,
): Promise<CapabilitySkip | null> {
  return (await serves(capability, tenantId)).served ? null : { skipped: true, capability };
}
