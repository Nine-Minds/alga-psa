/**
 * alga-2026-0003184: New Ticket on Board email Description for table-based inbound HTML.
 *
 * Synthetic emails for the live (Mailpit) verification step to replay:
 *  - NAGIOS_STYLE_HTML / PRTG_STYLE_HTML below (multi-row, multi-cell alert tables)
 */
import { describe, expect, it, vi } from 'vitest';
import Handlebars from 'handlebars';
import { createHash } from 'node:crypto';
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
const { getTemplate: createdTemplate, COPY: createdCopy } = require(`${migrations}/ticketCreated.cjs`);
const { getTemplate: statusEnteredTemplate } = require(`${migrations}/ticketBoardStatusEntered.cjs`);

// sha256 of JSON([subject, htmlContent, textContent]) per language, rendered from HEAD 0790384d
// (before the ticket-created change). These templates must not move.
const digest = (tr: any) => createHash('sha256').update(JSON.stringify([tr.subject, tr.htmlContent, tr.textContent])).digest('hex');
const BASELINE: Record<string, Record<string, string>> = {
  "ticketCreatedClient": {
    "en": "90d6e9694d0d27fab123397c3c702844069208362027c837739c3ca2ae39ff3b",
    "fr": "990f9185c14b2011c26eb7f79707badf993cb196318417807e746efab11e7df1",
    "es": "ce3967b8944f977967d6d45975445ed30b39750b3ac3b511f5ab85e2aece8636",
    "de": "67214414f6f62e82918ab11555b089e969656a9845a6b15ec237dcba028ee84e",
    "nl": "80e6c91417a2c4543455fab1d3124f79df41ca78be30817d437725ab14f46642",
    "it": "adb7fd3a90302620d4d86673922f72379b27158ec0f3e993c930a1c0dc41e996",
    "pl": "6e3fa237d00a1eb40346d649dbdd588a454e770c7853af8fe907f8e63a2806e6",
    "pt": "967c3ebc9b29e8798544152780320b8d0f7940e6948fe6f6773e3eaddc757bd3",
    "sv": "916f78d0373382b0015a6e09787c3ae99c84b6418a198dfaa457214800d2155b"
  },
  "ticketBoardStatusEntered": {
    "en": "87c5e8024cfb7ac4e8045d1fd2a575c4427b2bd23da83802ccf986965d61c207",
    "fr": "23e47d77a326a53a584ce4e09d00c9237747e064ae011515f680fde9954e36a8",
    "es": "95bd8291d31096e286b099c3a5dabe81b6e6de3f5f8c4ab69b29522d79965928",
    "de": "5736cbaceed43c67b3d28a22d3217389dcd63cfb678fc38dad09be6590360271",
    "nl": "9ce907a85545243abd6c16cba3c15ce8e98453a9c3a97de9e507a500f8206c73",
    "it": "e5e38311425d9ef70479c785b5fcef9228e06d7256c5ee3cea445489f78268a8",
    "pl": "73b01de4373b77497fcd04c0ef1b4fc09bc63e706984a6dad62ba3c8a634736d",
    "pt": "b0e0f26bec816c551947e379866b4e88082f1d1daaf3e40183bb999b980ebec1",
    "sv": "34c9be53c7732d74413c65cce52430f5c8dc68b27ed15fb5274c48814da113c5"
  }
};

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

  it('client ticket-created output is byte-for-byte unchanged (still the text rendition)', () => {
    const translations = clientTemplate().translations;
    expect(translations.map((t: any) => t.language).sort()).toEqual(Object.keys(BASELINE.ticketCreatedClient).sort());
    for (const tr of translations) {
      expect(tr.htmlContent).not.toContain('descriptionHtml');
      expect(digest(tr)).toBe(BASELINE.ticketCreatedClient[tr.language]);
    }
  });

  it('ticket-board-status-entered output is unchanged (still the text rendition)', () => {
    const translations = statusEnteredTemplate().translations;
    expect(translations.map((t: any) => t.language).sort()).toEqual(Object.keys(BASELINE.ticketBoardStatusEntered).sort());
    for (const tr of translations) {
      expect(digest(tr)).toBe(BASELINE.ticketBoardStatusEntered[tr.language]);
    }
  });
});

describe('ticket-created template (internal rendering)', () => {
  it('covers every COPY language; HTML body uses descriptionHtml, text part keeps description', () => {
    const translations = createdTemplate().translations;
    expect(translations.map((t: any) => t.language).sort()).toEqual(Object.keys(createdCopy).sort());
    for (const tr of translations) {
      expect(tr.htmlContent).toContain('{{{ticket.descriptionHtml}}}');
      expect(tr.htmlContent).not.toContain('{{{ticket.description}}}');
      expect(tr.textContent).toContain('{{{ticket.description}}}');
      expect(tr.textContent).not.toContain('descriptionHtml');
    }
  });

  it('exported COPY is untouched (text-based) so board-created and status-entered text stay text', () => {
    for (const copy of Object.values<any>(createdCopy)) {
      expect(copy.descriptionVar).toBe('{{{ticket.description}}}');
    }
  });

  it('renders a table description as <table>/<td>, a plain one as before, an empty one as the escaped fallback', () => {
    const t = en(createdTemplate());
    const table = { title: 'x', description: '| Host | stadium-fw01 |', descriptionHtml: '<table><tbody><tr><td>Host</td><td>stadium-fw01</td></tr></tbody></table>' };
    const html = render(t.htmlContent, table);
    expect(html.slice(html.indexOf('Description'))).toContain('<td>stadium-fw01</td>');
    expect(html).not.toContain('| Host |');
    expect(render(t.textContent, table)).toContain('| Host | stadium-fw01 |');
    expect(render(t.htmlContent, { title: 'x', description: 'hello', descriptionHtml: '<p>hello</p>' })).toContain('<p>hello</p>');
    expect(render(t.htmlContent, { title: 'x', description: 'No description provided.', descriptionHtml: '<p>No description provided.</p>' }))
      .toContain('<p>No description provided.</p>');
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
