import { describe, expect, it } from 'vitest';
import { dateTriggerSourceDefinitions, getDateTriggerSourceByCatalogEvent, getDateTriggerSourceDefinition } from '@alga-psa/workflows/authoring';
import { buildDateTriggerForSource } from '../dateTriggerSwitch';
import { DEFAULT_STATUS_AGE_PARAMS } from '../dateTriggerStatusAge';

describe('choosing a date source whose catalog row is picked as an event', () => {
  it('maps the catalog event to its source from the definitions, and nothing else', () => {
    const mapped = dateTriggerSourceDefinitions.filter((d) => 'catalogEventType' in d).map((d) => [d.catalogEventType, d.id]);
    expect(mapped).toEqual([['TICKET_STATUS_AGE', 'ticket.status_age']]);
    expect(getDateTriggerSourceByCatalogEvent('TICKET_STATUS_AGE')?.id).toBe('ticket.status_age');
    expect(getDateTriggerSourceByCatalogEvent('TICKET_CREATED')).toBeUndefined();
    // Real events that sources also emit as domain events stay ordinary event triggers.
    expect(getDateTriggerSourceByCatalogEvent('CLIENT_ANNIVERSARY_UPCOMING')).toBeUndefined();
  });

  it('builds the date trigger with offset 0, default params and the source schema', () => {
    const source = getDateTriggerSourceByCatalogEvent('TICKET_STATUS_AGE')!;
    const trigger = buildDateTriggerForSource(source);
    expect(trigger).toEqual({ type: 'date', source: 'ticket.status_age', offsetDays: 0, localTime: '08:00', params: { ...DEFAULT_STATUS_AGE_PARAMS } });
    expect(source.payloadSchemaRef).toBe('payload.TicketStatusAge.v1');
  });

  it('keeps timing when switching sources and drops params the new source does not take', () => {
    const statusAge = getDateTriggerSourceDefinition('ticket.status_age')!;
    const anniversary = getDateTriggerSourceDefinition('client.anniversary')!;
    const previous = { type: 'date', source: 'ticket.status_age', offsetDays: 0, localTime: '06:30', timezone: 'UTC', params: { statusName: 'x', days: 3 } };
    expect(buildDateTriggerForSource(statusAge, { ...previous, offsetDays: 5 })).toMatchObject({ offsetDays: 0, localTime: '06:30', timezone: 'UTC' });
    const next = buildDateTriggerForSource(anniversary, previous);
    expect(next).not.toHaveProperty('params');
    expect(next).toMatchObject({ source: 'client.anniversary', localTime: '06:30', timezone: 'UTC' });
  });
});
