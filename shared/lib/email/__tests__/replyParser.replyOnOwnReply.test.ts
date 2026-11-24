import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { htmlToVisibleText, parseEmailReply } from '../replyParser';

// Hand-built imitation of the Gmail reply captured on ticket alga-2026-0003353: a contact
// replying to their own earlier reply, whose quoted history still carries the pre-2026-11-15
// notification layout (token text in a hidden div, banner, layout tables, list, link).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const readFixture = (file: string) => fs.readFileSync(path.join(__dirname, '..', '__fixtures__', file), 'utf8');

const AUTHORED = 'Thursday afternoon works for us. Please go ahead and book it.';
const PREVIOUS_REPLY = 'still sealed in the shipping box';
const NOTIFICATION_TEXT = [
  'Laptop deployment for the new hires',
  'Comment from Dana Tech',
  'Here is where the deployment stands this morning',
  'Image the two new laptops with the standard build',
  'Enroll both machines in Intune before delivery',
  'docs.example.test/runbooks/laptop-imaging',
  'In Progress',
];

const parseFixture = () =>
  parseEmailReply({
    text: readFixture('gmail-reply-own-reply.txt'),
    html: readFixture('gmail-reply-own-reply.html'),
  });

describe('Gmail reply to the contact’s own reply (alga-2026-0003353)', () => {
  it('still recovers the reply token wrapped across quoted lines', () => {
    expect(parseFixture().tokens).toMatchObject({
      conversationToken: 'OWNREPLY-TOKEN-11',
      ticketId: '7c1d9f20-5e84-4c11-9b3a-6d2f8ab41c57',
      commentId: '2f6b4d18-91ac-4e73-bd25-0ac7f1e3b984',
    });
  });

  it('keeps the HTML trim instead of discarding it as a false positive', () => {
    const result = parseFixture();

    // The safety net used to reject this trim because the text side still held a quote
    // level the HTML side had already removed; the consumer then stored the whole mail.
    expect(result.warnings).not.toContain(
      'HTML blockquote trim removed significantly more content than text heuristics; using text result.',
    );
    expect(result.appliedHeuristics).toContain('html-blockquote-trim');
    expect(result.appliedHeuristics).not.toContain('html-trim-rejected');
    expect(result.sanitizedHtml).toBeDefined();
  });

  it('stores the authored lines only, with no quoted history in either rendition', () => {
    const result = parseFixture();
    const htmlText = htmlToVisibleText(result.sanitizedHtml ?? '');

    expect(result.sanitizedText).toBe(AUTHORED);
    expect(htmlText).toContain(AUTHORED);

    for (const rendition of [result.sanitizedText, result.sanitizedHtml ?? '', htmlText]) {
      expect(rendition).not.toContain('[ALGA-REPLY-TOKEN');
      expect(rendition).not.toContain('Please reply above this line');
      expect(rendition).not.toContain(PREVIOUS_REPLY);
      for (const leaked of NOTIFICATION_TEXT) {
        expect(rendition).not.toContain(leaked);
      }
    }

    // No quoted-line prefixes or wrapped Gmail attribution survive in the text rendition.
    expect(result.sanitizedText).not.toMatch(/^>/m);
    expect(result.sanitizedText).not.toMatch(/wrote:/);

    // The attribution line ahead of the cut blockquote stays in the HTML. That is existing
    // behaviour for every client's quoting (see replyParser.newLayout.test.ts) and is the only
    // remnant left: one line of quote furniture rather than the whole history.
    expect(htmlText.replace(/^On Mon, .*wrote:$/m, '').trim()).toBe(AUTHORED);
  });

  // Outlook, and Gmail for some mail, quote in plain divs: the HTML side gets neither the
  // boundary attribute (absent from notifications sent before 2026-11-15) nor a blockquote,
  // so it used to keep the whole notification while the text side cut at the banner. HTML is
  // preferred over text, so that untrimmed HTML was what the comment stored.
  describe('an old-layout notification quoted without a blockquote', () => {
    const TOKEN = '[ALGA-REPLY-TOKEN OWNREPLY-TOKEN-11]';
    const ATTRIBUTION = 'On Mon, Nov 17, 2026 at 7:15 AM MSP Support';
    const QUOTED_TEXT = [
      `${ATTRIBUTION} <support@msp.test> wrote:`,
      '',
      `> ${TOKEN}`,
      '> --- Please reply above this line ---',
      '>',
      '> NEW COMMENT ADDED',
      '> Comment from Dana Tech',
      '> Here is where the deployment stands this morning.',
    ].join('\n');
    const QUOTED_HTML = [
      '<div dir="ltr">ANSWER</div>',
      `<div class="gmail_quote"><div dir="ltr" class="gmail_attr">${ATTRIBUTION} &lt;support@msp.test&gt; wrote:<br></div>`,
      `<div style="display:none;max-height:0;overflow:hidden;">${TOKEN}</div>`,
      '<p>--- Please reply above this line ---</p>',
      '<p>New comment added</p><p>Comment from Dana Tech</p>',
      '<p>Here is where the deployment stands this morning.</p></div>',
    ].join('');
    const leaks = ['[ALGA-REPLY-TOKEN', 'reply above this line', 'Comment from Dana Tech', 'deployment stands'];

    const expectNoNotification = (result: { sanitizedText: string; sanitizedHtml?: string }) => {
      for (const rendition of [result.sanitizedText, htmlToVisibleText(result.sanitizedHtml ?? '')]) {
        for (const leaked of leaks) {
          expect(rendition).not.toContain(leaked);
        }
      }
    };

    it('cuts the HTML at our own marker when there is nothing else to cut at', () => {
      const result = parseEmailReply({
        text: `Sounds good, go ahead.\n\n${QUOTED_TEXT}`,
        html: QUOTED_HTML.replace('ANSWER', 'Sounds good, go ahead.'),
      });

      expect(result.appliedHeuristics).toContain('html-marker-boundary');
      expect(htmlToVisibleText(result.sanitizedHtml ?? '')).toContain('Sounds good, go ahead.');
      expect(result.sanitizedText).toBe('Sounds good, go ahead.');
      expectNoNotification(result);
    });

    it('leaves nothing of the notification when the reply itself is empty', () => {
      const html = QUOTED_HTML.replace('<div dir="ltr">ANSWER</div>', '<div dir="ltr"><br></div>');

      for (const input of [{ text: QUOTED_TEXT, html }, { text: QUOTED_TEXT }, { text: '', html }]) {
        expectNoNotification(parseEmailReply(input));
      }
    });
  });

  it('keeps rejecting an HTML trim that genuinely destroys authored content', () => {
    const authored = [
      'Here is the full context the install team asked for this morning.',
      'The two laptops arrived on Friday and are still in their shipping boxes.',
      'Our office manager can be on site any afternoon except Wednesday.',
      'Please confirm which window you want and we will unlock the server room.',
    ].join('\n\n');
    const result = parseEmailReply({
      text: authored,
      html: `<div>Here is the full context the install team asked for this morning.</div><blockquote class="gmail_quote"><p>${authored}</p></blockquote>`,
    });

    expect(result.warnings).toContain(
      'HTML blockquote trim removed significantly more content than text heuristics; using text result.',
    );
    expect(result.appliedHeuristics).toContain('html-trim-rejected');
    expect(result.sanitizedHtml).toBeUndefined();
    expect(result.sanitizedText).toContain('Please confirm which window you want');
  });

  it.each(['', '\n--- Please reply above this line ---\nOld notification'])(
    'rejects a trim that removes an inline answer, with boundary %j',
    (boundary) => {
      const answer = 'Yes please, two monitors for each desk. Please send the revised quote before ordering, '
        + 'and arrange delivery on Thursday afternoon when our office manager can let the installers in.';
      const result = parseEmailReply({
        text: `Answers inline.\nOn Mon, Nov 17, 2026 Dana Tech wrote:\n> Do you want monitors?\n${answer}${boundary}`,
        html: `<p>Answers inline.</p><blockquote class="gmail_quote"><p>Do you want monitors?</p><p>${answer}</p></blockquote>`,
      });

      expect(result.sanitizedText).toContain(answer);
      expect(result.sanitizedHtml).toBeUndefined();
      expect(result.appliedHeuristics).toContain('html-trim-rejected');
      expect(result.warnings).toContain(
        'HTML blockquote trim removed significantly more content than text heuristics; using text result.',
      );
    },
  );
});
