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

const registry = new Map<TimeSourceKind, Registration>();

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
