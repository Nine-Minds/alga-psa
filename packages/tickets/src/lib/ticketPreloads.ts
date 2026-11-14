/**
 * Capability-gated server preloads.
 *
 * A page that gathers data for the ticket screen declares each read as an entry naming the capability that
 * backs it. `runGatedPreloads` starts the entries whose capability is on and never calls the loader of an
 * entry whose capability is off: that read is not made, which hiding the section in the UI does not
 * guarantee. A skipped entry resolves to its `skipped` value, so consumers keep one shape.
 * Adding a gated section means adding one entry.
 */
import type { TicketCapabilities, TicketCapabilityKey } from './ticketDataSource';

export interface GatedPreload<T> {
  /** The capability that backs this read; `null` for a read that no capability gates. */
  capability: TicketCapabilityKey | null;
  /** Starts the read. Called at most once, and only when the capability is on. */
  load: () => Promise<T>;
  /** What the entry resolves to when its capability is off. */
  skipped: T;
}

export type GatedPreloadTable = Record<string, GatedPreload<any>>;

export type GatedPreloadResults<Table extends GatedPreloadTable> = {
  [K in keyof Table]: Table[K] extends GatedPreload<infer T> ? Promise<T> : never;
};

export function runGatedPreloads<Table extends GatedPreloadTable>(
  capabilities: Pick<TicketCapabilities, TicketCapabilityKey>,
  table: Table,
): GatedPreloadResults<Table> {
  const results: Record<string, Promise<unknown>> = {};
  for (const [key, entry] of Object.entries(table)) {
    const enabled = entry.capability === null || capabilities[entry.capability] === true;
    results[key] = enabled ? entry.load() : Promise.resolve(entry.skipped);
  }
  return results as GatedPreloadResults<Table>;
}

/** Declares one entry; the explicit type parameter keeps `load` and `skipped` on one type. */
export function gatedPreload<T>(capability: TicketCapabilityKey | null, load: () => Promise<T>, skipped: T): GatedPreload<T> {
  return { capability, load, skipped };
}
