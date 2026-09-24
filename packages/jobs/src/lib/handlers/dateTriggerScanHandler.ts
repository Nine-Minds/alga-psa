import { Temporal } from '@js-temporal/polyfill';
import { createTenantKnex } from '@alga-psa/db';
import { getTenantTimezone } from '@alga-psa/tenancy/actions/tenant-settings-actions/tenantSettingsActions';
import logger from '@alga-psa/core/logger';
import { emitDateDomainEventOnce } from '@alga-psa/event-bus/workflow/dateDomainEvents';
import { dateTriggerSources } from '../dateTriggers/registry';
import type { DateOccurrence } from '../dateTriggers/types';

export interface DateTriggerScanJobData extends Record<string, unknown> { tenantId: string; now?: string; }
export type DateWorkflowLauncher = (params: { tenantId: string; today: string; now: Date; timezone: string; knex: import('knex').Knex; sources: typeof dateTriggerSources }) => Promise<void>;

function localDate(timeZone: string, instant: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function createDateTriggerScanHandler(
  launchDateTriggeredWorkflows?: DateWorkflowLauncher,
  clock: () => Date = () => new Date(),
  resolveTimezone: (tenantId: string) => Promise<string | null | undefined> = getTenantTimezone,
) {
  return async function dateTriggerScanHandler(data: DateTriggerScanJobData): Promise<void> {
    if (!data.tenantId) throw new Error('Tenant ID is required for date-trigger-scan');
    const { knex } = await createTenantKnex(data.tenantId);
    const timezone = await resolveTimezone(data.tenantId) ?? 'UTC';
    const now = data.now ? new Date(data.now) : clock();
    if (Number.isNaN(now.getTime())) throw new Error(`Invalid date-trigger-scan clock value: ${data.now}`);
    const today = localDate(timezone, now);
    for (const source of dateTriggerSources) {
      if (!source.domainEvent) continue;
      const toDate = Temporal.PlainDate.from(today).add({ days: source.domainEvent.windowDays }).toString();
      const occurrences = await source.findOccurrences(knex, data.tenantId, today, toDate);
      for (const occurrence of occurrences) {
        const distance = daysUntil(today, occurrence.occursOn);
        const eventPayload = source.domainEvent.buildPayload(occurrence, distance);
        await emitDateDomainEventOnce(knex, data.tenantId, {
          eventType: source.domainEvent.eventType, entityId: occurrence.entityId, cycleKey: occurrence.cycleKey,
          occursOn: occurrence.occursOn, payload: eventPayload,
        });
      }
    }
    await launchDateTriggeredWorkflows?.({ tenantId: data.tenantId, today, now, timezone, knex, sources: dateTriggerSources });
    logger.info('Completed date-trigger-scan', { tenantId: data.tenantId, today, timezone });
  };
}

function daysUntil(from: string, to: string): number {
  return Temporal.PlainDate.from(from).until(Temporal.PlainDate.from(to), { largestUnit: 'day' }).days;
}

export const dateTriggerScanHandler = createDateTriggerScanHandler();
