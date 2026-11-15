import type { UiSlotSurface } from '@alga-psa/types';
import type { CapabilityKey } from '@alga-psa/core/capability';

/**
 * Pure-data registry of capability-gated UI contributions. No JSX and no
 * context, so a server component can compute the list and pass it down.
 * A contribution is mounted only when its capability is served.
 */
export interface UiSlotContribution<T = unknown> {
  id: string;
  capability: CapabilityKey;
  order: number;
  props?: T;
}

const slots = new Map<UiSlotSurface, Map<string, UiSlotContribution>>();

/** Returns an unregister function. Re-registering an id replaces it. */
export function registerUiSlot<T = unknown>(
  surface: UiSlotSurface,
  contribution: UiSlotContribution<T>,
): () => void {
  const bucket = slots.get(surface) ?? new Map<string, UiSlotContribution>();
  bucket.set(contribution.id, contribution as UiSlotContribution);
  slots.set(surface, bucket);
  return () => {
    bucket.delete(contribution.id);
  };
}

export function resolveUiSlots<T = unknown>(
  surface: UiSlotSurface,
  served: ReadonlySet<CapabilityKey>,
): UiSlotContribution<T>[] {
  const bucket = slots.get(surface);
  if (!bucket) return [];
  return [...bucket.values()]
    .filter((c) => served.has(c.capability))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)) as UiSlotContribution<T>[];
}

/** Tests only. */
export function clearUiSlots(): void {
  slots.clear();
}
