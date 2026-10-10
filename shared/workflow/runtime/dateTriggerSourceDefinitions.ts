/**
 * The date trigger sources: the one list every layer derives from. Adding a source means adding an
 * entry here, a payload schema in schemas/dateTriggerPayloadSchemas.ts, a `findOccurrences` query in
 * packages/jobs/src/lib/dateTriggers/sources/, and the translation strings for its label.
 *
 * Derived from this list: the `source` zod enum of the date trigger (types.ts), the source id type,
 * the source-to-payload-schema ref map, the designer's source picker and schema policy, and the
 * Run dialog's occurrence rules (dateTriggerOccurrence.ts). packages/jobs only supplies the query for
 * each id; a test checks that every definition has one.
 *
 * Deliberately free of zod and node imports so the designer (browser), the scheduler and the jobs
 * package can all import it.
 */

export type DateTriggerSourceMode =
  /** Occurrences are dates inside a lookback window; the launcher scans `today-lookback .. today`. */
  | 'window'
  /** Occurrences are the result of a condition evaluated today (e.g. "ticket has been in status S
   *  for N days"). The launcher passes `params` and `today`, skips the window and relies on the
   *  trigger fire key for dedup. */
  | 'condition';

export type DateTriggerSourceRecurrence = 'annual' | 'once' | 'repeating';

export type DateTriggerSourceDefinition = {
  id: string;
  /** Translation key (msp/workflows namespace) for the designer's label. */
  labelKey: string;
  defaultLabel: string;
  payloadSchemaRef: string;
  mode: DateTriggerSourceMode;
  recurrence: DateTriggerSourceRecurrence;
  /** The source takes `trigger.params` (validated per source, hashed into the fire key). */
  hasParams: boolean;
  /** The designer offers the before/after offset control. Sources without one store offsetDays 0. */
  usesOffset: boolean;
  /** Set when the daily scan also emits an upcoming-date domain event for this source. */
  domainEvent?: { eventType: string; windowDays: number };
  /**
   * The system_event_catalog row that documents this source's payload. It is not a real event:
   * nothing publishes it, so the event-trigger picker redirects it to this date source and publish
   * validation rejects an `event` trigger that names it.
   */
  catalogEventType?: string;
};

export const dateTriggerSourceDefinitions = [
  {
    id: 'client.anniversary',
    labelKey: 'designer.form.dateSourceAnniversary',
    defaultLabel: 'Client anniversary',
    payloadSchemaRef: 'payload.ClientAnniversary.v1',
    mode: 'window',
    recurrence: 'annual',
    hasParams: false,
    usesOffset: true,
    domainEvent: { eventType: 'CLIENT_ANNIVERSARY_UPCOMING', windowDays: 30 },
  },
  {
    id: 'contract.renewal_decision',
    labelKey: 'designer.form.dateSourceRenewal',
    defaultLabel: 'Contract renewal decision date',
    payloadSchemaRef: 'payload.ContractRenewalDate.v1',
    mode: 'window',
    recurrence: 'once',
    hasParams: false,
    usesOffset: true,
    domainEvent: { eventType: 'CONTRACT_RENEWAL_UPCOMING', windowDays: 90 },
  },
  {
    id: 'contract.end',
    labelKey: 'designer.form.dateSourceContractEnd',
    defaultLabel: 'Contract end date',
    payloadSchemaRef: 'payload.ContractEndDate.v1',
    mode: 'window',
    recurrence: 'once',
    hasParams: false,
    usesOffset: true,
  },
  {
    id: 'asset.warranty_end',
    labelKey: 'designer.form.dateSourceWarranty',
    defaultLabel: 'Asset warranty end',
    payloadSchemaRef: 'payload.AssetWarrantyEnd.v1',
    mode: 'window',
    recurrence: 'once',
    hasParams: false,
    usesOffset: true,
    domainEvent: { eventType: 'ASSET_WARRANTY_EXPIRING', windowDays: 30 },
  },
  {
    id: 'ticket.status_age',
    labelKey: 'designer.form.dateSourceTicketStatusAge',
    defaultLabel: 'Ticket in status for N days',
    payloadSchemaRef: 'payload.TicketStatusAge.v1',
    mode: 'condition',
    recurrence: 'repeating',
    hasParams: true,
    usesOffset: false,
    catalogEventType: 'TICKET_STATUS_AGE',
  },
] as const satisfies readonly DateTriggerSourceDefinition[];

export type DateTriggerSourceId = (typeof dateTriggerSourceDefinitions)[number]['id'];

/** The ids as a non-empty tuple, the shape `z.enum` needs. */
export const DATE_TRIGGER_SOURCE_IDS = dateTriggerSourceDefinitions.map((definition) => definition.id) as unknown as readonly [
  DateTriggerSourceId,
  ...DateTriggerSourceId[],
];

export type DateTriggerPayloadSchemaRefs = {
  [D in (typeof dateTriggerSourceDefinitions)[number] as D['id']]: D['payloadSchemaRef'];
};

export const getDateTriggerSourceDefinition = (id: string): DateTriggerSourceDefinition | undefined =>
  (dateTriggerSourceDefinitions as readonly DateTriggerSourceDefinition[]).find((definition) => definition.id === id);

export const isDateTriggerSourceId = (value: unknown): value is DateTriggerSourceId =>
  typeof value === 'string' && dateTriggerSourceDefinitions.some((definition) => definition.id === value);

/** The date source whose catalog row is `eventType`, when that row is not a real event. */
export const getDateTriggerSourceByCatalogEvent = (eventType: unknown): DateTriggerSourceDefinition | undefined =>
  typeof eventType === 'string'
    ? (dateTriggerSourceDefinitions as readonly DateTriggerSourceDefinition[]).find((definition) => definition.catalogEventType === eventType)
    : undefined;
