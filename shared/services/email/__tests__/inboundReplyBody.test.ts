import { describe, expect, it } from 'vitest';

import { parseEmailReply } from '../../../lib/email/replyParser';
import { blocksFromEmailBody } from '../inboundEmbeddedImageUrlRewrite';
import { hasSubstantiveReplyContent, replyBodyForComment, substantiveReplyBody } from '../inboundReplyBody';

// alga-2026-0003353, through the real parser: an old-layout notification quoted by a client
// that wraps it in plain divs. The text side cuts at the banner, the HTML side has neither a
// boundary attribute nor a blockquote, and HTML wins over text — so this is the shape that
// used to store the quoted notification even after the safety-net fix.
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
const quotedHtml = (authored: string) => [
  `<div dir="ltr">${authored}</div>`,
  `<div class="gmail_quote"><div dir="ltr" class="gmail_attr">${ATTRIBUTION} &lt;support@msp.test&gt; wrote:<br></div>`,
  `<div style="display:none;max-height:0;overflow:hidden;">${TOKEN}</div>`,
  '<p>--- Please reply above this line ---</p>',
  '<p>New comment added</p><p>Comment from Dana Tech</p>',
  '<p>Here is where the deployment stands this morning.</p></div>',
].join('');

const LEAKS = ['ALGA-REPLY-TOKEN', 'reply above this line', 'Comment from Dana Tech', 'deployment stands'];

const storedBody = async (body: { text?: string; html?: string }) => {
  const parsed = parseEmailReply({ text: body.text ?? '', html: body.html });
  return JSON.stringify(await blocksFromEmailBody(substantiveReplyBody(parsed, body)));
};

describe('inbound reply body', () => {
  it('keeps an image-only reply as an image block', async () => {
    const body = { html: '<div><img src="https://example.test/screenshot.png"></div>' };
    const parsed = parseEmailReply({ text: '', html: body.html });

    expect(hasSubstantiveReplyContent(parsed, body)).toBe(true);
    expect(await storedBody(body)).toContain('https://example.test/screenshot.png');
    expect(await blocksFromEmailBody(substantiveReplyBody(parsed, body))).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'image' })]),
    );
  });

  it('does not revive a raw image when parsing explicitly suppressed the reply', () => {
    const body = { text: QUOTED_TEXT, html: '<img src="https://example.test/quoted-logo.png">' };
    const parsed = { sanitizedText: '', sanitizedHtml: undefined };

    expect(hasSubstantiveReplyContent(parsed, body)).toBe(false);
    expect(substantiveReplyBody(parsed, body)).toEqual({});
  });

  it.each([
    '<html><body>',
    '<div><br></div>',
    '<div>On Mon, Nov 17, 2026 Dana Tech wrote:</div>',
    '<p>My answer is below.</p><div>On Mon, Nov 17, 2026 Dana Tech wrote:</div>',
  ])(
    'stores an HTML-only bottom reply after %j', async (wrapper) => {
      const answer = 'Yes, Thursday works, please book it.';
      const body = { html: `${wrapper}<div>${TOKEN}</div><p>--- Please reply above this line ---</p><p>Old notification</p><p>${answer}</p>` };
      const parsed = parseEmailReply({ text: '', html: body.html });

      expect(hasSubstantiveReplyContent(parsed, body)).toBe(true);
      expect(await storedBody(body)).toContain(answer);
    },
  );

  it('stores the authored answer and none of the quoted notification', async () => {
    const authored = 'Sounds good, go ahead.';
    for (const body of [
      { text: `${authored}\n\n${QUOTED_TEXT}`, html: quotedHtml(authored) },
      { text: `${authored}\n\n${QUOTED_TEXT}` },
    ]) {
      const stored = await storedBody(body);
      expect(stored).toContain(authored);
      for (const leaked of LEAKS) {
        expect(stored).not.toContain(leaked);
      }
    }
  });

  it('preserves ambiguous HTML-only history when a preface precedes the attribution', async () => {
    // Without a text baseline, the parser cannot know whether the notification ends
    // with an authored answer. Keep the whole HTML even when the preface is substantive.
    const authored = 'Sounds good, go ahead.';
    const body = { html: quotedHtml(authored) };
    const parsed = parseEmailReply({ text: '', html: body.html });

    expect(parsed.appliedHeuristics).not.toContain('html-marker-boundary');
    const stored = await storedBody(body);
    expect(stored).toContain(authored);
    expect(stored).toContain('deployment stands');
  });

  it('stores nothing when the text confirms a reply holds only quoted history', async () => {
    const html = quotedHtml('<br>');
    for (const body of [{ text: QUOTED_TEXT, html }, { text: QUOTED_TEXT }]) {
      const stored = await storedBody(body);
      for (const leaked of LEAKS) {
        expect(stored).not.toContain(leaked);
      }
    }
  });

  it('stores an authored quotation when the safety net falls back to text', async () => {
    const authored = 'The console reports the following error:\n> ACCESS DENIED (code 5)\n'
      + 'Please investigate this failure before attempting another deployment.';
    const body = {
      text: `${authored}\n--- Please reply above this line ---\nOld notification`,
      html: '<p>Console error:</p><blockquote class="gmail_quote"><p>ACCESS DENIED (code 5)</p>'
        + '<p>Please investigate this failure before attempting another deployment.</p></blockquote>',
    };
    const parsed = parseEmailReply(body);

    expect(parsed.appliedHeuristics).toContain('html-trim-rejected');
    expect(parsed.sanitizedHtml).toBeUndefined();
    const stored = await storedBody(body);
    expect(stored).toContain('ACCESS DENIED (code 5)');
    expect(stored).toContain('Please investigate this failure');
    expect(stored).not.toContain('Old notification');
  });

  it('treats an empty parsed reply as empty rather than reading its HTML side', () => {
    // The parser reports an empty reply through sanitizedText; its HTML side may still hold
    // the quoted mail, and a mail with a text part must not be rebuilt from it.
    const parsedEmail = { sanitizedText: '', sanitizedHtml: quotedHtml('') };
    const body = { text: QUOTED_TEXT, html: quotedHtml('') };

    expect(hasSubstantiveReplyContent(parsedEmail, body)).toBe(false);
    expect(substantiveReplyBody(parsedEmail, body)).toEqual({});
    // The selection itself is unchanged: a successful parse still owns both renditions.
    expect(replyBodyForComment(parsedEmail, body)).toEqual({ html: parsedEmail.sanitizedHtml, text: '' });
  });

  it('keeps a body whose trim consumed everything, so the reply is not dropped as empty', async () => {
    // The parser restores the original HTML when its own trim leaves nothing (no text part to
    // fall back to). Without that, the token-only gate read an empty body and skipped the
    // message outright — no comment row, so nothing to recover the mail from either.
    const body = {
      html: '<blockquote type="cite"><p>Our invoice 1234 is wrong, please check the hours.</p></blockquote>',
    };
    const parsedEmail = parseEmailReply({ text: '', html: body.html });

    expect(hasSubstantiveReplyContent(parsedEmail, body)).toBe(true);
    expect(await storedBody(body)).toContain('invoice 1234 is wrong');
  });

  it('falls back to the raw body only when there is no parse result', () => {
    expect(replyBodyForComment(null, { text: 'raw text', html: '<p>raw</p>' })).toEqual({
      text: 'raw text',
      html: '<p>raw</p>',
    });
    expect(replyBodyForComment({ sanitizedText: 'parsed' }, { text: 'raw text' })).toEqual({
      text: 'parsed',
      html: undefined,
    });
  });
});
