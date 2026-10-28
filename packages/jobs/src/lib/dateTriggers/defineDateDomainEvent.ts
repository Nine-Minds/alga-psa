import type { BuiltWorkflowPayload, WorkflowCatalogEventType } from '@alga-psa/event-schemas';
import { emitDateDomainEventOnce } from '@alga-psa/event-bus/workflow/dateDomainEvents';
import type { DateOccurrence, DateTriggerSource } from './types';

type DateDomainEvent = NonNullable<DateTriggerSource['domainEvent']>;

/** What a date source declares for one catalogued domain event; `buildPayload` must return that event's branded builder result. */
export interface DateDomainEventFor<T extends WorkflowCatalogEventType> {
  eventType: T;
  windowDays: number;
  buildPayload(occurrence: DateOccurrence, daysUntil: number): BuiltWorkflowPayload<T>;
}

/**
 * Correlates the event type with its branded payload (the one place T is known) and erases it into
 * the closure-shaped `DateTriggerSource.domainEvent` the scanner stores.
 */
export function defineDateDomainEvent<T extends WorkflowCatalogEventType>(definition: DateDomainEventFor<T>): DateDomainEvent {
  return {
    eventType: definition.eventType,
    windowDays: definition.windowDays,
    emitOnce: (knex, tenant, occurrence, daysUntil) => emitDateDomainEventOnce(knex, tenant, {
      eventType: definition.eventType,
      entityId: occurrence.entityId,
      cycleKey: occurrence.cycleKey,
      occursOn: occurrence.occursOn,
      payload: definition.buildPayload(occurrence, daysUntil),
    }),
  };
}
