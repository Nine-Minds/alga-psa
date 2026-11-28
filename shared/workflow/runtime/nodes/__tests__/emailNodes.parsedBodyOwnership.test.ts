import { describe, expect, it, vi } from 'vitest';

import { parseEmailBodyWithFallback } from '../utils/emailNodes';

// The v2 workflow feeds this node's output straight into create_comment_from_parsed_email,
// so whatever it hands back is the stored comment. A successful parse has to own that body:
// the whole point of the reply parser is to keep quoted history out of it (alga-2026-0003353).
const QUOTED_MAIL = [
  '[ALGA-REPLY-TOKEN OWNREPLY-TOKEN-11]',
  '--- Please reply above this line ---',
  '',
  'NEW COMMENT ADDED',
  '',
  'Comment from Dana Tech',
  'Here is where the deployment stands this morning.',
].join('\n');

const callActionFor = (parsed: unknown, success = true) =>
  vi.fn(async (actionId: string) => {
    expect(actionId).toBe('parse_email_reply');
    return { success, parsed };
  });

describe('parseEmailBodyWithFallback body ownership', () => {
  it('keeps an empty parse empty instead of reviving the quoted mail', async () => {
    const callAction = callActionFor({
      sanitizedText: '',
      sanitizedHtml: undefined,
      confidence: 'high',
      strategy: 'custom-boundary',
      appliedHeuristics: ['token-strip', 'explicit-boundary'],
      warnings: [],
    });

    const result = await parseEmailBodyWithFallback(callAction, { text: QUOTED_MAIL, html: undefined });

    expect(result.sanitizedText).toBe('');
    expect(result.sanitizedHtml).toBeUndefined();
    expect(result.sanitizedText).not.toContain('[ALGA-REPLY-TOKEN');
    expect(result.sanitizedText).not.toContain('Comment from Dana Tech');
  });

  it('uses the parsed text when the safety net rejected the HTML trim', async () => {
    const callAction = callActionFor({
      sanitizedText: 'Thursday afternoon works for us.',
      sanitizedHtml: undefined,
      confidence: 'high',
      strategy: 'custom-boundary',
      appliedHeuristics: ['html-blockquote-trim', 'html-trim-rejected'],
      warnings: ['HTML blockquote trim removed significantly more content than text heuristics; using text result.'],
    });

    const result = await parseEmailBodyWithFallback(callAction, {
      text: `Thursday afternoon works for us.\n\n${QUOTED_MAIL}`,
      html: `<div>Thursday afternoon works for us.</div><blockquote>${QUOTED_MAIL}</blockquote>`,
    });

    expect(result.sanitizedText).toBe('Thursday afternoon works for us.');
    expect(result.sanitizedHtml).toBeUndefined();
    expect((result.metadata.parser as any).heuristics).toContain('html-trim-rejected');
  });

  it('still falls back to the raw body when the parser is unavailable', async () => {
    const callAction = callActionFor(null, false);

    const result = await parseEmailBodyWithFallback(callAction, { text: QUOTED_MAIL, html: undefined });

    expect(result.sanitizedText).toBe(QUOTED_MAIL);
    expect(result.confidence).toBe('low');
    expect((result.metadata.parser as any).warnings).toContain('parser-unavailable');
  });
});
