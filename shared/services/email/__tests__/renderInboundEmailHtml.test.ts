import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import knexLib from 'knex';
import { simpleParser } from 'mailparser';

import { normalizeRfc822MessageId } from '../inboundEmailIdentity';
import { INBOUND_MIME_PARSE_OPTIONS } from '../inboundMimeParseOptions';
import {
  buildInboundEmailHtmlFromMime,
  whereInboundEmailArtifactMessageId,
} from '../renderInboundEmailHtml';

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';

function buildMime(parts: string[]): Buffer {
  return Buffer.from(parts.join('\r\n'));
}

function buildHtmlMime(html: string, messageId = '<formatted@example.test>'): Buffer {
  return buildMime([
    'From: Sender <sender@example.test>',
    'To: support@example.test',
    'Subject: Formatted reply',
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset="utf-8"',
    '',
    html,
    '',
  ]);
}

function buildInlineImageMime(): Buffer {
  const boundary = 'related-boundary';
  return buildMime([
    'From: Sender <sender@example.test>',
    'To: support@example.test',
    'Subject: Screenshot',
    'Message-ID: <inline-image@example.test>',
    'MIME-Version: 1.0',
    `Content-Type: multipart/related; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="utf-8"',
    '',
    '<p>See below</p><img src="cid:logo-1" alt="Logo">',
    `--${boundary}`,
    'Content-Type: image/png',
    'Content-Transfer-Encoding: base64',
    'Content-ID: <logo-1>',
    'Content-Disposition: inline; filename="logo.png"',
    '',
    PNG_BASE64,
    `--${boundary}--`,
    '',
  ]);
}

describe('buildInboundEmailHtmlFromMime', () => {
  it('points inline cid: images at the documents already persisted for them', async () => {
    const html = await buildInboundEmailHtmlFromMime(buildInlineImageMime(), [
      {
        source: 'cid',
        reference: '<LOGO-1>',
        fileId: 'file-1',
        documentId: 'document-1',
        url: '/api/documents/view/file-1',
      },
    ]);

    expect(html).toContain('src="/api/documents/view/file-1"');
    expect(html).not.toContain('cid:logo-1');
    // keepCidLinks must hold: a base64 data URL here would mean the parse
    // options drifted from ingest and the inline part got inlined twice.
    expect(html).not.toContain('data:image/png;base64,');
  });

  it('keeps sender formatting but strips scripts and event handlers', async () => {
    const html = await buildInboundEmailHtmlFromMime(
      buildHtmlMime(
        '<table style="border:1px solid #333"><tr><td bgcolor="#eee">Cell</td></tr></table>'
          + '<script>alert(1)</script>'
          + '<img src="https://img.example.test/x.png" onerror="alert(2)">'
          + '<p onclick="alert(3)">Clickable</p>'
      )
    );

    expect(html).toContain('<table style="border:1px solid #333">');
    expect(html).toContain('bgcolor="#eee"');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(1)');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('onclick');
    expect(html).toContain('Clickable');
  });

  it('falls back to the text part rendered as HTML when there is no HTML part', async () => {
    const html = await buildInboundEmailHtmlFromMime(
      buildMime([
        'From: Sender <sender@example.test>',
        'To: support@example.test',
        'Subject: Plain reply',
        'Message-ID: <plain@example.test>',
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset="utf-8"',
        '',
        'First line',
        '',
        'Second paragraph',
        '',
      ])
    );

    expect(html).toContain('First line');
    expect(html).toContain('Second paragraph');
    expect(html).toContain('<p>');
  });

  it('opens links in a new tab without handing them window.opener', async () => {
    const html = await buildInboundEmailHtmlFromMime(
      buildHtmlMime('<a href="https://example.test/docs" target="_self" rel="opener">Docs</a>')
    );

    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain('target="_self"');
    expect(html).not.toContain('rel="opener"');
    expect(html).toContain('href="https://example.test/docs"');
  });

  it('keeps a link whose query string contains an unescaped angle bracket intact', async () => {
    const html = await buildInboundEmailHtmlFromMime(
      buildHtmlMime('<a href="https://example.test/s?q=a>b" title="Search">Search</a> tail')
    );

    expect(html).toContain('href="https://example.test/s?q=a>b"');
    expect(html).toContain('title="Search"');
    expect(html).toContain('target="_blank"');
    // Split markup would have left the tail of the tag as body text.
    expect(html).toContain('rel="noopener noreferrer">Search</a> tail');
  });

  it('hardens a link whose other attribute values mention target= and rel=', async () => {
    const html = await buildInboundEmailHtmlFromMime(
      buildHtmlMime('<a href="https://example.test/x" title="pick a target=b or rel=z">Pick</a>')
    );

    // Hardening runs over the DOM, so a value that reads like an attribute is
    // still only a value: a string rewrite would have eaten part of the title
    // and left the anchor with no target at all.
    expect(html).toContain('title="pick a target=b or rel=z"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('returns null when the archived message carries no body at all', async () => {
    const html = await buildInboundEmailHtmlFromMime(
      buildMime([
        'From: Sender <sender@example.test>',
        'To: support@example.test',
        'Subject: Empty',
        'Message-ID: <empty@example.test>',
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset="utf-8"',
        '',
        '',
      ])
    );

    expect(html).toBeNull();
  });
});

/**
 * The archived artifact is looked up by the message id stored on the ticket or
 * comment, but the two pipelines do not write `email_processed_attachments.email_id`
 * the same way: the durable one stores the canonical normalized id, the default
 * one stores mailparser's raw header value. An exact-match-only lookup finds
 * nothing for the default pipeline, which is every Microsoft/IMAP ticket until
 * durable mode is switched on — the toggle would simply never appear.
 */
describe('whereInboundEmailArtifactMessageId', () => {
  const db = knexLib({ client: 'pg' });

  function compile(messageId: string) {
    return whereInboundEmailArtifactMessageId(db('email_processed_attachments'), messageId)
      .toSQL()
      .toNative();
  }

  it('matches the bracketed, mixed-case email_id the default pipeline archives', async () => {
    // The value the default pipeline puts in `email_id` comes straight from
    // mailparser, so take it from mailparser rather than assuming its shape.
    const parsed: any = await simpleParser(
      buildHtmlMime('<p>Hi</p>', '<ABC.123@Example.COM>'),
      INBOUND_MIME_PARSE_OPTIONS
    );
    const archivedEmailId = String(parsed.messageId);
    // The value `tickets.email_metadata` / `comments.metadata.email` store, and
    // therefore the only value the route can look up with.
    const storedMessageId = normalizeRfc822MessageId(archivedEmailId) as string;

    // Guard the premise: without a difference here there would be nothing to fix.
    expect(archivedEmailId).not.toBe(storedMessageId);

    const { sql, bindings } = compile(storedMessageId);

    expect(sql).toContain("lower(btrim(email_id, '<>'))");
    // What Postgres computes for the archived row, evaluated here.
    expect(bindings).toContain(archivedEmailId.replace(/^<|>$/g, '').toLowerCase());
  });

  it('still matches a row written in the canonical normalized form', () => {
    const { sql, bindings } = compile('abc.123@example.com');

    expect(sql).toContain('"email_id" in (');
    expect(bindings).toContain('abc.123@example.com');
  });

  it('keeps an opaque provider id an exact match', () => {
    const graphId = 'AAMkADExYzBmZS1hYmNk';
    const { sql, bindings } = compile(graphId);

    // Folding case here could hand back a different message's archive.
    expect(sql).not.toContain('btrim');
    expect(bindings).toEqual([graphId]);
  });
});

/**
 * The renderer is imported by a Next route handler. Pulling
 * `@blocknote/server-util` (directly or through `contentConversion`) into that
 * graph evaluates React's `createContext` on the server and the route fails to
 * instantiate with a 500 before any of the behavior above runs — a failure no
 * behavioral test here can see.
 */
describe('renderInboundEmailHtml module graph', () => {
  it('never reaches BlockNote conversion', () => {
    const entry = resolve(__dirname, '../renderInboundEmailHtml.ts');
    const visited = new Set<string>();
    const queue = [entry];

    while (queue.length > 0) {
      const file = queue.shift() as string;
      if (visited.has(file)) continue;
      visited.add(file);

      const source = readFileSync(file, 'utf8');
      const specifiers = Array.from(
        source.matchAll(/(?:^|\n)\s*(?:import|export)[^'";]*from\s*['"]([^'"]+)['"]/g),
        (match) => match[1]
      );

      for (const specifier of specifiers) {
        expect(specifier).not.toMatch(/@blocknote\//);
        expect(specifier).not.toMatch(/contentConversion$/);
        if (!specifier.startsWith('.')) continue;

        const candidate = resolve(dirname(file), specifier);
        const target = [`${candidate}.ts`, `${candidate}/index.ts`].find((path) => existsSync(path));
        if (target) queue.push(target);
      }
    }

    // A silent resolution failure would make the assertions above vacuous.
    expect(visited.size).toBeGreaterThan(3);
  });
});
