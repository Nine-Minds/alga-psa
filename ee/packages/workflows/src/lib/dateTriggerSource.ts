import type { Knex } from 'knex';
import type { WorkflowCatalogEventType, DateTriggerSourceId } from '@alga-psa/event-schemas';

// The list of sources (ids, payload schema refs, mode, domain events) is
// packages/event-schemas/src/schemas/domain/dateTriggerSourceDefinitions.ts. A DateTriggerSource here
// is only the query half: packages/jobs supplies `findOccurrences` for each definition id.
export type { DateTriggerSourceId };

export interface DateOccurrence {
  entityId: string;
  clientId: string;
  occursOn: string;
  /**
   * What makes this occurrence distinct from an earlier one for the same entity and date. For
   * condition sources it is part of the trigger fire key (e.g. the full timestamp a ticket entered
   * its status, so re-entering the same status on the same day is a new entry).
   */
  cycleKey: string;
  payload: Record<string, unknown>;
}

/**
 * Type-erased domain-event emitter stored on a source. The event type and its branded payload are only
 * correlated inside jobs' `defineDateDomainEvent` (packages/jobs/src/lib/dateTriggers/defineDateDomainEvent.ts),
 * so emission is a closure rather than a (eventType, payload) pair the scanner would have to re-correlate.
 * `eventType` and `windowDays` must equal the source definition's `domainEvent` (registry.test.ts checks).
 */
export interface DateDomainEvent {
  eventType: WorkflowCatalogEventType;
  windowDays: number;
  emitOnce(knex: Knex, tenant: string, occurrence: DateOccurrence, daysUntil: number): Promise<boolean>;
}

/** What a source needs beyond a date window. Always passed for `mode: 'condition'` sources. */
export interface DateTriggerScanContext {
  /** The workflow trigger's `params`, validated by the launcher. */
  params?: Record<string, unknown>;
  /** The workflow's tenant-local calendar date (YYYY-MM-DD). */
  today: string;
  /** IANA timezone `today` was computed in. */
  timezone: string;
}

export interface DateTriggerSource {
  id: DateTriggerSourceId;
  /** Present exactly for sources whose definition declares a `domainEvent`. */
  domainEvent?: DateDomainEvent;
  /**
   * `window` sources: occurrences whose date lies in `fromDate..toDate`.
   * `condition` sources: the occurrences that hold as of `context.today` (`fromDate` and `toDate`
   * are both today and are ignored); the launcher relies on the fire key for dedup.
   */
  findOccurrences(db: Knex, tenant: string, fromDate: string, toDate: string, context?: DateTriggerScanContext): Promise<DateOccurrence[]>;
}

export type DateSourceScanOptions = { db: Knex; tenant: string; fromDate: string; toDate: string };
