import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { htmlToVisibleText, parseEmailReply, stripPreheaderElements } from '../replyParser';

// NOTE: these fixtures are hand-built imitations of each client's quoting, not captures
// from real mail clients.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const readFixture = (file: string) => fs.readFileSync(path.join(__dirname, '..', '__fixtures__', file), 'utf8');

const TOKENS = {
  conversationToken: 'NEWLAYOUT-TOKEN-7',
  ticketId: '5b0f3c2e-8a41-4d6e-9c57-1e2d3f4a5b6c',
  commentId: 'c1d2e3f4-0a1b-4c2d-8e3f-9a0b1c2d3e4f',
};
const USER_TEXT = 'Confirmed, the technician fixed the printer.';
const EXCERPT = 'dispatched a technician';

const cases: Array<[string, string]> = [
  ['Gmail (gmail_quote)', 'new-layout-gmail-reply'],
  ['Outlook (divRplyFwdMsg)', 'new-layout-outlook-reply'],
  ['Apple Mail (blockquote type=cite)', 'new-layout-apple-mail-reply'],
  ['boundary removed by client', 'new-layout-boundary-stripped-reply'],
  ['old layout (token text in div, banner first)', 'old-layout-token-text-reply'],
];

describe('replyParser with preheader / textless token layout', () => {
  // Leftover quote-header lines ("On ... wrote:", Outlook From:/Sent: block) after an explicit
  // boundary are existing parser behaviour and identical for the old layout; they are
  // allowed here, but the excerpt, banner and token text never are.
  it.each(cases)('%s: extracts tokens; parsed reply has the user text and no excerpt, banner or token text', (_label, base) => {
    const result = parseEmailReply({ text: readFixture(`${base}.txt`), html: readFixture(`${base}.html`) });

    expect(result.tokens).toMatchObject(TOKENS);
    expect(result.sanitizedText.startsWith(USER_TEXT)).toBe(true);
    for (const leaked of [EXCERPT, 'reply above this line', 'ALGA-REPLY-TOKEN']) {
      expect(result.sanitizedText).not.toContain(leaked);
      expect(result.sanitizedHtml ?? '').not.toContain(leaked);
    }
    expect(result.sanitizedHtml ?? '').not.toContain('data-alga-preheader');
    if (result.sanitizedHtml) expect(htmlToVisibleText(result.sanitizedHtml)).toContain(USER_TEXT);
  });

  it('boundary removed by client: reply text is exactly the user text', () => {
    const base = 'new-layout-boundary-stripped-reply';
    const result = parseEmailReply({ text: readFixture(`${base}.txt`), html: readFixture(`${base}.html`) });
    expect(result.sanitizedText).toBe(USER_TEXT);
  });

  it('boundary removed by client, HTML only: preheader excerpt is not pulled into the reply', () => {
    const html = readFixture('new-layout-boundary-stripped-reply.html');
    const result = parseEmailReply({ text: '', html });
    expect(result.tokens).toMatchObject(TOKENS);
    expect(result.sanitizedHtml).not.toContain(EXCERPT);
    expect(htmlToVisibleText(result.sanitizedHtml ?? '')).not.toContain(EXCERPT);
  });

  it('new layout yields the same parsed HTML text as the old layout for the same client quoting', () => {
    const parse = (base: string) =>
      parseEmailReply({ text: readFixture(`${base}.txt`), html: readFixture(`${base}.html`) });
    const next = parse('new-layout-gmail-reply');
    const old = parse('old-layout-token-text-reply');
    expect(next.sanitizedText).toBe(old.sanitizedText);
    expect(htmlToVisibleText(next.sanitizedHtml ?? '')).toBe(htmlToVisibleText(old.sanitizedHtml ?? ''));
    expect(next.tokens).toMatchObject(old.tokens!);
  });

  it('resolves tokens from the textless token div attributes when only HTML arrives', () => {
    const html = readFixture('new-layout-gmail-reply.html');
    const result = parseEmailReply({ text: '', html });
    expect(result.tokens).toMatchObject(TOKENS);
    expect(htmlToVisibleText(result.sanitizedHtml ?? '')).toContain(USER_TEXT);
    expect(htmlToVisibleText(result.sanitizedHtml ?? '')).not.toContain(EXCERPT);
  });

  it('falls back to the text part bottom token lines when the client stripped data-* attributes', () => {
    const html = readFixture('new-layout-gmail-reply.html').replace(/ data-alga-[a-z-]+="[^"]*"/g, '');
    const result = parseEmailReply({ text: readFixture('new-layout-gmail-reply.txt'), html });
    expect(result.tokens).toMatchObject(TOKENS);
  });

  it('stripPreheaderElements removes the element with its content, including nested markup', () => {
    expect(stripPreheaderElements('<p>a</p><div data-alga-preheader="true" style="x"><div>in</div> ner</div><p>b</p>')).toBe(
      '<p>a</p><p>b</p>',
    );
    expect(stripPreheaderElements('<p>nothing</p>')).toBe('<p>nothing</p>');
  });

  it('htmlToVisibleText ignores the preheader excerpt', () => {
    expect(htmlToVisibleText('<div data-alga-preheader="true">excerpt text</div><p>Body</p>').trim()).toBe('Body');
  });

  it('handles a quoted full document whose hidden block sits right after <body>', () => {
    const block = readFixture('new-layout-gmail-reply.html').match(/<div data-alga-preheader[\s\S]*?reply-boundary="true"[^>]*><\/div>/)![0];
    const html = `<div dir="ltr">${USER_TEXT}</div><br><div class="gmail_quote"><blockquote class="gmail_quote"><html><body style="margin:0">${block}<table><tr><td><div>NEW TICKET</div><p>${EXCERPT} body</p></td></tr></table><p>--- Please reply above this line ---</p></body></html></blockquote></div>`;
    const result = parseEmailReply({ text: '', html });
    expect(result.tokens).toMatchObject(TOKENS);
    expect(htmlToVisibleText(result.sanitizedHtml ?? '').trim()).toBe(USER_TEXT);
    expect(result.sanitizedHtml).not.toContain('data-alga-preheader');
  });
});
