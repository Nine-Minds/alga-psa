import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { getDefaultReplyParserConfig, parseEmailReply } from './replyParser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readFixture(file: string): string {
  return fs.readFileSync(path.join(__dirname, '__fixtures__', file), 'utf8');
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
});
