import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stripPreheaderElements } from '@shared/lib/email/replyParser';

const inserts: string[] = [];
const templateHtml = vi.hoisted(() => ({ value: '<p>Ticket body</p>' }));
const sendEmail = vi.fn();

vi.mock('@alga-psa/db', () => {
  const makeChain = (table: string) => {
    const chain: any = new Proxy(function () {}, {
      get(_target, prop) {
        if (prop === 'then') {
          const rows: Record<string, unknown> = {
            tenant_email_templates: {
              id: 't1',
              name: 'ticket-board-created',
              html_content: templateHtml.value,
              subject: 'New Ticket on Board',
            },
          };
          return (resolve: (v: unknown) => unknown) => resolve(rows[table]);
        }
        if (prop === 'toSQL') return () => ({ sql: '', bindings: [] });
        if (prop === 'insert') {
          return () => {
            inserts.push(table);
            return chain;
          };
        }
        return () => chain;
      },
    });
    return chain;
  };
  return { tenantDb: () => ({ table: (name: string) => makeChain(name) }) };
});

vi.mock('../../../lib/db/db', () => ({
  getConnection: async () => ({
    client: { config: { connection: { database: 'test' } } },
    schema: { hasTable: async () => true },
    raw: () => 'raw',
  }),
}));

vi.mock('@alga-psa/email', () => ({
  TenantEmailService: { getInstance: () => ({ sendEmail }) },
  StaticTemplateProcessor: class {
    constructor(public subject: string, public html: string, public text: string) {}
  },
}));

vi.mock('@alga-psa/notifications/notifications/emailLocaleResolver', () => ({
  getUserInfoForEmail: async () => null,
  resolveEmailLocale: async () => 'en',
}));

import { sendEventEmail } from '../../../lib/notifications/sendEventEmail';

const baseParams = {
  mailClass: 'ticket' as const,
  tenantId: '11111111-1111-1111-1111-111111111111',
  to: 'queue-dl@msp.test',
  subject: 'New Ticket on Board',
  template: 'ticket-board-created',
  context: { ticket: { id: 'T-42', title: 'Printer down' } },
  locale: 'en' as const,
};
const replyContext = { ticketId: 'ticket-1', commentId: 'comment-1', threadId: 'thread-1' };
const BANNER = '--- Please reply above this line ---';

async function sendHtml(body: string): Promise<{ html: string; text: string }> {
  templateHtml.value = body;
  sendEmail.mockClear();
  await sendEventEmail({ ...baseParams, replyContext });
  return sendEmail.mock.calls[0][0].templateProcessor;
}

/** Text nodes of the HTML in document order, ignoring empty ones. */
function textNodes(html: string): string[] {
  return html.split(/<[^>]*>/).map((t) => t.trim()).filter(Boolean);
}

describe('sendEventEmail reply-marker layout', () => {
  beforeEach(() => {
    inserts.length = 0;
    sendEmail.mockReset();
    sendEmail.mockResolvedValue({ success: true, messageId: 'm1', rfcMessageId: '<m1@msp.test>' });
  });

  it('starts with a preheader holding body content, not the token, boundary or banner', async () => {
    const { html } = await sendHtml('<p>Printer on floor 3 is jammed</p>');
    expect(html.startsWith('<div data-alga-preheader="true"')).toBe(true);
    const first = textNodes(html)[0];
    expect(first).toContain('Printer on floor 3 is jammed');
    expect(first).not.toContain('ALGA-REPLY-TOKEN');
    expect(first).not.toContain('reply above this line');
  });

  it('keeps token and boundary divs textless with their attributes, token above boundary', async () => {
    const { html } = await sendHtml('<p>Body</p>');
    const token = html.match(/<div data-alga-reply-token="[^"]+"[^>]*><\/div>/);
    expect(token?.[0]).toContain('data-alga-ticket-id="ticket-1"');
    expect(token?.[0]).toContain('data-alga-comment-id="comment-1"');
    expect(token?.[0]).toContain('data-alga-thread-id="thread-1"');
    expect(html).toContain('<div data-alga-reply-boundary="true" style="display:none;max-height:0;overflow:hidden;"></div>');
    expect(html.indexOf('data-alga-reply-token')).toBeLessThan(html.indexOf('data-alga-reply-boundary'));
    expect(html.indexOf('data-alga-preheader')).toBeLessThan(html.indexOf('data-alga-reply-token'));
  });

  it('escapes and truncates the preheader on a word boundary', async () => {
    const { html } = await sendHtml('<p>Tom &amp; Jerry said "<b>&lt;script&gt;</b>" it\'s broken</p>');
    const pre = html.match(/<div data-alga-preheader="true"[^>]*>([^<]*)<span>/)![1];
    expect(pre).toContain('&amp;');
    expect(pre).toContain('&quot;');
    expect(pre).toContain('&lt;script&gt;');
    expect(pre).not.toContain('<script');

    const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
    const { html: h2 } = await sendHtml(`<p>${long}</p>`);
    const pre2 = h2.match(/<div data-alga-preheader="true"[^>]*>([^<]*)<span>/)![1];
    expect(pre2.length).toBeLessThanOrEqual(140);
    expect(long.startsWith(pre2)).toBe(true);
    expect(long[pre2.length]).toBe(' ');
  });

  it('pads the preheader with invisible filler so the preview does not repeat the body opening', async () => {
    const { html } = await sendHtml('<p>Printer on floor 3 is jammed</p>');
    const preheader = html.match(/<div data-alga-preheader="true"[^>]*>([\s\S]*?)<\/div>/)![1];
    expect(preheader.startsWith('Printer on floor 3 is jammed<span>')).toBe(true);
    const filler = preheader.match(/<span>([^<]*)<\/span>/)![1];
    expect(filler.replace(/&zwnj;&nbsp;/g, '')).toBe('');
    expect(filler.length).toBeGreaterThanOrEqual('&zwnj;&nbsp;'.length * 80);
    // Filler and excerpt sit before the token; the parser drops the whole element.
    expect(html.indexOf('</span></div>')).toBeLessThan(html.indexOf('data-alga-reply-token'));
    expect(stripPreheaderElements(html)).not.toContain('&zwnj;');
    expect(stripPreheaderElements(html)).not.toContain('data-alga-preheader');
  });

  it('omits the preheader when the rendered body has no text', async () => {
    const { html } = await sendHtml('<div><br/></div>');
    expect(html).not.toContain('data-alga-preheader');
    expect(html).toContain('data-alga-reply-token');
  });

  it('puts the visible banner after the body in the HTML', async () => {
    const { html } = await sendHtml('<p>Body text</p>');
    const body = html.indexOf('<p>Body text</p>');
    const banner = html.indexOf(`>${BANNER}</p>`);
    expect(body).toBeGreaterThan(-1);
    expect(banner).toBeGreaterThan(body);
    expect(html.split(BANNER).length - 1).toBe(1);
  });

  it('leaves the text part unchanged: banner above body, token lines at the bottom', async () => {
    const { text } = await sendHtml('<p>Body text</p>');
    const token = sendEmail.mock.calls[0][0].replyContext.conversationToken;
    expect(text).toBe(
      `${BANNER}\n\nBody text\n\n[ALGA-REPLY-TOKEN ${token} ticketId=ticket-1 commentId=comment-1 threadId=thread-1]\nALGA-TICKET-ID:ticket-1\nALGA-COMMENT-ID:comment-1\nALGA-THREAD-ID:thread-1`
    );
  });

  it('keeps table cells and block elements apart in the text part (table descriptions)', async () => {
    const { text } = await sendHtml(
      '<div>Description</div><table><tbody><tr><td><strong>Host</strong></td><td>web01</td></tr>' +
        '<tr><td><strong>State</strong></td><td>DOWN</td></tr></tbody></table><p>Ack in Nagios</p>'
    );
    expect(text).toContain('Description Host web01 State DOWN Ack in Nagios');
    expect(text).not.toMatch(/Hostweb01|web01State|StateDOWN/);
  });

  describe('full document shaped like wrapEmailLayout', () => {
    const doc = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><title>Ignored title</title><style>.x{color:red}</style></head>
<body style="margin:0;padding:0;">
<table role="presentation"><tr><td>
  <div style="text-transform:uppercase;">New Ticket Created</div>
  <div style="font-size:22px;">Printer down</div>
  <div style="margin-top:12px;">High priority &middot; Board: Support</div>
  <p>Printer on floor 3 is jammed</p>
  <div>&copy; 2026 Acme MSP &middot; Powered by AlgaPSA</div>
</td></tr></table>
</body>
</html>`;

    it('puts the hidden block right after <body>, before all template content', async () => {
      const { html } = await sendHtml(doc);
      const bodyTag = '<body style="margin:0;padding:0;">';
      const after = html.slice(html.indexOf(bodyTag) + bodyTag.length);
      expect(after.startsWith('<div data-alga-preheader="true"')).toBe(true);
      expect(html.indexOf('data-alga-reply-boundary')).toBeLessThan(html.indexOf('New Ticket Created</div>'));
      expect(html.indexOf('<head>')).toBeLessThan(html.indexOf('data-alga-preheader'));
    });

    it('first visible text is the preheader made of the header label and title lines', async () => {
      const { html } = await sendHtml(doc);
      const body = html.slice(html.indexOf('<body'));
      const first = textNodes(body)[0];
      expect(first).toBe('New Ticket Created Printer down');
      expect(first).not.toContain('Ignored title');
      expect(first).not.toContain('Printer on floor 3');
    });

    it('puts the banner before </body>, after the footer, with nothing after </html>', async () => {
      const { html } = await sendHtml(doc);
      const footer = html.indexOf('Powered by AlgaPSA');
      const banner = html.indexOf(`>${BANNER}</p>`);
      expect(banner).toBeGreaterThan(footer);
      expect(banner).toBeLessThan(html.toLowerCase().lastIndexOf('</body>'));
      expect(html.trimEnd().endsWith('</html>')).toBe(true);
      expect(html.split(BANNER).length - 1).toBe(1);
    });

    it('leaves the text part unchanged', async () => {
      const { text } = await sendHtml(doc);
      const token = sendEmail.mock.calls[0][0].replyContext.conversationToken;
      expect(text.startsWith(`${BANNER}\n\n`)).toBe(true);
      expect(text).toContain('New Ticket Created Printer down High priority');
      expect(text).toContain(`[ALGA-REPLY-TOKEN ${token} ticketId=ticket-1`);
      expect(text).not.toContain('data-alga');
    });
  });
});
