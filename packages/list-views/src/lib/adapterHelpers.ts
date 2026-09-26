import type {
  ListViewDroppedReference,
  ListViewSettings,
} from '@alga-psa/types';

/**
 * Small, list-agnostic pieces every ListViewAdapter needs, so each list's
 * adapter is only the translation between its own live state and the envelope.
 */

/** JSON with object keys sorted at every depth — equal documents compare equal. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, sortKeysDeep((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/**
 * `differs` expressed through `capture` and `apply`: the live state differs
 * from a view when capturing it gives a different document than capturing the
 * state the view would produce. Comparing captured projections means anything
 * a view does not store (search text, current page) can never make it dirty.
 */
export function differsByCapture<TLive, F>(
  capture: (live: TLive) => ListViewSettings<F>,
  apply: (settings: ListViewSettings<F> | null, live: TLive) => TLive,
  live: TLive,
  settings: ListViewSettings<F> | null,
): boolean {
  return stableStringify(capture(live)) !== stableStringify(capture(apply(settings, live)));
}

/**
 * Drop keys whose value states no constraint: undefined, null, '' and [].
 * `falseIsNoOp` names boolean filters whose `false` means "no constraint".
 */
export function compactFilters<F extends object>(
  filters: F,
  options: { exclude?: readonly string[]; falseIsNoOp?: readonly string[] } = {},
): Partial<F> {
  const exclude = new Set(options.exclude ?? []);
  const falseIsNoOp = new Set(options.falseIsNoOp ?? []);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filters as Record<string, unknown>)) {
    if (exclude.has(key)) continue;
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (value === false && falseIsNoOp.has(key)) continue;
    out[key] = value;
  }
  return out as Partial<F>;
}

/**
 * Collects references a view held that no longer resolve.
 *
 * `known` of `undefined` means "cannot validate" (the universe is not loaded),
 * which must keep the value, never drop it.
 */
export class DroppedReferenceCollector {
  private readonly counts = new Map<string, number>();

  /** Keeps the ids present in `known` (and any `sentinels`); records the rest as dropped. */
  keepList(
    field: string,
    values: readonly string[] | undefined,
    known: ReadonlySet<string> | undefined,
    sentinels: readonly string[] = [],
  ): string[] | undefined {
    if (!values) return undefined;
    if (!known) return [...values];
    const kept = values.filter((value) => sentinels.includes(value) || known.has(value));
    this.record(field, values.length - kept.length);
    return kept.length > 0 ? kept : undefined;
  }

  keepScalar(
    field: string,
    value: string | undefined,
    known: ReadonlySet<string> | undefined,
    sentinels: readonly string[] = [],
  ): string | undefined {
    if (value === undefined) return undefined;
    if (!known || sentinels.includes(value) || known.has(value)) return value;
    this.record(field, 1);
    return undefined;
  }

  private record(field: string, count: number) {
    if (count > 0) this.counts.set(field, (this.counts.get(field) ?? 0) + count);
  }

  get dropped(): ListViewDroppedReference[] {
    return Array.from(this.counts, ([field, count]) => ({ field, count }));
  }
}

/** Remove keys set to undefined, so a sanitized document compares like a captured one. */
export function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([, entry]) => entry !== undefined),
  ) as T;
}
