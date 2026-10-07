import type { Knex } from 'knex';
import type { DateTriggerSourceId } from '../../../../../shared/workflow/runtime/dateTriggerSourceDefinitions';

// The list of sources (ids, payload schema refs, mode, domain events) is shared/workflow/runtime/
// dateTriggerSourceDefinitions.ts. A DateTriggerSource here is only the query half: packages/jobs
// supplies `findOccurrences` for each definition id.
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
  /**
   * `window` sources: occurrences whose date lies in `fromDate..toDate`.
   * `condition` sources: the occurrences that hold as of `context.today` (`fromDate` and `toDate`
   * are both today and are ignored); the launcher relies on the fire key for dedup.
   */
  findOccurrences(db: Knex, tenant: string, fromDate: string, toDate: string, context?: DateTriggerScanContext): Promise<DateOccurrence[]>;
  /** Builds the upcoming-date domain event for sources whose definition declares a `domainEvent`. */
  buildDomainEventPayload?(occurrence: DateOccurrence, daysUntil: number): Record<string, unknown>;
}

export type DateSourceScanOptions = { db: Knex; tenant: string; fromDate: string; toDate: string };
