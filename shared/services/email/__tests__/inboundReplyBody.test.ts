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
  it('stores the authored answer and none of the quoted notification', async () => {
    const authored = 'Sounds good, go ahead.';
    for (const body of [
      { text: `${authored}\n\n${QUOTED_TEXT}`, html: quotedHtml(authored) },
      { text: `${authored}\n\n${QUOTED_TEXT}` },
      { html: quotedHtml(authored) },
    ]) {
      const stored = await storedBody(body);
      expect(stored).toContain(authored);
      for (const leaked of LEAKS) {
        expect(stored).not.toContain(leaked);
      }
    }
  });

  it('stores nothing of a reply that holds only quoted history', async () => {
    const html = quotedHtml('<br>');
    for (const body of [{ text: QUOTED_TEXT, html }, { text: QUOTED_TEXT }, { html }]) {
      const stored = await storedBody(body);
      for (const leaked of LEAKS) {
        expect(stored).not.toContain(leaked);
      }
    }
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
