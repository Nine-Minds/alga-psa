import type { WorkflowCatalogEventType } from '@alga-psa/event-schemas';
import type { EmitterCase } from './harness';

/**
 * Ticket references. The format is `alga` + digits, matching the project's ticket numbers
 * (`alga0002106`). A registry entry that is not `covered` MUST cite one.
 */
export type TicketRef = `alga${string}`;

export type CoveredEntry = {
  status: 'covered';
  cases: [EmitterCase, ...EmitterCase[]];
};

/**
 * The emitter exists but its payload does not (yet) pass the schema, or its builder has not
 * been extracted yet. Cases run under `it.fails`: fixing the drift turns the test red until the
 * entry is flipped to `covered`.
 */
export type KnownDriftEntry = {
  status: 'known-drift';
  ticket: TicketRef;
  reason: string;
  cases: [EmitterCase, ...EmitterCase[]];
};

/** The catalog advertises a trigger that no product code fires. */
export type NoProductEmitterEntry = {
  status: 'no-product-emitter';
  ticket: TicketRef;
  reason: string;
};

export type Entry = CoveredEntry | KnownDriftEntry | NoProductEmitterEntry;

export type EmitterContracts = { [K in WorkflowCatalogEventType]: Entry };

/** Tracking ticket for builder extraction that has not landed yet (this card). */
export const TRACKING_TICKET: TicketRef = 'alga0002106';

/**
 * Umbrella ticket for catalogued events that nothing fires. Each `no-product-emitter` entry cites it.
 * TODO(alga0002106): replace with the filed umbrella ticket number before merge.
 */
export const NO_EMITTER_UMBRELLA_TICKET: TicketRef = 'alga0002106';

export class EmitterNotMigratedError extends Error {
  constructor(eventType: string, domain: string) {
    super(`${eventType}: builder extraction for the "${domain}" domain has not landed yet`);
    this.name = 'EmitterNotMigratedError';
  }
}

/**
 * Placeholder for an entry whose domain has not been migrated to a builder yet. The single case
 * throws, so under `it.fails` the suite is green while the gap stays visible in the summary.
 */
export function pendingMigration(eventType: WorkflowCatalogEventType, domain: string): KnownDriftEntry {
  return {
    status: 'known-drift',
    ticket: TRACKING_TICKET,
    reason: `Builder extraction pending (${domain} domain).`,
    cases: [
      {
        site: `pending#${eventType}`,
        build: () => {
          throw new EmitterNotMigratedError(eventType, domain);
        },
      },
    ],
  };
}
