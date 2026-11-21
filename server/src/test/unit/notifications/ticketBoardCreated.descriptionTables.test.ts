/**
 * alga-2026-0003184: New Ticket on Board email Description for table-based inbound HTML.
 *
 * Synthetic emails for the live (Mailpit) verification step to replay:
 *  - NAGIOS_STYLE_HTML / PRTG_STYLE_HTML below (multi-row, multi-cell alert tables)
 */
import { describe, expect, it, vi } from 'vitest';
import Handlebars from 'handlebars';
import { createRequire } from 'node:module';

vi.mock('@alga-psa/core/logger', () => ({ default: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock('@alga-psa/notifications/notifications/emailLocaleResolver', () => ({ getTenantDefaultLocale: vi.fn(async () => 'en') }));
vi.mock('../../../lib/utils/workDate', () => ({ resolveEffectiveTimeZone: vi.fn(async () => 'UTC') }));
vi.mock('../../../lib/db/db', () => ({ getConnection: vi.fn(async () => ({})) }));
vi.mock('@alga-psa/tenancy/lib/tenantDefaultCountry', () => ({ resolveTenantDefaultCountry: vi.fn(async () => null) }));
vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual: any = await importOriginal().catch(() => ({}));
  const query: any = {
    select: () => query, where: () => query, orderBy: () => query, whereNull: () => query,
    first: async () => null,
  };
  return { ...actual, tenantDb: () => ({ table: () => query, tenantJoin: () => undefined }), getConnection: vi.fn(async () => ({})) };
});

import { buildTicketSummaryEmailContext } from '../../../lib/eventBus/subscribers/ticketEmailSubscriber';
import { blocksFromEmailBody } from '@shared/services/email/inboundEmbeddedImageUrlRewrite';
import { formatBlockNoteContent } from '@alga-psa/formatting/blocknoteUtils';

const require = createRequire(import.meta.url);
const migrations = '../../../../migrations/utils/templates/email/tickets';
const { getTemplate: boardTemplate } = require(`${migrations}/ticketBoardCreated.cjs`);
const { getTemplate: clientTemplate } = require(`${migrations}/ticketCreatedClient.cjs`);

const NAGIOS_STYLE_HTML = `<html><body>
<p>***** Nagios *****</p>
<table border="1">
<tr><th>Host</th><th>Service</th><th>State</th></tr>
<tr><td>web01.example.test</td><td>HTTP</td><td>CRITICAL</td></tr>
<tr><td>db01.example.test</td><td>Disk /var</td><td>WARNING</td></tr>
</table></body></html>`;
const PRTG_STYLE_HTML = `<html><body><table>
<tr><td>Sensor</td><td>Status</td><td>Last Message</td></tr>
<tr><td>Ping Core Switch</td><td>Down</td><td>No reply</td></tr>
<tr><td>Bandwidth WAN</td><td>Warning</td><td>92% utilised</td></tr>
</table></body></html>`;

const en = (def: any) => def.translations.find((t: any) => t.language === 'en');
const render = (src: string, ticket: Record<string, unknown>) => Handlebars.compile(src)({ ticket });

const ticketRow: any = {
  ticket_id: 't1', ticket_number: 'T-1', title: 'Alert', priority_name: 'High', status_name: 'New',
  client_name: 'Acme', board_name: 'NOC', entered_at: new Date(0).toISOString(), attributes: {},
};

async function contextFor(description: unknown) {
  const row = { ...ticketRow, attributes: { description: typeof description === 'string' ? description : JSON.stringify(description) } };
  const knex: any = Object.assign(() => ({ where: () => ({ first: async () => null }) }), {});
  return (await buildTicketSummaryEmailContext(knex, '11111111-2222-3333-4444-555555555555', row, undefined)).baseTicketContext;
}

describe('ticket-board-created template', () => {
  it('shows table cell text in the HTML Description box and in the text alternative', async () => {
    for (const html of [NAGIOS_STYLE_HTML, PRTG_STYLE_HTML]) {
      const blocks = await blocksFromEmailBody({ html });
      const f = formatBlockNoteContent(blocks as any);
      for (const cell of ['CRITICAL', 'web01.example.test', 'Down', 'Ping Core Switch']) {
        if (html.includes(cell)) {
          expect(f.html).toContain(cell);
          expect(f.text).toContain(cell);
        }
      }
      expect(f.text).not.toMatch(/\|\s*\|\s*\|/);
    }
  });

  it('renders descriptionHtml (table) inside the Description box and text with cell text', () => {
    const t = en(boardTemplate());
    const ticket = {
      title: 'x', board: 'NOC', clientName: 'Acme', priority: 'High', metaLine: 'm',
      description: '| Host | State |\n| web01 | DOWN |',
      descriptionHtml: '<table><tbody><tr><td>web01</td><td>DOWN</td></tr></tbody></table>',
    };
    const html = render(t.htmlContent, ticket);
    const box = html.slice(html.indexOf('Description'));
    expect(box).toContain('<td>web01</td><td>DOWN</td>');
    expect(render(t.textContent, ticket)).toContain('| web01 | DOWN |');
  });

  it('paragraph-only description renders the paragraph in the box', () => {
    const t = en(boardTemplate());
    const html = render(t.htmlContent, { title: 'x', description: 'hello', descriptionHtml: '<p>hello</p>' });
    expect(html).toContain('<p>hello</p>');
  });

  it('every language uses descriptionHtml in HTML and the text rendition in text', () => {
    for (const tr of boardTemplate().translations) {
      expect(tr.htmlContent).toContain('{{{ticket.descriptionHtml}}}');
      expect(tr.textContent).toContain('{{{ticket.description}}}');
      expect(tr.textContent).not.toContain('descriptionHtml');
    }
  });

  it('client ticket-created output is unchanged (still the text rendition)', () => {
    for (const tr of clientTemplate().translations) {
      expect(tr.htmlContent).not.toContain('descriptionHtml');
    }
  });
});

describe('descriptionHtml construction (subscriber path)', () => {
  it('strips script and event handlers from an inbound body', async () => {
    const html = '<p>hi</p><script>alert(1)</script><img src="x" onerror="alert(2)"><table><tr><td onclick="x()">cell</td></tr></table>';
    const blocks = await blocksFromEmailBody({ html });
    const raw = formatBlockNoteContent(blocks as any).html;
    const ctx = await contextFor(blocks);
    expect(ctx.descriptionHtml).not.toMatch(/<script/i);
    expect(ctx.descriptionHtml).not.toMatch(/\son\w+\s*=/i);
    expect(ctx.descriptionHtml).toContain('cell');
    expect(raw.length).toBeGreaterThan(0);
  });

  it('sanitises HTML that the converter passes through verbatim (proves the sanitiser ran)', async () => {
    const blocks = [{ type: 'paragraph', content: [{ type: 'text', text: 'x', styles: {} }] }];
    const mod = await import('@alga-psa/formatting/blocknoteUtils');
    const spy = vi.spyOn(mod, 'formatBlockNoteContent').mockReturnValue({
      html: '<p>ok</p><script>alert(1)</script><img src=x onerror=alert(2)>', text: 'ok',
    } as any);
    try {
      const ctx = await contextFor(blocks);
      expect(ctx.descriptionHtml).toContain('<p>ok</p>');
      expect(ctx.descriptionHtml).not.toMatch(/script|onerror/i);
    } finally { spy.mockRestore(); }
  });

  it('escapes the no-description fallback and leaves safe input unchanged', async () => {
    const empty = await contextFor('');
    expect(empty.descriptionHtml).toBe('<p>No description provided.</p>');
    const safe = formatBlockNoteContent([{ type: 'paragraph', content: [{ type: 'text', text: 'hello', styles: {} }] }] as any).html;
    const ctx = await contextFor([{ type: 'paragraph', content: [{ type: 'text', text: 'hello', styles: {} }] }]);
    expect(ctx.descriptionHtml).toBe(safe);
  });
});
