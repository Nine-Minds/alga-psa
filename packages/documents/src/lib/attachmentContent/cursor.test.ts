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
  it('round-trips position and list digest (digest) through an opaque base64url string', () => {
    const raw = buildCursor(scope, docs, { docIndex: 2, unitIndex: 5 });
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    const decoded = decodeCursor(raw);
    expect(decoded).toMatchObject({ v: 2, entity: scope.entity, document_id: null, docIndex: 2, unitIndex: 5 });
    expect(decoded.listDigest).toHaveLength(43);
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
    for (const bad of ['', 'not base64 json!', Buffer.from('{"v":3}').toString('base64url'), Buffer.from('[]').toString('base64url'), Buffer.from(JSON.stringify({ v: 2, entity: { type: 'ticket', id: 'x' }, document_id: null, docIndex: -1, unitIndex: 0, listDigest: 'x'.repeat(43) })).toString('base64url')]) {
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

  it('stays the same size for 1, 100 and 1000 documents (well under the 8192 cap)', () => {
    const lens = [1, 100, 1000].map((n) =>
      buildCursor(scope, Array.from({ length: n }, (_, i) => doc(`d${i}`)), { docIndex: 0, unitIndex: 0 }).length,
    );
    expect(Math.max(...lens) - Math.min(...lens)).toBeLessThanOrEqual(8);
    expect(Math.max(...lens)).toBeLessThan(500);
  });

  it('rejects a v1 cursor and a tampered digest', () => {
    const v1 = Buffer.from(
      JSON.stringify({ v: 1, entity: scope.entity, document_id: null, docIndex: 0, unitIndex: 0, fingerprints: [] }),
    ).toString('base64url');
    expect(() => decodeCursor(v1)).toThrow(InvalidCursorError);
    const decoded = decodeCursor(buildCursor(scope, docs, { docIndex: 0, unitIndex: 0 }));
    const bad = (over: object) => Buffer.from(JSON.stringify({ ...decoded, ...over })).toString('base64url');
    expect(() => decodeCursor(bad({ listDigest: 'short' }))).toThrow(InvalidCursorError);
    expect(() => decodeCursor(bad({ listDigest: undefined }))).toThrow(InvalidCursorError);
    // A well-formed but wrong digest is a stale cursor, not an invalid one.
    expect(() => resolveCursor(decodeCursor(bad({ listDigest: 'A'.repeat(43) })), scope, docs)).toThrow(CursorStaleError);
  });

  it('does not confuse tuples whose fields shift across separators', () => {
    const d1 = decodeCursor(buildCursor(scope, [doc('a|b', { file_id: 'c' })], { docIndex: 0, unitIndex: 0 }));
    expect(() => resolveCursor(d1, scope, [doc('a', { file_id: 'b|c' })])).toThrow(CursorStaleError);
  });
});
