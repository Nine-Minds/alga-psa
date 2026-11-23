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
});
