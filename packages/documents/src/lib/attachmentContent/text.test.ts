import { describe, expect, it } from 'vitest';
import * as F from './__fixtures__/build';
import { fileSource, inAppSource } from './__fixtures__/sources';
import { chunkText, createAttachmentSource, decodeText, DEFAULT_BUDGET, LIMITS, readAttachmentContent, type AttachmentSource } from './index';

const read = (sources: AttachmentSource[], budget = DEFAULT_BUDGET) => readAttachmentContent(sources, { docIndex: 0, unitIndex: 0 }, budget);
const texts = (r: { blocks: Array<{ type: string }> }) => r.blocks.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text);

describe('text producers', () => {
  it('DOCX -> HTML -> Markdown, dropping and counting embedded images', async () => {
    const r = await read([fileSource('plan.docx', 'application/octet-stream', await F.docx())]);
    const [label, body] = texts(r);
    expect(label).toContain('DOCX as Markdown');
    expect(label).toContain('1 embedded image not included');
    expect(body).toContain('Migration plan');
    expect(body).toContain('**Bold step** then a plain step.');
    expect(body).not.toContain('data:image');
    expect(body).not.toContain('![');
    expect(r.blocks.some((b) => b.type === 'image')).toBe(false);
  });

  it('HTML -> Markdown with script and style removed', async () => {
    const r = await read([fileSource('runbook.html', 'text/html', F.html())]);
    const body = texts(r)[1];
    expect(body).toContain('# Runbook');
    expect(body).toContain('**gateway**');
    expect(body).toMatch(/-\s+one/);
    expect(body).not.toContain('SCRIPT-BODY');
    expect(body).not.toContain('color:red');
  });

  it('a 150k-char text file becomes 3 chunks of at most 60k, split at line boundaries, with no loss', async () => {
    const text = F.longText(150_000);
    const src = fileSource('log.txt', 'text/plain', Buffer.from(text));
    const chunks = chunkText(text, LIMITS.textChunkChars);
    expect(chunks).toHaveLength(3);
    expect(chunks.every((c) => c.length <= 60_000)).toBe(true);
    expect(chunks.join('')).toBe(text);
    for (const c of chunks.slice(0, -1)) expect(c.endsWith('\n')).toBe(true);
    for (const c of chunks.slice(1)) expect(c.startsWith('line ')).toBe(true);

    // Through the engine, one chunk per call (60k text budget): three calls cover the file exactly once.
    let pos = { docIndex: 0, unitIndex: 0 } as { docIndex: number; unitIndex: number } | null;
    const got: string[] = [];
    while (pos) {
      const r = await readAttachmentContent([src], pos, DEFAULT_BUDGET);
      got.push(texts(r)[1]);
      pos = r.next;
    }
    expect(got).toEqual(chunks);
  });

  it('splits an over-long single line mid-line rather than exceeding the chunk size', () => {
    const chunks = chunkText('x'.repeat(130_000), 60_000);
    expect(chunks.map((c) => c.length)).toEqual([60_000, 60_000, 10_000]);
    expect(chunks.join('')).toBe('x'.repeat(130_000));
  });

  it('decodes UTF-8, a UTF-8 BOM and UTF-16 (LE/BE) by BOM, normalising CRLF', () => {
    expect(decodeText(Buffer.from('a\r\nb', 'utf8'))).toBe('a\nb');
    expect(decodeText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('héllo')]))).toBe('héllo');
    expect(decodeText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('héllo', 'utf16le')]))).toBe('héllo');
    const be = Buffer.from('héllo', 'utf16le');
    be.swap16();
    expect(decodeText(Buffer.concat([Buffer.from([0xfe, 0xff]), be]))).toBe('héllo');
  });

  it('in-app BlockNote document -> Markdown through the existing conversion', async () => {
    const blockData = [
      { id: 'b1', type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'Call notes', styles: {} }], children: [] },
      { id: 'b2', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'Customer wants the VPN fixed.', styles: {} }], children: [] },
    ];
    const src = createAttachmentSource(
      { document_id: 'd1', document_name: 'Call 1', mime_type: null, file_id: null, file_size: null, updated_at: 'x' },
      {
        downloadFile: async () => {
          throw new Error('in-app documents never touch storage');
        },
        loadInAppBodies: async () => ({ blockData, textContent: null }),
      },
    );
    const r = await read([src]);
    const [label, body] = texts(r);
    expect(label).toBe('[1/1] Call 1 (in-app document as Markdown)');
    expect(body).toContain('Call notes');
    expect(body).toContain('Customer wants the VPN fixed.');
  });

  it('an in-app document with no content is reported, not served empty', async () => {
    const r = await read([inAppSource('Empty', null)]);
    expect(r.omitted).toEqual([expect.objectContaining({ reason: 'no_content' })]);
  });

  it('a ZIP becomes a resource_link with metadata and no bytes', async () => {
    const bytes = await F.zip();
    const r = await read([fileSource('site-survey.zip', 'application/zip', bytes)]);
    expect(r.blocks).toEqual([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('site-survey.zip (application/zip') }),
      { type: 'resource_link', uri: '/api/documents/doc-site-survey.zip/download', name: 'site-survey.zip', mimeType: 'application/zip', size: bytes.length },
    ]);
    expect(JSON.stringify(r.blocks)).not.toContain(bytes.toString('base64'));
    expect(r.omitted[0].reason).toBe('unsupported_type');
  });

  it('never sends unknown binary as text', async () => {
    const r = await read([fileSource('mystery.bin', 'application/octet-stream', Buffer.from([0, 1, 2, 3, 0xff, 0xfe]))]);
    expect(r.blocks.map((b) => b.type)).toEqual(['text', 'resource_link']);
  });
});
