import type { Knex } from 'knex';
import type { BuiltWorkflowPayload, WorkflowCatalogEventType } from '@alga-psa/event-schemas';

// LEVERAGE: pattern date-trigger-source-list — derive from the shared source definitions; see
// packages/event-schemas/src/schemas/domain/dateTriggerPayloadSchemas.ts.
export type DateTriggerSourceId = 'client.anniversary' | 'contract.renewal_decision' | 'contract.end' | 'asset.warranty_end';

export interface DateOccurrence {
  entityId: string;
  clientId: string;
  occursOn: string;
  cycleKey: string;
  payload: Record<string, unknown>;
}

/** What a date source declares for one catalogued domain event; `buildPayload` must return that event's branded builder result. */
export interface DateDomainEventFor<T extends WorkflowCatalogEventType> {
  eventType: T;
  windowDays: number;
  buildPayload(occurrence: DateOccurrence, daysUntil: number): BuiltWorkflowPayload<T>;
}

/**
 * Type-erased form stored on a source. The event type and its branded payload are only correlated
 * inside jobs' `defineDateDomainEvent` (packages/jobs/src/lib/dateTriggers/defineDateDomainEvent.ts), so emission is a closure rather than a (eventType, payload) pair
 * the scanner would have to re-correlate.
 */
export interface DateDomainEvent {
  eventType: WorkflowCatalogEventType;
  windowDays: number;
  emitOnce(knex: Knex, tenant: string, occurrence: DateOccurrence, daysUntil: number): Promise<boolean>;
}

export interface DateTriggerSource {
  id: DateTriggerSourceId;
  payloadSchemaRef: string;
  domainEvent?: DateDomainEvent;
  // A source that takes parameters, such as a custom date field, needs `params` here and in the fire key.
  findOccurrences(db: Knex, tenant: string, fromDate: string, toDate: string): Promise<DateOccurrence[]>;
}

export type DateSourceScanOptions = { db: Knex; tenant: string; fromDate: string; toDate: string };
