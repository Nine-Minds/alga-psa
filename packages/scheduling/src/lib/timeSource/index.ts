/**
 * Time-source registry.
 *
 * `registerTimeSource(kind, factory, selector)` adds a non-native source.
 * `resolveTimeSource(ctx)` returns the source that owns the time in `ctx`, or
 * the native singleton.
 *
 * THE DISCRIMINATOR NEVER QUERIES. It reads, in order:
 *   1. whether anything is registered at all (nothing registered => native,
 *      synchronously, before any other work);
 *   2. explicit markers already on the row / work item in `ctx`;
 *   3. L0a's cached `serves(capability, tenant)` verdict, only for a source
 *      that declared `servesCapability`.
 * The native fast path therefore costs 0 statements and 0 capability reads.
 *
 * AUTHORIZATION: hooks run before the native permission checks, so a source
 * answering `handled: true` owns authorization for that call (see the
 * contract on `TimeSource`).
 *
 * REGISTRY IDENTITY: the registry lives on `globalThis` (not in module scope)
 * because Next bundles this module more than once. Registration therefore must
 * not depend on module identity: providers are keyed by `kind`, and resolution
 * compares `source.kind`, never object identity against `nativeTimeSource` or a
 * factory reference. A duplicate `kind` still throws (see `registerTimeSource`).
 *
 * `delegateToTimeSource(ctx, call)` is what call sites use. It returns
 * `{ handled: false }` without invoking anything when the resolved source is
 * native, so the call site then runs today's body verbatim.
 */
import type {
  TimeSource,
  TimeSourceFactory,
  TimeSourceContext,
  TimeSourceKind,
  TimeSourceResult,
  TimeSourceSelector,
} from './timeSource';
import { nativeTimeSource } from './nativeTimeSource';

export type * from './timeSource';
export { nativeTimeSource } from './nativeTimeSource';

interface Registration {
  kind: TimeSourceKind;
  factory: TimeSourceFactory;
  selector: TimeSourceSelector;
  instance?: TimeSource;
}

// One registry per process. It lives on globalThis because Next bundles this module
// more than once; a module-level Map would give each bundle its own copy.
const REGISTRY_KEY = Symbol.for('alga.timeSource.registry');
type RegistryHost = typeof globalThis & { [REGISTRY_KEY]?: Map<TimeSourceKind, Registration> };

const registry: Map<TimeSourceKind, Registration> = ((globalThis as RegistryHost)[REGISTRY_KEY] ??= new Map());

export function registerTimeSource(
  kind: TimeSourceKind,
  factory: TimeSourceFactory,
  selector: TimeSourceSelector = {},
): void {
  if (kind === 'native') {
    throw new Error("Time source kind 'native' is built in and cannot be registered");
  }
  if (registry.has(kind)) {
    throw new Error(`A time source is already registered for kind '${kind}'`);
  }
  registry.set(kind, { kind, factory, selector });
}

/** Test seam: forget every registration. Not for production code. */
export function resetTimeSourcesForTests(): void {
  registry.clear();
}

export function hasRegisteredTimeSources(): boolean {
  return registry.size > 0;
}

function instanceOf(reg: Registration): TimeSource {
  reg.instance ??= reg.factory();
  return reg.instance;
}

function matchesMarkers(selector: TimeSourceSelector, ctx: TimeSourceContext): boolean {
  if (ctx.workItemType && selector.workItemTypes?.includes(ctx.workItemType)) return true;
  if (ctx.rowMarker && selector.rowMarkers?.includes(ctx.rowMarker)) return true;
  if (ctx.workItemId && selector.workItemIdPrefixes?.some((p) => ctx.workItemId!.startsWith(p))) return true;
  return false;
}

async function servesTenant(capability: 'co-managed', tenant: string): Promise<boolean> {
  // Lazy: nothing imports the capability gate unless a source asked for it.
  const { serves } = await import('@alga-psa/core/capability');
  return (await serves(capability, tenant)).served;
}

export async function resolveTimeSource(ctx: TimeSourceContext): Promise<TimeSource> {
  if (registry.size === 0) return nativeTimeSource;

  for (const reg of registry.values()) {
    if (matchesMarkers(reg.selector, ctx)) return instanceOf(reg);
  }
  for (const reg of registry.values()) {
    const capability = reg.selector.servesCapability;
    if (capability && ctx.tenant && (await servesTenant(capability, ctx.tenant))) {
      return instanceOf(reg);
    }
  }
  return nativeTimeSource;
}

/**
 * Ask the owning non-native source to handle a call. Returns `{ handled: false }`
 * (never calling `call`) when the time is native, so the caller falls through to
 * its own native body. A non-native source may itself answer `{ handled: false }`.
 */
// A `handled: true` answer owns authorization for the call: native hasPermission has NOT run.
export async function delegateToTimeSource<R extends { handled: boolean }>(
  ctx: TimeSourceContext,
  call: (source: TimeSource, ctx: TimeSourceContext) => Promise<R> | R,
): Promise<R | { handled: false }> {
  if (registry.size === 0) return { handled: false };
  const source = await resolveTimeSource(ctx);
  if (source.kind === 'native') return { handled: false };
  return call(source, ctx);
}

/**
 * REST-service flavour of `delegateToTimeSource`: looks the method up by name on
 * the resolved source's `rest.<surface>`. Native (or an omitted method) is a miss.
 */
// A `handled: true` answer owns authorization for the call: native hasPermission has NOT run.
export async function delegateRest(
  ctx: TimeSourceContext,
  surface: 'entries' | 'sheets',
  method: string,
  args: readonly unknown[],
): Promise<TimeSourceResult<{ value: any }>> {
  if (registry.size === 0) return { handled: false };
  const source = await resolveTimeSource(ctx);
  if (source.kind === 'native') return { handled: false };
  const fn = source.rest?.[surface]?.[method];
  if (!fn) return { handled: false };
  return fn(ctx, ...args);
}

export type { TimeSourceResult };
