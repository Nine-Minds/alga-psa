import type { AttachmentDocument, ReadPosition } from './types';

export interface DocumentFingerprint {
  document_id: string;
  file_id: string | null;
  updated_at: string;
}

export interface CursorPayload {
  v: 1;
  entity: { type: string; id: string };
  document_id: string | null;
  docIndex: number;
  unitIndex: number;
  fingerprints: DocumentFingerprint[];
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

export function fingerprintOf(doc: AttachmentDocument): DocumentFingerprint {
  return { document_id: doc.document_id, file_id: doc.file_id, updated_at: doc.updated_at };
}

/** Opaque base64url JSON. Not signed: authorization re-runs on every call, so tampering can only reach readable documents. */
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
    p.v !== 1 ||
    !p.entity ||
    typeof p.entity.type !== 'string' ||
    typeof p.entity.id !== 'string' ||
    !(p.document_id === null || typeof p.document_id === 'string') ||
    !isInt(p.docIndex) ||
    !isInt(p.unitIndex) ||
    !Array.isArray(p.fingerprints) ||
    !p.fingerprints.every(
      (f) => f && typeof f.document_id === 'string' && (f.file_id === null || typeof f.file_id === 'string') && typeof f.updated_at === 'string',
    )
  ) {
    throw new InvalidCursorError();
  }
  return p as CursorPayload;
}

/**
 * Resolve a cursor against the CURRENT authorized document list. The cursor must describe exactly this
 * list (same documents, same order, same file_id and updated_at); anything else is stale. Returns the
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
  const now = current.map(fingerprintOf);
  if (
    now.length !== cursor.fingerprints.length ||
    now.some((f, i) => f.document_id !== cursor.fingerprints[i].document_id || f.file_id !== cursor.fingerprints[i].file_id || f.updated_at !== cursor.fingerprints[i].updated_at)
  ) {
    throw new CursorStaleError();
  }
  if (cursor.docIndex > current.length) throw new InvalidCursorError();
  return { docIndex: cursor.docIndex, unitIndex: cursor.unitIndex };
}

export function buildCursor(
  scope: { entity: { type: string; id: string }; documentId: string | null },
  current: AttachmentDocument[],
  next: ReadPosition,
): string {
  return encodeCursor({
    v: 1,
    entity: scope.entity,
    document_id: scope.documentId,
    docIndex: next.docIndex,
    unitIndex: next.unitIndex,
    fingerprints: current.map(fingerprintOf),
  });
}
