import { beforeEach, describe, expect, it, vi } from 'vitest';
import Handlebars from 'handlebars';

const runtime = vi.hoisted(() => ({
  assets: [] as Array<Record<string, any>>,
  materials: [] as Array<Record<string, any>>,
  timeEntries: [] as Array<Record<string, any>>,
  availableBlockMinutes: 0 as number,
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: () => {
    const db = {
      tenantJoin: (_query: unknown, _table: string, _left: string, _right: string, _opts?: unknown) => undefined,
      table: (table: string) => {
        const query: any = {
          where: () => query,
          orderBy: () => query,
          select: () => query,
          first: async () => null,
        };
        // Resolution happens on await; expose the per-table fixture then.
        if (table === 'asset_associations as aa') return Object.assign(query, { then: (res: any) => Promise.resolve(runtime.assets).then(res) });
        if (table === 'ticket_materials as tm') return Object.assign(query, { then: (res: any) => Promise.resolve(runtime.materials).then(res) });
        if (table === 'time_entries as te') return Object.assign(query, { then: (res: any) => Promise.resolve(runtime.timeEntries).then(res) });
        throw new Error(`Unexpected table in ticketEmailDetailBlocks test: ${table}`);
      },
    };
    return db;
  },
}));

vi.mock('@alga-psa/shared/billingClients/hourBlockService', () => ({
  getAvailableHourBlockMinutes: vi.fn(async () => runtime.availableBlockMinutes),
}));

import {
  buildTicketEmailDetailBlocks,
  escapeHtml,
  formatCentsAmount,
} from '../../../lib/notifications/ticketEmailDetailBlocks';
import { getAvailableHourBlockMinutes } from '@alga-psa/shared/billingClients/hourBlockService';

// The module calls db.raw() on the raw knex handle for the technician-name select.
const fakeDb: any = { raw: (sql: string) => ({ sql }) };

const tenantId = 'tenant-detail-blocks';
const ticketId = 'ticket-1';
const clientId = 'client-1';

describe('escapeHtml', () => {
  it('escapes HTML special characters', () => {
    expect(escapeHtml(`<script>alert("x & y 'z'")</script>`)).toBe(
      '&lt;script&gt;alert(&quot;x &amp; y &#39;z&#39;&quot;)&lt;/script&gt;',
    );
  });
});

describe('formatCentsAmount', () => {
  it('formats USD cents', () => {
    expect(formatCentsAmount(123456, 'USD')).toBe('$1,234.56');
  });

  it('formats non-USD currency codes', () => {
    expect(formatCentsAmount(2500, 'EUR')).toBe('€25.00');
  });

  it('uses the supplied email locale for money formatting', () => {
    expect(formatCentsAmount(123456, 'EUR', 'de-DE')).toBe('1.234,56\u00a0€');
  });

  it('defaults to USD when currency code missing', () => {
    expect(formatCentsAmount(990, null)).toBe('$9.90');
    expect(formatCentsAmount(990, '  ')).toBe('$9.90');
  });

  it('falls back to plain number for malformed currency codes', () => {
    // Intl accepts syntactically valid (if unassigned) 3-letter codes, printing
    // them literally; only malformed codes hit the toFixed fallback.
    expect(formatCentsAmount(1250, 'TOOLONG')).toBe('12.50');
  });
});

describe('buildTicketEmailDetailBlocks', () => {
  beforeEach(() => {
    runtime.assets = [];
    runtime.materials = [];
    runtime.timeEntries = [];
    runtime.availableBlockMinutes = 0;
    vi.mocked(getAvailableHourBlockMinutes).mockClear();
  });

  it('throws when ticketId is missing', async () => {
    await expect(
      buildTicketEmailDetailBlocks(fakeDb, tenantId, '', clientId, 'UTC'),
    ).rejects.toThrow(/ticketId is required/);
  });

  it('renders empty strings for empty blocks and zero totals', async () => {
    const blocks = await buildTicketEmailDetailBlocks(fakeDb, tenantId, ticketId, clientId, 'UTC');
    expect(blocks.assetsHtml).toBe('');
    expect(blocks.assets).toEqual([]);
    expect(blocks.materialsHtml).toBe('');
    expect(blocks.timeHtml).toBe('');
    expect(blocks.materialsTotal).toBe('$0.00');
    expect(blocks.totalTimeWorked).toBe('0 hrs');
    expect(blocks.totalTimeBillable).toBe('0 hrs');
    expect(blocks.remainingBlockHours).toBe('0 hrs');
  });

  it('skips hour-block lookup when no client is attached', async () => {
    const blocks = await buildTicketEmailDetailBlocks(fakeDb, tenantId, ticketId, null, 'UTC');
    expect(getAvailableHourBlockMinutes).not.toHaveBeenCalled();
    expect(blocks.remainingBlockHours).toBe('0 hrs');
  });

  it('reports remaining block hours from live available minutes', async () => {
    runtime.availableBlockMinutes = 150;
    const blocks = await buildTicketEmailDetailBlocks(fakeDb, tenantId, ticketId, clientId, 'UTC');
    expect(getAvailableHourBlockMinutes).toHaveBeenCalledWith(expect.anything(), tenantId, clientId);
    expect(blocks.remainingBlockHours).toBe('2 hrs 30 min');
  });

  it('renders an assets table with escaped values and relationship labels', async () => {
    runtime.assets = [
      { asset_tag: 'AST-001', name: 'Firewall <2200>', serial_number: 'SN42', status: 'in_use', relationship_type: 'affected' },
      { asset_tag: 'AST-002', name: null, serial_number: null, status: null, relationship_type: 'related' },
    ];
    const blocks = await buildTicketEmailDetailBlocks(fakeDb, tenantId, ticketId, clientId, 'UTC');
    expect(blocks.assetsHtml).toContain('<table');
    expect(blocks.assetsHtml).toContain('AST-001');
    expect(blocks.assetsHtml).toContain('Firewall &lt;2200&gt;');
    expect(blocks.assetsHtml).toContain('Affected');
    expect(blocks.assetsHtml).toContain('Related');
    // Null fields render as em-dash placeholders.
    expect(blocks.assetsHtml).toContain('—');
  });

  it('exposes selectable asset fields without pre-escaping them', async () => {
    runtime.assets = [
      {
        asset_tag: 'PRIVATE-TAG',
        name: 'Printer <Office>',
        asset_type: 'printer',
        asset_type_name: 'Printer',
        manufacturer: 'A & B',
        model: 'Model "42"',
        serial_number: 'SN42',
        status: 'active',
        location: 'Reception',
        relationship_type: 'affected',
      },
      { asset_type: 'custom_device', relationship_type: 'related' },
    ];
    const blocks = await buildTicketEmailDetailBlocks(fakeDb, tenantId, ticketId, clientId, 'UTC');
    expect(blocks.assets).toEqual([
      {
        assetTag: 'PRIVATE-TAG', name: 'Printer <Office>', assetType: 'Printer',
        manufacturer: 'A & B', model: 'Model "42"', serialNumber: 'SN42',
        status: 'active', location: 'Reception', relationship: 'Affected',
      },
      {
        assetTag: '', name: '', assetType: 'custom_device', manufacturer: '',
        model: '', serialNumber: '', status: '', location: '', relationship: 'Related',
      },
    ]);
    const html = Handlebars.compile(
      '{{#each ticket.assets}}<div>{{name}} / {{assetType}} / {{manufacturer}} {{model}}{{#if serialNumber}} / {{serialNumber}}{{/if}}</div>{{/each}}',
      { strict: true },
    )({ ticket: blocks });
    expect(html).toContain('Printer &lt;Office&gt; / Printer / A &amp; B Model &quot;42&quot; / SN42');
    expect(html).not.toContain('PRIVATE-TAG');
    expect(html).toContain('<div> / custom_device /  </div>');
    expect(Handlebars.compile('{{#each ticket.assets}}{{assetTag}}{{/each}}')({ ticket: blocks })).toBe('PRIVATE-TAG');
  });

  it('computes material amounts and total', async () => {
    runtime.materials = [
      { item_name: 'SSD 1TB', description: null, quantity: 2, rate: 7500, currency_code: 'USD', is_billed: false },
      { item_name: null, description: 'Cable run " Cat6 "', quantity: '3', rate: '150', currency_code: 'USD', is_billed: true },
    ];
    const blocks = await buildTicketEmailDetailBlocks(fakeDb, tenantId, ticketId, clientId, 'UTC');
    // 2 * 7500 + 3 * 150 = 15450 cents
    expect(blocks.materialsTotal).toBe('$154.50');
    expect(blocks.materialsHtml).toContain('SSD 1TB');
    expect(blocks.materialsHtml).toContain('Cable run &quot; Cat6 &quot;');
    expect(blocks.materialsHtml).toContain('$75.00'); // SSD rate
    expect(blocks.materialsHtml).toContain('$150.00'); // SSD amount 2 * 7500 cents
    expect(blocks.materialsHtml).toContain('$4.50'); // cable amount 3 * 150 cents
    expect(blocks.materialsHtml).toContain('Yes');
    expect(blocks.materialsHtml).toContain('No');
  });

  it('uses the supplied locale throughout the rendered blocks', async () => {
    runtime.materials = [
      { item_name: 'SSD', quantity: 2, rate: 7500, currency_code: 'EUR', is_billed: false },
    ];
    runtime.timeEntries = [
      { entry_id: 'e1', start_time: '2026-02-03T10:00:00Z', end_time: '2026-02-03T11:00:00Z', billable_duration: 60 },
    ];
    const blocks = await buildTicketEmailDetailBlocks(fakeDb, tenantId, ticketId, clientId, 'UTC', 'de-DE');
    expect(blocks.materialsTotal).toBe('150,00\u00a0€');
    expect(blocks.materialsHtml).toContain('75,00\u00a0€');
    expect(blocks.timeHtml).toContain('3. Feb. 2026');
  });

  it('sums worked vs billable minutes across time entries', async () => {
    const start = new Date('2026-02-03T10:00:00Z');
    const end = new Date('2026-02-03T11:30:00Z');
    runtime.timeEntries = [
      { entry_id: 'e1', start_time: start, end_time: end, billable_duration: 90, technician_name: 'Ada Lovelace' },
      // Null end_time falls back to billable_duration via workedMinutes().
      { entry_id: 'e2', start_time: start, end_time: null, billable_duration: '15', technician_name: '  ' },
    ];
    const blocks = await buildTicketEmailDetailBlocks(fakeDb, tenantId, ticketId, clientId, 'UTC');
    // worked: 90 + 15 = 105; billable: 90 + 15 = 105
    expect(blocks.totalTimeWorked).toBe('1 hr 45 min');
    expect(blocks.totalTimeBillable).toBe('1 hr 45 min');
    expect(blocks.timeHtml).toContain('Ada Lovelace');
    expect(blocks.timeHtml).toContain('Unknown');
    expect(blocks.timeHtml).toContain('Feb 3, 2026');
  });

  it('computes worked minutes distinct from billable when entry spans differ', async () => {
    runtime.timeEntries = [
      {
        entry_id: 'e1',
        start_time: '2026-02-03T10:00:00Z',
        end_time: '2026-02-03T12:00:00Z',
        billable_duration: 45,
        technician_name: 'Grace Hopper',
      },
    ];
    const blocks = await buildTicketEmailDetailBlocks(fakeDb, tenantId, ticketId, clientId, 'UTC');
    expect(blocks.totalTimeWorked).toBe('2 hrs');
    expect(blocks.totalTimeBillable).toBe('0 hrs 45 min');
  });
});
