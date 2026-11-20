import { describe, expect, it } from 'vitest';
import { attachmentReadToToolResult } from '../attachmentRead';

const header = { entity: { type: 'ticket', id: 't1' }, served: [], omitted: [], limits_applied: [], remaining: null, next_cursor: null, instructions: 'done' };

describe('attachmentReadToToolResult', () => {
  it('always puts the header first (text), then the blocks, and mirrors it as structuredContent', () => {
    const img = { type: 'image', data: 'AAAA', mimeType: 'image/jpeg' };
    const r = attachmentReadToToolResult({ data: { header, blocks: [img, { type: 'text', text: 'hi' }] } }, 200);
    expect(r.isError).toBe(false);
    expect(r.content[0]).toEqual({ type: 'text', text: JSON.stringify(header) });
    expect(r.content.slice(1)).toEqual([img, { type: 'text', text: 'hi' }]);
    expect(r.structuredContent).toEqual(header);
  });

  it('keeps the header first even when the payload starts with an image or blob', () => {
    const blob = { type: 'resource', resource: { uri: 'u', mimeType: 'application/pdf', blob: 'AAAA' } };
    const r = attachmentReadToToolResult({ header, blocks: [blob] }, 200);
    expect(r.content[0].type).toBe('text');
    expect((r.content[0] as { text: string }).text).not.toContain('AAAA');
  });

  it('drops and reports unrecognised blocks', () => {
    const r = attachmentReadToToolResult({ header, blocks: [{ type: 'audio', data: 'x' }, { type: 'text', text: 'ok' }, 'junk'] }, 200);
    expect(r.content).toHaveLength(2);
    expect((r.structuredContent as { dropped_blocks: number }).dropped_blocks).toBe(2);
  });

  it('turns an error status or malformed payload into a JSON error result', () => {
    const e = attachmentReadToToolResult({ error: { message: 'gone' } }, 409);
    expect(e.isError).toBe(true);
    expect(e.statusCode).toBe(409);
    expect(e.content).toHaveLength(1);
    expect(attachmentReadToToolResult({ nope: 1 }, 200).isError).toBe(true);
  });
});
