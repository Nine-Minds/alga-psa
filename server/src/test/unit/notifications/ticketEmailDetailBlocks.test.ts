import { readFileSync } from 'node:fs';
import path from 'node:path';
import Handlebars from 'handlebars';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';

const state = vi.hoisted(() => ({
  assets: [] as Record<string, unknown>[],
  materials: [] as Record<string, unknown>[],
  time: [] as Record<string, unknown>[],
  tenant: vi.fn(),
  joins: vi.fn(),
  where: vi.fn(),
  whereIn: vi.fn(),
  hours: vi.fn(),
}));
vi.mock('@alga-psa/shared/billingClients/hourBlockService', () => ({
  getAvailableHourBlockMinutes: state.hours,
}));
vi.mock('@alga-psa/db', () => ({
  tenantDb: (...args: unknown[]) => {
    state.tenant(...args);
    return {
      tenantJoin: state.joins,
      table: (table: string) => {
        const rows = table.startsWith('asset_') ? state.assets
          : table.startsWith('ticket_materials') ? state.materials : state.time;
        let ticketIds: string[] = [];
        const builder = {
          select: () => builder,
          where: (criteria: unknown) => { state.where(criteria); return builder; },
          whereIn: (column: string, ids: string[]) => {
            state.whereIn(column, ids);
            ticketIds = ids;
            return builder;
          },
          // Fixture rows default to ticket-1; batch tests set ticket_id explicitly.
          orderBy: () => Promise.resolve(rows
            .map(row => ({ ticket_id: 'ticket-1', ...row }))
            .filter(row => ticketIds.includes(row.ticket_id as string))),
        };
        return builder;
      },
    };
  },
}));
import {
  buildTicketEmailDetailBlocks,
  buildTicketEmailDetailBlocksFromRows,
  fetchTicketEmailDetailRows,
  sortTimeEntriesChronologically,
} from '../../../lib/notifications/ticketEmailDetailBlocks';

const knex = { raw: vi.fn() } as Pick<Knex, 'raw'> as Knex;
const root = path.resolve(__dirname, '../../../../..');
// Pinned to UTC so date expectations do not depend on the host timezone.
const build = () => buildTicketEmailDetailBlocks(knex, 'tenant-1', 'ticket-1', 'client-1', 'UTC');

describe('closed-ticket email detail data', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.assets = [];
    state.materials = [];
    state.time = [];
    state.hours.mockResolvedValue(765);
  });

  it('returns data and totals without HTML fields, locale lookups or audience filtering', async () => {
    const data = await build();
    expect(data).toEqual({
      assets: [], materials: [], materialsTotal: '', timeEntries: [],
      totalTimeWorked: '0 hrs', totalTimeBillable: '0 hrs', remainingBlockHours: '12 hrs 45 min',
    });
    expect(Object.keys(data).some(key => /Html/.test(key))).toBe(false);
    expect(state.hours).toHaveBeenCalledWith(knex, 'tenant-1', 'client-1');
  });

  it('preserves selectable asset fields as unescaped data', async () => {
    state.assets = [{
      asset_tag: 'A-1', name: '<Printer>', asset_type: 'printer', asset_type_name: 'Printer',
      manufacturer: 'Brother', model: 'HL-L6200DW', serial_number: 'SN-1', status: 'active',
      location: null, relationship_type: 'affected',
    }];
    const data = await build();
    expect(data.assets[0]).toEqual({
      assetTag: 'A-1', name: '<Printer>', assetType: 'Printer', manufacturer: 'Brother',
      model: 'HL-L6200DW', serialNumber: 'SN-1', status: 'active', location: '', relationship: 'affected',
    });
    expect(Handlebars.compile('{{#each assets}}{{name}}{{/each}}')(data)).toBe('&lt;Printer&gt;');
  });

  it('uses row currencies and keeps unlike currency totals separate', async () => {
    state.materials = [
      { item_name: 'Toner', description: 'Black', quantity: '2', rate: '4500', currency_code: 'USD', is_billed: true },
      { item_name: null, description: 'Cable', quantity: 1, rate: 1000, currency_code: 'EUR', is_billed: false },
    ];
    const data = await build();
    expect(data.materials[0]).toMatchObject({ name: 'Toner', quantity: 2, rate: '$45.00', amount: '$90.00', billed: true });
    expect(data.materials[1]).toMatchObject({ name: 'Cable', currencyCode: 'EUR', billed: false });
    expect(data.materialsTotal).toBe('$90.00 + €10.00');
  });

  it('rejects invalid material currency and propagates lookup failures', async () => {
    state.materials = [{ item_name: 'Toner', quantity: 1, rate: 1000, currency_code: 'BAD' }];
    await expect(build()).rejects.toThrow('unsupported material currency');
    state.materials = [];
    state.hours.mockRejectedValueOnce(new Error('Hour-block database unavailable'));
    await expect(build()).rejects.toThrow('Hour-block database unavailable');
  });

  it('renders the old time-table columns from individual chronological array rows', async () => {
    state.time = [
      { entry_id: '3', start_time: '2025-06-11T09:00:00Z', end_time: '2025-06-11T09:30:00Z', billable_duration: 0, technician_name: 'Jane Smith' },
      { entry_id: '2', start_time: '2025-06-10T09:00:00Z', end_time: '2025-06-10T10:00:00Z', billable_duration: 45, technician_name: '<Alex>' },
      { entry_id: '1', start_time: '2025-06-09T09:00:00Z', end_time: '2025-06-09T10:30:00Z', billable_duration: 90, technician_name: 'Jane Smith' },
    ];
    const data = await build();
    expect(data.timeEntries).toEqual([
      { date: '06/09/2025', technician: 'Jane Smith', worked: '1 hr 30 min', billable: '1 hr 30 min' },
      { date: '06/10/2025', technician: '<Alex>', worked: '1 hr', billable: '0 hrs 45 min' },
      { date: '06/11/2025', technician: 'Jane Smith', worked: '0 hrs 30 min', billable: '0 hrs' },
    ]);
    expect(data.totalTimeWorked).toBe('3 hrs');
    expect(data.totalTimeBillable).toBe('2 hrs 15 min');
    const guide = readFileSync(path.join(root, 'docs/email/editing-ticket-email-html.md'), 'utf8');
    const example = guide.match(/```html\r?\n([\s\S]*?)```/)?.[1];
    expect(example).toBeDefined();
    const source = example!.match(/\{\{#if ticket\.timeEntries\}\}[\s\S]*?\{\{\/if\}\}/)?.[0];
    expect(source).toBeDefined();
    const render = Handlebars.compile(source!, { strict: true });
    const html = render({ ticket: data });
    expect(html.match(/<td /g)).toHaveLength(12);
    for (const column of ['Date', 'Technician', 'Worked', 'Billable']) expect(html).toContain(`>${column}</th>`);
    expect(html).toContain('&lt;Alex&gt;');
    expect(html.indexOf('06/09/2025')).toBeLessThan(html.indexOf('06/10/2025'));
    expect(html.indexOf('06/10/2025')).toBeLessThan(html.indexOf('06/11/2025'));
    expect(render({ ticket: { ...data, timeEntries: [] } })).not.toContain('<table');
  });

  it('uses the existing effective timezone for the work date', async () => {
    state.time = [{ entry_id: '1', start_time: '2025-06-10T01:00:00Z', end_time: '2025-06-10T02:00:00Z', billable_duration: null, technician_name: null }];
    const data = await buildTicketEmailDetailBlocks(knex, 'tenant-1', 'ticket-1', null, 'America/New_York');
    expect(data.timeEntries[0]).toEqual({ date: '06/09/2025', technician: '', worked: '1 hr', billable: '0 hrs' });
    expect(data.totalTimeBillable).toBe('0 hrs');
    expect(data.remainingBlockHours).toBe('0 hrs');
    expect(state.hours).not.toHaveBeenCalled();
  });

  it('keeps sorting deterministic without mutating input', () => {
    const rows = ['B', 'A'].map(name => ({
      entry_id: name, technician_name: name, start_time: '2025-06-10T09:00:00Z',
      end_time: null, billable_duration: 0,
    }));
    expect(sortTimeEntriesChronologically(rows).map(row => row.entry_id)).toEqual(['A', 'B']);
    expect(rows[0].entry_id).toBe('B');
  });

  it('scopes every query and join to the tenant', async () => {
    await build();
    expect(state.tenant).toHaveBeenCalledTimes(3);
    for (const call of state.tenant.mock.calls) expect(call).toEqual([knex, 'tenant-1']);
    expect(state.joins.mock.calls.map(call => call[1])).toEqual(['assets as a', 'asset_type_registry as atr', 'service_catalog as sc', 'users as u']);
    expect(state.whereIn).toHaveBeenCalledWith('te.work_item_id', ['ticket-1']);
    expect(state.where).toHaveBeenCalledWith({ 'te.work_item_type': 'ticket' });
  });

  it('batches detail queries for several tickets and keeps each ticket to its own rows', async () => {
    state.materials = [
      { ticket_id: 'ticket-1', item_name: 'Toner', quantity: 1, rate: 4500, currency_code: 'USD', is_billed: false },
      { ticket_id: 'ticket-2', item_name: 'Cable', quantity: 2, rate: 1000, currency_code: 'USD', is_billed: false },
    ];
    state.time = [
      { ticket_id: 'ticket-2', entry_id: '2', start_time: '2025-06-10T09:00:00Z', end_time: '2025-06-10T09:30:00Z', billable_duration: 30, technician_name: 'Kim' },
    ];
    const rows = await fetchTicketEmailDetailRows(knex, 'tenant-1', ['ticket-1', 'ticket-2']);
    expect(state.tenant).toHaveBeenCalledTimes(3);
    expect(state.whereIn).toHaveBeenCalledWith('tm.ticket_id', ['ticket-1', 'ticket-2']);
    const fromRows = (ticketId: string, clientId: string | null) =>
      buildTicketEmailDetailBlocksFromRows(ticketId, clientId, rows, 'UTC', (id) => state.hours(knex, 'tenant-1', id));
    expect(await fromRows('ticket-1', 'client-1')).toMatchObject({ materialsTotal: '$45.00', timeEntries: [], remainingBlockHours: '12 hrs 45 min' });
    expect(await fromRows('ticket-2', null)).toMatchObject({
      materialsTotal: '$20.00',
      timeEntries: [{ date: '06/10/2025', technician: 'Kim', worked: '0 hrs 30 min', billable: '0 hrs 30 min' }],
      remainingBlockHours: '0 hrs',
    });
  });
});
