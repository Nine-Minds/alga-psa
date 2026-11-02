import { describe, expect, it } from 'vitest';
import {
  ASSET_MAINTENANCE_SCHEDULE_SOURCE,
  ASSET_RECORD_SOURCE,
  TICKET_RECORD_SOURCE,
  TICKET_COMMENT_SOURCE,
  TICKET_WATCHER_SOURCE,
  ASSET_RELATIONSHIP_SOURCE,
  QUOTE_CONVERSION_PREVIEW_ITEM_SOURCE,
  QUOTE_LINE_RECORD_SOURCE,
  QUOTE_RECORD_SOURCE,
  PROJECT_RECORD_SOURCE,
  PROJECT_TASK_RECORD_SOURCE,
  createRecordProjectionPolicy,
  type RedactableRecordSource,
} from '@alga-psa/co-managed/recordProjection';

describe('source-aware record projection policy', () => {
  it('does not borrow an unrelated assignee decision for a comment author from the same user table', () => {
    const policy = createRecordProjectionPolicy(['tickets.assigned_to'], TICKET_RECORD_SOURCE);
    const author = { comment_id: 'comment-1', user_id: 'author-1', created_by: 'author-1', note: 'Visible note' };
    expect(policy.project(author, TICKET_COMMENT_SOURCE)).toEqual(author);
    expect(policy.readable('created_by', TICKET_COMMENT_SOURCE)).toBe(true);
  });
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

describe('dependencies retain the policy of their source across response shapes', () => {
  const delivery: RedactableRecordSource = {
    resource: ['shipment_rows'], identifier: ['shipment_id'], fields: {}, derived: {},
  };
  const line: RedactableRecordSource = {
    resource: ['invoice_lines'], identifier: ['line_id'], fields: {},
    derived: { amount: ['unit_price', 'quantity'], destination_label: [{ source: delivery, field: 'destination' }] },
  };
  const origin: RedactableRecordSource = {
    resource: ['orders'], identifier: ['order_id'], fields: {}, derived: {},
    children: { lines: line, deliveries: delivery },
  };
  const summary: RedactableRecordSource = {
    policySource: origin, resource: [], identifier: [], fields: {},
    derived: { total: ['entries.amount'], line_count: ['entries.line_id'] }, children: { entries: line },
  };
  const entry = { line_id: 'line-1', unit_price: 17, quantity: 2, amount: 34, destination_label: 'Private place' };

  it.each([
    'invoice_lines.unit_price', 'values.lines.unit_price', 'orders.lines.unit_price', 'fields.orders.lines.unit_price',
  ])('redacts aggregates and predicates under the same scoped dependency %s', redaction => {
    const policy = createRecordProjectionPolicy([redaction], origin);
    expect(policy.project({ total: 34, line_count: 1, entries: [entry] }, summary)).toEqual({
      total: null, line_count: 1,
      entries: [{ line_id: 'line-1', quantity: 2, amount: null, destination_label: 'Private place' }],
    });
    expect(policy.project({ total: 34, line_count: 1 }, summary)).toEqual({ total: null, line_count: 1 });
    expect(policy.readable('total', summary)).toBe(false);
    expect(policy.readable('line_count', summary)).toBe(true);
  });

  it.each(['orders.lines.line_id', 'values.lines.line_id', 'values.lines'])(
    'propagates child suppression to header-only aggregates under %s', redaction => {
      const policy = createRecordProjectionPolicy([redaction], origin);
      expect(policy.project({ total: 34, line_count: 1, entries: [entry] }, summary))
        .toEqual({ total: null, line_count: null, entries: [] });
      expect(policy.project({ total: 34, line_count: 1 }, summary)).toEqual({ total: null, line_count: null });
      expect(policy.readable('total', summary)).toBe(false);
      expect(policy.readable('line_count', summary)).toBe(false);
    },
  );

  it('resolves sibling source dependencies without inheriting unrelated sibling restrictions', () => {
    const hidden = createRecordProjectionPolicy(['values.deliveries.destination'], origin);
    expect(hidden.project(entry, line)).toEqual({ ...entry, destination_label: null });
    expect(hidden.readable('destination_label', line)).toBe(false);
    const unrelated = createRecordProjectionPolicy(['values.deliveries.tracking_code'], origin);
    expect(unrelated.project(entry, line)).toEqual(entry);
    expect(unrelated.readable('destination_label', line)).toBe(true);
  });

  it('uses phase and status source decisions for joined task labels while preserving independent fields', () => {
    const task = {
      task_id: 'task-1', task_name: 'Visible task', phase_id: 'phase-1', phase_name: 'Private phase',
      project_status_mapping_id: 'status-1', status_name: 'Private status', is_closed: true,
    };
    const phase = createRecordProjectionPolicy(['values.phases.phase_name'], PROJECT_RECORD_SOURCE);
    expect(phase.project(task, PROJECT_TASK_RECORD_SOURCE)).toEqual({ ...task, phase_name: null });
    expect(phase.readable('phase_name', PROJECT_TASK_RECORD_SOURCE)).toBe(false);
    const status = createRecordProjectionPolicy(['values.status_mappings.custom_name'], PROJECT_RECORD_SOURCE);
    expect(status.project(task, PROJECT_TASK_RECORD_SOURCE)).toEqual({ ...task, status_name: null });
    expect(status.readable('status_name', PROJECT_TASK_RECORD_SOURCE)).toBe(false);
    expect(status.readable('is_closed', PROJECT_TASK_RECORD_SOURCE)).toBe(true);
  });

  it('keeps cyclic copies visible without restrictions and hides every copy of a redacted member', () => {
    const source: RedactableRecordSource = {
      resource: ['copies'], identifier: ['id'], fields: {}, derived: { a: ['b'], b: ['a'] },
    };
    const record = { id: 'copy-1', a: 'private', b: 'private', label: 'visible' };
    expect(createRecordProjectionPolicy([], source).project(record, source)).toEqual(record);
    const policy = createRecordProjectionPolicy(['copies.b'], source);
    expect(policy.project(record, source)).toEqual({ ...record, a: null, b: null });
    expect(policy.readable('a', source)).toBe(false);
    expect(policy.readable('b', source)).toBe(false);
  });

  it('terminates reference cycles across parent and child sources without losing redactions', () => {
    const parent: RedactableRecordSource = {
      resource: ['parents'], identifier: ['id'], fields: {}, derived: { total: ['entries.amount'] },
    };
    const child: RedactableRecordSource = {
      resource: ['entries'], identifier: ['entry_id'], fields: {},
      derived: { amount: [{ source: parent, field: 'total' }] },
    };
    Object.assign(parent, { children: { entries: child } });
    const record = { id: 'parent-1', total: 10, entries: [{ entry_id: 'entry-1', amount: 10 }] };
    const visible = createRecordProjectionPolicy([], parent);
    expect(visible.project(record, parent)).toEqual(record);
    expect(visible.readable('total', parent)).toBe(true);
    const hidden = createRecordProjectionPolicy(['values.entries.amount'], parent);
    expect(hidden.project(record, parent)).toEqual({
      id: 'parent-1', total: null, entries: [{ entry_id: 'entry-1', amount: null }],
    });
    expect(hidden.readable('total', parent)).toBe(false);
  });

  it('allows partial serialization while refusing a predicate over a container with hidden descendants', () => {
    const policy = createRecordProjectionPolicy(['orders.lines.unit_price'], origin);
    expect(policy.project({ order_id: 'order-1', lines: [entry] }, origin)).toMatchObject({ order_id: 'order-1' });
    expect(policy.readable('lines', origin)).toBe(false);
    expect(policy.readable('lines.quantity', origin)).toBe(true);
  });
});
