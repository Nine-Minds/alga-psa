import type { AttachmentDocument, ReadPosition } from './types';

import { createHash } from 'crypto';

export interface CursorPayload {
  v: 2;
  entity: { type: string; id: string };
  document_id: string | null;
  docIndex: number;
  unitIndex: number;
  /** SHA-256 (base64url) of the ordered authorized list; fixed size however many attachments the entity has. */
  listDigest: string;
}

export class InvalidCursorError extends Error {
  readonly code = 'INVALID_CURSOR';
  /** HTTP status the REST layer answers with. */
  readonly statusCode = 400;
  constructor(message = 'The cursor is not valid.') {
    super(message);
    this.name = 'InvalidCursorError';
  }
}

export class CursorStaleError extends Error {
  readonly code = 'CURSOR_STALE';
  readonly statusCode = 409;
  constructor() {
    super('The attachments changed since this read started; call read_attachment again without a cursor.');
    this.name = 'CursorStaleError';
  }
}

/**
 * Digest of the canonical authorized list: SHA-256 over the JSON encoding of the ordered
 * [document_id, file_id, updated_at] tuples (JSON makes the framing unambiguous). Any reorder, add,
 * remove, file replacement or edit changes it.
 */
export function digestOfList(docs: AttachmentDocument[]): string {
  return createHash('sha256')
    .update(JSON.stringify(docs.map((d) => [d.document_id, d.file_id, d.updated_at])))
    .digest('base64url');
}

/**
 * Opaque base64url JSON, constant size (it holds a digest of the authorized list, not the list).
 * Not signed: authorization re-runs on every call and the digest is only a staleness check, so
 * tampering can only reposition within, or invalidate against, documents the caller may already read.
 * Version 1 cursors (per-document fingerprints) are rejected as invalid; cursors are short-lived.
 */
export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

export function decodeCursor(raw: string): CursorPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw new InvalidCursorError();
  }
  const p = parsed as Partial<CursorPayload> | null;
  if (
    !p ||
    p.v !== 2 ||
    !p.entity ||
    typeof p.entity.type !== 'string' ||
    typeof p.entity.id !== 'string' ||
    !(p.document_id === null || typeof p.document_id === 'string') ||
    !isInt(p.docIndex) ||
    !isInt(p.unitIndex) ||
    typeof p.listDigest !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(p.listDigest)
  ) {
    throw new InvalidCursorError();
  }
  return p as CursorPayload;
}

/**
 * Resolve a cursor against the CURRENT authorized document list. The cursor must describe exactly this
 * list (same documents, same order, same file_id and updated_at, checked by digest); anything else is stale. Returns the
 * position to resume from.
 */
export function resolveCursor(
  cursor: CursorPayload,
  scope: { entity: { type: string; id: string }; documentId: string | null },
  current: AttachmentDocument[],
): ReadPosition {
  if (cursor.entity.type !== scope.entity.type || cursor.entity.id !== scope.entity.id || cursor.document_id !== scope.documentId) {
    throw new InvalidCursorError('The cursor belongs to a different read; call read_attachment again without a cursor.');
  }
  if (digestOfList(current) !== cursor.listDigest) throw new CursorStaleError();
  if (cursor.docIndex > current.length) throw new InvalidCursorError();
  return { docIndex: cursor.docIndex, unitIndex: cursor.unitIndex };
}

export function buildCursor(
  scope: { entity: { type: string; id: string }; documentId: string | null },
  current: AttachmentDocument[],
  next: ReadPosition,
): string {
  return encodeCursor({
    v: 2,
    entity: scope.entity,
    document_id: scope.documentId,
    docIndex: next.docIndex,
    unitIndex: next.unitIndex,
    listDigest: digestOfList(current),
  });
}
