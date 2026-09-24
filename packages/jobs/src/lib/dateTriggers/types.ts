import type { Knex } from 'knex';

export type DateTriggerSourceId = 'client.anniversary' | 'contract.renewal_decision' | 'contract.end' | 'asset.warranty_end';

export interface DateOccurrence {
  entityId: string;
  clientId: string;
  occursOn: string;
  cycleKey: string;
  payload: Record<string, unknown>;
}

export interface DateTriggerSource {
  id: DateTriggerSourceId;
  payloadSchemaRef: string;
  domainEvent?: { eventType: string; windowDays: number; buildPayload(occurrence: DateOccurrence, daysUntil: number): Record<string, unknown> };
  findOccurrences(db: Knex, tenant: string, fromDate: string, toDate: string): Promise<DateOccurrence[]>;
}

export type DateSourceScanOptions = { db: Knex; tenant: string; fromDate: string; toDate: string };
