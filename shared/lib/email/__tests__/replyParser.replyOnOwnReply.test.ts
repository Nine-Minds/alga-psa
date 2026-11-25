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

    it('leaves nothing of the notification when the text confirms the reply is empty', () => {
      const html = QUOTED_HTML.replace('<div dir="ltr">ANSWER</div>', '<div dir="ltr"><br></div>');

      for (const input of [{ text: QUOTED_TEXT, html }, { text: QUOTED_TEXT }]) {
        expectNoNotification(parseEmailReply(input));
      }
    });

    it('preserves ambiguous legacy HTML when only an attribution precedes the marker', () => {
      const html = QUOTED_HTML.replace('<div dir="ltr">ANSWER</div>', '<div dir="ltr"><br></div>');
      // With no text part or quoted blockquote, the parser cannot distinguish the final
      // paragraph of a notification from an authored bottom reply. Preserve too much.
      const result = parseEmailReply({ text: '', html });

      expect(result.sanitizedHtml).toBe(html);
      expect(result.appliedHeuristics).not.toContain('html-marker-boundary');
    });

    it.each([
      '<p>See my answer below.</p>',
      '<p>My answer is below.</p><div>On Mon, Nov 17, 2026 Dana Tech wrote:</div>',
      '<div>My answer is below.<br>On Mon, Nov 17, 2026 Dana Tech wrote:</div>',
      '<p>My answer is below.</p><div>On Mon, Nov 17, 2026 Dana Tech &lt;<br>dana@msp.test&gt; wrote:</div>',
    ])('preserves an HTML-only bottom answer with preface %j', (prefix) => {
      const answer = 'No, do not restart it. Payroll is still running.';
      const html = prefix + `<div style="display:none">${TOKEN}</div>`
        + '<p>--- Please reply above this line ---</p><p>New comment added</p>'
        + `<p>${answer}</p>`;
      const result = parseEmailReply({ text: '', html });

      expect(htmlToVisibleText(result.sanitizedHtml ?? '')).toContain(answer);
      expect(result.appliedHeuristics).not.toContain('html-marker-boundary');
    });

    it.each(['', 'See my answer below.'])('preserves a multipart bottom answer with preface %j', (preface) => {
      const answer = 'No, do not restart it. Payroll is still running.';
      const text = `${preface}\n\n${QUOTED_TEXT}\n\n${answer}`;
      const html = QUOTED_HTML.replace('ANSWER', preface) + `<p>${answer}</p>`;
      const result = parseEmailReply({ text, html });

      expect(result.sanitizedText).toContain(answer);
      expect(htmlToVisibleText(result.sanitizedHtml ?? '')).toContain(answer);
      expect(result.appliedHeuristics).not.toContain('html-marker-boundary');
      expect(result.appliedHeuristics).not.toContain('explicit-boundary');
      expect(result.appliedHeuristics).toContain('legacy-boundary-ambiguous');
      expect(result.warnings).toContain('Legacy reply marker has no confirmed trailing quote; preserving the body.');
      expect(result.confidence).not.toBe('high');
    });

    it('preserves a multipart bottom answer when the notification has no quote prefixes', () => {
      const answer = 'No, do not restart it. Payroll is still running.';
      const text = `See my answer below.\n\n${QUOTED_TEXT.replace(/^> ?/gm, '')}\n\n${answer}`;
      const html = QUOTED_HTML.replace('ANSWER', 'See my answer below.') + `<p>${answer}</p>`;
      const result = parseEmailReply({ text, html });

      expect(result.sanitizedText).toContain(answer);
      expect(htmlToVisibleText(result.sanitizedHtml ?? '')).toContain(answer);
      expect(result.appliedHeuristics).not.toContain('html-marker-boundary');
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

  it.each([false, true])('preserves an unattributed trailing quotation (HTML trim rejected: %j)', (withHtml) => {
    const text = readFixture('authored-trailing-quotation.txt');
    const authored = text.split('\n\n--- Please reply above this line ---')[0];
    const result = parseEmailReply({
      text,
      ...(withHtml ? {
        html: '<p>The deployment failed with this error:</p><blockquote class="gmail_quote">'
          + '<p>ACCESS DENIED (code 5). The service account cannot access the deployment share.</p>'
          + '<p>Retry failed. No machines were updated.</p></blockquote>',
      } : {}),
    });

    expect(result.sanitizedText).toBe(authored);
    expect(result.appliedHeuristics).not.toContain('quote-prefix');
    if (withHtml) {
      expect(result.sanitizedHtml).toBeUndefined();
      expect(result.appliedHeuristics).toContain('html-trim-rejected');
    }
  });

  it.each(['Subject: Deployment failure', 'From: Deployment service', 'Sent: Monday', 'To: Support', 'Cc: Operations'])(
    'preserves a trailing error quotation introduced by an isolated %s field',
    (field) => {
      const fixture = readFixture('authored-trailing-quotation.txt');
      for (const prefix of [field, `Deployment details:\n> ${field}`]) {
        const text = fixture.replace('The deployment failed with this error:', prefix);
        const result = parseEmailReply({ text });

        expect(result.sanitizedText).toBe(text.split('\n\n--- Please reply above this line ---')[0]);
        expect(result.appliedHeuristics).not.toContain('quote-prefix');
      }
    },
  );

  it.each([
    'Here is what the deployment script wrote:',
    'The service account wrote:',
    'On startup the deployment script wrote:',
    'On Tuesday the service account wrote:',
    'On startup at 09:15 the deployment script wrote:',
    'On Nov 17 the deployment script wrote:',
    'On Nov 17 at 09:15 the deployment script wrote:',
    'On Mon, Nov 17, 2026 Dana Tech wrote:',
    'On Nov 17 I emailed jane.client@example.com about the invoice.\nShe wrote:',
    'On Tuesday I emailed jane.client@example.com about the invoice.\nShe wrote:',
    'Le 17 novembre le script a écrit :',
    'Am 17. November schrieb das Skript:',
    'El 17 de noviembre el script escribió:',
    'On 17. November das Skript schrieb:',
  ])('preserves a trailing authored quotation introduced by %s', (introduction) => {
    const fixture = readFixture('authored-trailing-quotation.txt');
    for (const prefix of [
      introduction,
      `Deployment details:\n${introduction}`,
      `Deployment details:\n> ${introduction.replace(/\n/g, '\n> ')}`,
    ]) {
      const text = fixture.replace('The deployment failed with this error:', prefix);
      const result = parseEmailReply({ text });

      expect(result.sanitizedText).toBe(text.split('\n\n--- Please reply above this line ---')[0]);
      expect(result.appliedHeuristics).not.toContain('quote-prefix');
    }
  });

  it.each([
    'Le 17 novembre 2026 Jane Client <jane.client@example.test> a écrit :',
    'Am 17. November 2026 schrieb Jane Client <jane.client@example.test>:',
    'El 17 de noviembre de 2026 Jane Client <jane.client@example.test> escribió:',
    'On 17. November 2026 Jane Client <jane.client@example.test> schrieb:',
  ])('still strips localized provider attribution %s', (attribution) => {
    for (const prefix of ['', '> ']) {
      const result = parseEmailReply({
        text: `Please investigate.\n${prefix}${attribution}\n> Previous reply\n`
          + '> More history\n\n--- Please reply above this line ---\nOld notification',
      });

      expect(result.sanitizedText).toBe('Please investigate.');
      expect(result.appliedHeuristics).toContain(prefix ? 'quote-prefix' : 'provider-header');
    }
  });

  it.each(['-----Original Message-----', 'Begin forwarded message:', 'Forwarded message', ''])(
    'preserves a pasted report and subsequent instructions with separator %j above the boundary', (header) => {
      const text = readFixture('authored-forwarded-report.txt').replace('-----Original Message-----\n', header ? `${header}\n` : '');
      const result = parseEmailReply({ text });

      expect(result.sanitizedText).toBe(text.split('\n\n--- Please reply above this line ---')[0]);
      expect(result.appliedHeuristics).not.toContain('forwarded-header');
      expect(result.appliedHeuristics).not.toContain('provider-header');
    },
  );

  it.each(['', '> '])('still strips a provider attribution with prefix %j above the explicit boundary', (prefix) => {
    // A timestamp and display name alone remain ambiguous above our boundary;
    // the sender address distinguishes this provider attribution from authored prose.
    const result = parseEmailReply({
      text: `Please investigate.\n${prefix}On Mon, Nov 17, 2026 Dana Tech <dana@example.test> wrote:\n`
        + '> Previous reply\n\n--- Please reply above this line ---\nOld notification',
    });

    expect(result.sanitizedText).toBe('Please investigate.');
    expect(result.appliedHeuristics).toContain(prefix ? 'quote-prefix' : 'provider-header');
  });

  it('still strips a quoted coherent envelope above the explicit boundary', () => {
    const result = parseEmailReply({
      text: 'Please investigate.\n> From: Client <client@example.test>\n> Sent: Monday\n'
        + '> To: Support <support@example.test>\n> Subject: Deployment failure\n'
        + '> Previous reply\n\n--- Please reply above this line ---\nOld notification',
    });

    expect(result.sanitizedText).toBe('Please investigate.');
    expect(result.appliedHeuristics).toContain('quote-prefix');
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
