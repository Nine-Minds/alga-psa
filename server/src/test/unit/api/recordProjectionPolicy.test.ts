import { describe, expect, it } from 'vitest';
import {
  ASSET_MAINTENANCE_SCHEDULE_SOURCE,
  ASSET_RECORD_SOURCE,
  TICKET_RECORD_SOURCE,
  TICKET_WATCHER_SOURCE,
  ASSET_RELATIONSHIP_SOURCE,
  QUOTE_CONVERSION_PREVIEW_ITEM_SOURCE,
  QUOTE_LINE_RECORD_SOURCE,
  QUOTE_RECORD_SOURCE,
  createRecordProjectionPolicy,
} from '@alga-psa/co-managed/recordProjection';

describe('source-aware record projection policy', () => {
  it('uses the same field decision for detached lines, preview lines and predicates', () => {
    const policy = createRecordProjectionPolicy(['values.items.unit_price'], QUOTE_RECORD_SOURCE);
    const line = { quote_item_id: 'line-1', description: 'Visible line', unit_price: 4938, total_price: 4938 };

    for (const source of [QUOTE_LINE_RECORD_SOURCE, QUOTE_CONVERSION_PREVIEW_ITEM_SOURCE]) {
      expect(policy.project(line, source)).toEqual({
        quote_item_id: 'line-1', description: 'Visible line', total_price: null,
      });
      expect(policy.readable('unit_price', source)).toBe(false);
      expect(policy.readable('total_price', source)).toBe(false);
      expect(policy.readable('description', source)).toBe(true);
    }
    expect(line.unit_price).toBe(4938);
  });

  it('keeps whole-child suppression within its source even when parent and child share a table', () => {
    const policy = createRecordProjectionPolicy(['values.relationships'], ASSET_RECORD_SOURCE);
    const relationship = { related_asset_id: 'other-asset', related_asset_name: 'Private name' };
    const asset = { asset_id: 'asset-1', name: 'Visible asset', relationships: [relationship] };

    expect(policy.project(asset, ASSET_RECORD_SOURCE)).toEqual({ asset_id: 'asset-1', name: 'Visible asset' });
    expect(policy.project(relationship, ASSET_RELATIONSHIP_SOURCE)).toBeNull();
    expect(policy.readable('name', ASSET_RECORD_SOURCE)).toBe(true);
    expect(policy.readable('related_asset_name', ASSET_RELATIONSHIP_SOURCE)).toBe(false);
    expect(policy.project({ schedule_id: 'schedule-1', next_maintenance: '2027-01-01' }, ASSET_MAINTENANCE_SCHEDULE_SOURCE))
      .toEqual({ schedule_id: 'schedule-1', next_maintenance: '2027-01-01' });
  });

  it.each(['assets.maintenance_schedules.schedule_id', 'values.maintenance_schedules.schedule_id'])(
    'excludes predicates over a child suppressed by %s', alias => {
      const policy = createRecordProjectionPolicy([alias], ASSET_RECORD_SOURCE);
      expect(policy.readable('maintenance_schedules.next_maintenance', ASSET_RECORD_SOURCE)).toBe(false);
      expect(policy.readable('values.maintenance_schedules.next_maintenance', ASSET_RECORD_SOURCE)).toBe(false);
      expect(policy.readable('next_maintenance', ASSET_MAINTENANCE_SCHEDULE_SOURCE)).toBe(false);
      expect(policy.readable('name', ASSET_RECORD_SOURCE)).toBe(true);
    },
  );

  it('suppresses detached children when the originating resource is hidden', () => {
    const policy = createRecordProjectionPolicy(['quotes.quote_id'], QUOTE_RECORD_SOURCE);
    expect(policy.project({ quote_item_id: 'line-1', unit_price: 4938 }, QUOTE_LINE_RECORD_SOURCE)).toBeNull();
    expect(policy.readable('unit_price', QUOTE_CONVERSION_PREVIEW_ITEM_SOURCE)).toBe(false);
  });

  it.each([
    'ticket_watchers.email', 'values.watchers.email', 'tickets.attributes.watch_list.email',
    'fields.tickets.attributes.watch_list.email',
  ])('shares watcher decisions across stored and detached representations for %s', alias => {
    const watcher = { email: 'private@example.test', entity_id: 'contact-1', name: 'Visible name' };
    const record = { ticket_id: 'ticket-1', attributes: { watch_list: [watcher], unrelated: 'Visible context' } };
    const policy = createRecordProjectionPolicy([alias], TICKET_RECORD_SOURCE);
    expect(policy.project(watcher, TICKET_WATCHER_SOURCE)).toEqual({ entity_id: 'contact-1', name: 'Visible name' });
    expect(policy.project(record, TICKET_RECORD_SOURCE)).toEqual({
      ticket_id: 'ticket-1', attributes: { watch_list: [{ entity_id: 'contact-1', name: 'Visible name' }], unrelated: 'Visible context' },
    });
    expect(policy.readable('attributes.watch_list.email', TICKET_RECORD_SOURCE)).toBe(false);
    expect(record.attributes.watch_list[0].email).toBe('private@example.test');
  });

  it('suppresses both watcher representations when either child route is hidden', () => {
    const policy = createRecordProjectionPolicy(['attributes.watch_list.entity_id'], TICKET_RECORD_SOURCE);
    const watcher = { email: 'private@example.test', entity_id: 'contact-1' };
    expect(policy.project(watcher, TICKET_WATCHER_SOURCE)).toBeNull();
    expect(policy.project({ ticket_id: 't', watchers: [watcher], attributes: { watch_list: [watcher] } }, TICKET_RECORD_SOURCE))
      .toEqual({ ticket_id: 't', watchers: [], attributes: { watch_list: [] } });
  });

  it('fails closed for malformed declared child records rather than serving opaque source data', () => {
    const policy = createRecordProjectionPolicy(['ticket_watchers.email'], TICKET_RECORD_SOURCE);
    expect(policy.project({ ticket_id: 't', attributes: '{"watch_list":[{"email":"private@example.test"}]}' }, TICKET_RECORD_SOURCE))
      .toEqual({ ticket_id: 't', attributes: null });
    expect(policy.project({ ticket_id: 't', watchers: ['private@example.test', null, ['private@example.test'], { email: 'private@example.test', entity_id: 'c' }] }, TICKET_RECORD_SOURCE))
      .toEqual({ ticket_id: 't', watchers: [{ entity_id: 'c' }] });
  });

});
