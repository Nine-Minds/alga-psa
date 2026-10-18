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
  /**
   * Individual emit paths of an otherwise-covered event that are known to drift. The test asserts
   * the harness rejects them: fixing the drift turns the test red until the case moves into `cases`.
   */
  knownDriftCases?: Array<{ ticket: TicketRef; reason: string; case: EmitterCase }>;
};

/**
 * The emitter exists but its payload does not (yet) pass the schema, or its builder has not
 * been extracted yet. The test asserts the harness rejects each case: fixing the drift turns the
 * test red until the entry is flipped to `covered`.
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
  /**
   * A registered builder can exist before any product code calls it. Exercising it here keeps the
   * builder honest (and visible to the emit-site guard's registered-builder check) until an emitter
   * lands and this entry becomes `covered`.
   */
  builderProbe?: EmitterCase;
};

export type Entry = CoveredEntry | KnownDriftEntry | NoProductEmitterEntry;

export type EmitterContracts = { [K in WorkflowCatalogEventType]: Entry };

/**
 * Umbrella ticket for catalogued events that nothing fires. Each `no-product-emitter` entry cites it.
 * Filed in the Alga PSA board: "Workflow catalog: 14 catalogued trigger events have no product emitter".
 */
export const NO_EMITTER_UMBRELLA_TICKET: TicketRef = 'alga-2026-0002674';
