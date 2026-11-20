import { describe, expect, it } from 'vitest';
import { buildCursor, CursorStaleError, decodeCursor, InvalidCursorError, resolveCursor, type AttachmentDocument } from './index';

const doc = (id: string, over: Partial<AttachmentDocument> = {}): AttachmentDocument => ({
  document_id: id,
  document_name: id,
  mime_type: 'image/png',
  file_id: `f-${id}`,
  file_size: 10,
  updated_at: '2026-01-01T00:00:00.000Z',
  ...over,
});
const scope = { entity: { type: 'ticket', id: 'T-1' }, documentId: null };
const docs = [doc('a'), doc('b'), doc('c')];

describe('cursor', () => {
  it('round-trips position and fingerprints through an opaque base64url string', () => {
    const raw = buildCursor(scope, docs, { docIndex: 2, unitIndex: 5 });
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    const decoded = decodeCursor(raw);
    expect(decoded).toMatchObject({ v: 1, entity: scope.entity, document_id: null, docIndex: 2, unitIndex: 5 });
    expect(decoded.fingerprints).toHaveLength(3);
    expect(resolveCursor(decoded, scope, docs)).toEqual({ docIndex: 2, unitIndex: 5 });
  });

  it('is stale when a document was edited (updated_at), replaced (file_id), added or removed', () => {
    const decoded = decodeCursor(buildCursor(scope, docs, { docIndex: 1, unitIndex: 0 }));
    for (const changed of [
      [doc('a'), doc('b', { updated_at: '2026-02-01T00:00:00.000Z' }), doc('c')],
      [doc('a'), doc('b', { file_id: 'f-new' }), doc('c')],
      [...docs, doc('d')],
      [docs[0], docs[2]],
      [docs[1], docs[0], docs[2]],
    ]) {
      expect(() => resolveCursor(decoded, scope, changed)).toThrow(CursorStaleError);
    }
    expect(new CursorStaleError().message).toContain('call read_attachment again without a cursor');
  });

  it('rejects malformed cursors and cursors from another read', () => {
    for (const bad of ['', 'not base64 json!', Buffer.from('{"v":2}').toString('base64url'), Buffer.from('[]').toString('base64url'), Buffer.from(JSON.stringify({ v: 1, entity: { type: 'ticket', id: 'x' }, document_id: null, docIndex: -1, unitIndex: 0, fingerprints: [] })).toString('base64url')]) {
      expect(() => decodeCursor(bad)).toThrow(InvalidCursorError);
    }
    const decoded = decodeCursor(buildCursor(scope, docs, { docIndex: 0, unitIndex: 1 }));
    expect(() => resolveCursor(decoded, { entity: { type: 'ticket', id: 'OTHER' }, documentId: null }, docs)).toThrow(InvalidCursorError);
    expect(() => resolveCursor(decoded, { ...scope, documentId: 'b' }, docs)).toThrow(InvalidCursorError);
  });

  it('carries no authorization: a tampered cursor only repositions within the authorized list', () => {
    const decoded = decodeCursor(buildCursor(scope, docs, { docIndex: 0, unitIndex: 0 }));
    const forged = { ...decoded, docIndex: 99 };
    expect(() => resolveCursor(forged, scope, docs)).toThrow(InvalidCursorError);
  });
});
