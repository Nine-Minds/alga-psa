import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { getDefaultReplyParserConfig, htmlToVisibleText, parseEmailReply } from '../replyParser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readFixture(file: string): string {
  return fs.readFileSync(path.join(__dirname, '..', '__fixtures__', file), 'utf8');
}

describe('replyParser', () => {
  it('honours explicit reply boundaries and extracts hidden tokens', () => {
    const text = readFixture('gmail-top-post.txt');
    const html = readFixture('gmail-top-post.html');

    const result = parseEmailReply({ text, html });

    expect(result.confidence).toBe('high');
    expect(result.strategy).toBe('custom-boundary');
    expect(result.tokens).toEqual({
      conversationToken: 'GHFTK-123',
      ticketId: '8f4e9f72-1d7d-4b3c-94fb-2f8f9ccce901',
      commentId: '6e5874a5-22a9-479d-a20e-052b43165c0d',
    });
    expect(result.appliedHeuristics).toContain('explicit-boundary');
    expect(result.sanitizedText).toMatchInlineSnapshot(`
      "Hi support team,\n\nHappy to confirm the restart worked fine."
    `);
    expect(result.sanitizedHtml).toMatchInlineSnapshot(`
      "<p>Hi support team,</p>\n<p>Happy to confirm the restart worked fine.</p>\n<p>Thanks,<br/>Jane Doe<br/><em>Sent from my iPhone</em></p>"
    `);
  });

  it('removes inline quoted sections but preserves responder notes for Outlook style replies', () => {
    const text = readFixture('outlook-inline.txt');

    const result = parseEmailReply({ text });

    expect(result.confidence).toBe('medium');
    expect(result.appliedHeuristics).toContain('quote-prefix');
    expect(result.sanitizedText).toMatchInlineSnapshot(`
      "Hi Alex,\n\nSee inline below.\n\nSerial: SN-998877."
    `);
  });

  it('keeps user preface while discarding forwarded chains', () => {
    const text = readFixture('forwarded-thread.txt');

    const result = parseEmailReply({ text });

    expect(result.strategy).toMatch(/provider-header|custom-boundary|quoted-block/);
    expect(result.sanitizedText).toMatchInlineSnapshot(`
      "Please see the forwarded ticket below – looks like the customer escalated again."
    `);
  });

  it('strips signatures and confidentiality footers', () => {
    const text = readFixture('signature-heavy.txt');

    const result = parseEmailReply({ text });

    expect(result.sanitizedText).not.toMatch(/Confidentiality Notice/);
    expect(result.appliedHeuristics).toContain('signature-trim');
    expect(result.sanitizedText).toMatchInlineSnapshot(`
      "Hello,\n\nHere is the update you requested. The service has been restored as of 16:45 UTC."
    `);
  });

  it('falls back gracefully when no heuristics match', () => {
    const text = 'Quick confirmation that everything works as expected.';

    const result = parseEmailReply({ text }, getDefaultReplyParserConfig());

    expect(result.strategy).toBe('fallback');
    expect(result.sanitizedText).toMatchInlineSnapshot('"Quick confirmation that everything works as expected."');
  });

  it('keeps content after an inline Outlook elementToProof blockquote (alga0002339)', () => {
    const text = readFixture('outlook-inline-blockquote.txt');
    const html = readFixture('outlook-inline-blockquote.html');

    const result = parseEmailReply({ text, html });

    // The inline quote is the author's own content, not reply history.
    expect(result.appliedHeuristics).not.toContain('html-blockquote-trim');
    expect(result.strategy).toBe('signature-trim');
    expect(result.confidence).not.toBe('high');

    // Everything after the inline blockquote must survive in both renditions.
    expect(result.sanitizedHtml).toContain('I will follow up with you on Friday morning');
    expect(result.sanitizedHtml).toContain('Call the customer back');
    expect(result.sanitizedHtml).toContain('Outlook calendar');
    expect(result.sanitizedHtml).toContain('Teams notifications');
    expect(result.sanitizedHtml).toContain('Mobile push');
    expect(result.sanitizedHtml).toContain('Desktop notifications');
    expect(result.sanitizedHtml).toContain('kept promises are the whole ballgame');
    expect(result.sanitizedText).toContain('I will follow up with you on Friday morning');
    expect(result.sanitizedText).toContain('Call the customer back');
    expect(result.sanitizedText).toContain('kept promises are the whole ballgame');
  });

  it('cuts at the quoted-history blockquote, not an earlier inline one', () => {
    const text = readFixture('inline-then-history.txt');
    const html = readFixture('inline-then-history.html');

    const result = parseEmailReply({ text, html });

    expect(result.appliedHeuristics).toContain('html-blockquote-trim');
    // The inline quote and the text after it are the author's message.
    expect(result.sanitizedHtml).toContain('replacement part ships Monday');
    expect(result.sanitizedHtml).toContain("plan the install for Wednesday");
    // The gmail_quote history block is removed.
    expect(result.sanitizedHtml).not.toContain('has not confirmed a ship date');
    expect(result.sanitizedText).toContain("plan the install for Wednesday");
    expect(result.sanitizedText).not.toContain('has not confirmed a ship date');
  });

  it('trims trailing Apple Mail type="cite" history', () => {
    const text = readFixture('apple-mail-reply.txt');
    const html = readFixture('apple-mail-reply.html');

    const result = parseEmailReply({ text, html });

    expect(result.appliedHeuristics).toContain('html-blockquote-trim');
    expect(result.sanitizedHtml).toContain('The new build fixed the crash on startup');
    expect(result.sanitizedHtml).not.toContain('Please try the new build');
    expect(result.sanitizedText).toContain('The new build fixed the crash on startup');
  });

  it('retains the answer in a bottom-posted reply below a quoted block', () => {
    const text = readFixture('bottom-post-reply.txt');
    const html = readFixture('bottom-post-reply.html');

    const result = parseEmailReply({ text, html });

    // The quoted block is removed as a span; the authored answer below it survives.
    expect(result.sanitizedHtml).toContain('10pm Eastern');
    expect(result.sanitizedHtml).not.toContain('Could you confirm the maintenance window');
    expect(result.sanitizedText).toContain('10pm Eastern');
    expect(result.sanitizedText).not.toContain('Could you confirm the maintenance window');
  });

  it('recovers tokens wrapped/quoted by Gmail', () => {
    const text = `let's see if replies work now
*Robert Isaacs* | *CEO*
2963 Gulf to Bay Blvd. Clearwater, FL | 727-591-7436


On Thu, Nov 20, 2025 at 7:58 AM Software <support@nineminds.com> wrote:

> [ALGA-REPLY-TOKEN a83113b5-d30f-4ec9-85ce-0d0ce95fa49a
> ticketId=a5ea2cf5-f572-436c-b485-9b5ca07a9e17
> commentId=3de1cc6a-8d4a-4b3c-9a27-72990ab84226]
> --- Please reply above this line ---
>
> --- Please reply above this line ---
> New Comment Added
`;

    const result = parseEmailReply({ text });

    expect(result.tokens).toEqual({
      conversationToken: 'a83113b5-d30f-4ec9-85ce-0d0ce95fa49a',
      ticketId: 'a5ea2cf5-f572-436c-b485-9b5ca07a9e17',
      commentId: '3de1cc6a-8d4a-4b3c-9a27-72990ab84226',
    });
  });

  describe('HTML-only replies (N3)', () => {
    it('htmlToVisibleText exposes the visible text of an HTML-only body', () => {
      expect(htmlToVisibleText('<div>Thanks, <b>fixed</b>.</div>').trim()).toBe('Thanks, fixed .');
    });

    it.each([
      ['&nbsp;-only', '<div>&nbsp;</div><p>&nbsp;&nbsp;</p>'],
      ['whitespace-only', '<div>  </div>\n<br>'],
    ])('treats a %s HTML body as empty visible text', (_label, html) => {
      expect(htmlToVisibleText(html).trim()).toBe('');
    });

    it('cuts HTML at the boundary tag so no unterminated tag survives', () => {
      const config = getDefaultReplyParserConfig();
      const html =
        '<p>My answer</p><div class="quote" ' + config.htmlBoundaryAttribute + '="1"><p>Quoted history</p></div>';

      const result = parseEmailReply({ text: '', html });

      expect(result.sanitizedHtml).toBe('<p>My answer</p>');
      expect(result.sanitizedHtml).not.toMatch(/<[^>]*$/);
    });
  });

  // A successful parse owns the stored comment body (shared/services/email/inboundReplyBody.ts),
  // so the parser is the only place left that can keep a trim from storing nothing at all. The
  // text fallback above restores the text side; HTML-only mail has no text side to restore.
  describe('a trim that consumes the whole body', () => {
    it('restores the original HTML when a reply arrives entirely inside a quote', () => {
      const result = parseEmailReply({
        text: '',
        html: '<blockquote type="cite"><p>Our invoice 1234 is wrong, please check the hours.</p></blockquote>',
      });

      expect(result.sanitizedHtml).toContain('invoice 1234 is wrong');
      expect(result.appliedHeuristics).toContain('html-restore-original');
      expect(result.warnings).toContain('Reply heuristics yielded empty body; using original HTML.');
    });

    it('restores the original HTML when the trailing signature trim empties it too', () => {
      const result = parseEmailReply({
        text: '',
        html: '<blockquote class="gmail_quote"><p>Please confirm the hours on invoice 1234.</p></blockquote>'
          + '<div>Thanks,</div><div>Jane</div>',
      });

      expect(htmlToVisibleText(result.sanitizedHtml ?? '')).toContain('Jane');
    });

    it('closes the paragraph above a banner that follows it as plain text', () => {
      const result = parseEmailReply({
        text: '',
        html: '<p>Yes, Thursday works, please book it.</p>--- Please reply above this line ---'
          + '<div>New comment added</div>',
      });

      expect(result.sanitizedHtml).toContain('</p>');
      expect(htmlToVisibleText(result.sanitizedHtml ?? '')).toContain('Yes, Thursday works, please book it.');
      expect(htmlToVisibleText(result.sanitizedHtml ?? '')).not.toContain('New comment added');
    });

    it('keeps the answer of an HTML-only reply below an old-layout notification', () => {
      const result = parseEmailReply({
        text: '',
        html: '<div style="display:none;max-height:0;overflow:hidden;">[ALGA-REPLY-TOKEN bottom-token'
          + ' ticketId=11111111-2222-3333-4444-555555555555]</div>'
          + '<div>--- Please reply above this line ---</div><div>New comment added</div>'
          + '<div>Yes, Thursday works, please book it.</div>',
      });

      expect(htmlToVisibleText(result.sanitizedHtml ?? '')).toContain('Yes, Thursday works, please book it.');
    });

    it('leaves an empty reply to our own notification empty', () => {
      const result = parseEmailReply({
        text: '[ALGA-REPLY-TOKEN empty-token ticketId=ticket-1]\n--- Please reply above this line ---\nNew comment added',
      });

      expect(result.sanitizedText).toBe('');
      expect(result.appliedHeuristics).not.toContain('html-restore-original');
    });
  });
});
