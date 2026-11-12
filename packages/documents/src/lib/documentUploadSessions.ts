/**
 * Resumable, chunked document uploads (tus-style semantics on the storage write sessions).
 *
 * A large file arrives as a series of 8-16 MiB requests. Each chunk streams straight into one
 * part of a provider write session (`writePart`), so the server holds about one chunk's worth of
 * stream buffers per upload, never the file. The durable state lives in `document_upload_sessions`:
 *
 *  - `committed_offset` advances only after `writePart` has durably stored the part, and only by a
 *    conditional UPDATE that still sees the offset the chunk started at.
 *  - Every status change is a conditional UPDATE (`WHERE status = <expected>`), so a double
 *    complete, an abort racing a chunk, or the sweeper racing a complete resolve in the database.
 *  - A chunk first *claims* the session (`chunk_claim_token`, a short lease). Two requests for the
 *    same offset would otherwise both write the same part number and the loser's ETag could end up
 *    in the receipt list while the object store holds the winner's bytes.
 *
 * Authorization is not decided here for chunks: the session row is the capability, scoped to the
 * tenant and the uploader. Creating and completing a session run `assertDocumentUploadAllowed`.
 */
import type { Knex } from 'knex';
import { PassThrough, Readable, Transform, Writable } from 'node:stream';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import type { IUser } from '@alga-psa/types';
import { StorageService } from '@alga-psa/storage/StorageService';
import { StorageProviderFactory, generateStoragePath } from '@alga-psa/storage/StorageProviderFactory';
import { getUploadPolicy } from '@alga-psa/storage/config/storage';
import { byteCounter, runPipeline, sniffHead, type IngestStage } from '@alga-psa/storage/ingest/pipeline';
import { resolveUploadMime } from '@alga-psa/storage/ingest/mime';
import { isUploadContentTypeError, isUploadSizeLimitError } from '@alga-psa/storage/ingest/errors';
import {
  DEFAULT_PART_SIZE,
  MIN_NON_FINAL_PART_SIZE,
  StorageError,
  type PartReceipt,
  type StorageProviderInterface,
  type WriteSessionHandle,
} from '@alga-psa/storage/providers/StorageProvider';
import type { ActionPermissionErrorShape } from '@alga-psa/ui/lib/errorHandling';
import { createDocumentFromCommittedFile, isActionPermissionErrorResult, type DocumentUploadOptions } from './createDocumentFromCommittedFile';
import { assertDocumentUploadAllowed } from './documentUploadAuthorization';
import { resolveDocumentTypeForMime } from './documentTypeLookup';

// LEVERAGE: pattern conditional-status-transition — claim-by-`UPDATE ... WHERE status = <expected>` (transition() below) is the same shape as claimCommentEmailDelivery and the comment-attachment draft cleanup; a shared claim/lease primitive would own the row-count check and the lease expiry.
export const UPLOAD_SESSION_TABLE = 'document_upload_sessions';

export type UploadSessionStatus = 'active' | 'completing' | 'completed' | 'aborted' | 'expired';

export interface UploadSession {
  tenant: string;
  session_id: string;
  uploaded_by: string;
  entity_type: string;
  entity_id: string;
  target_options: UploadSessionTargetOptions;
  file_name: string;
  mime_type: string;
  declared_size: number;
  write_handle: WriteSessionHandle;
  storage_path: string;
  chunk_size: number;
  committed_offset: number;
  parts: PartReceipt[];
  chunk_claim_token: string | null;
  chunk_claim_expires_at: Date | null;
  status: UploadSessionStatus;
  expires_at: Date;
  document_id: string | null;
  created_at: Date;
  updated_at: Date;
}

/** Upload options that shape the document and are not part of the target entity. */
export interface UploadSessionTargetOptions {
  commentAttachmentDraft?: boolean;
  folder_path?: string | null;
  isClientVisible?: boolean;
}

/** An error a route maps straight to an HTTP response. */
export class UploadSessionError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'UploadSessionError';
  }
}

/** The entity types an upload can target, and the `uploadDocument` option each one sets. */
const TARGET_OPTION_BY_ENTITY_TYPE = {
  ticket: 'ticketId',
  client: 'clientId',
  contact: 'contactNameId',
  asset: 'assetId',
  project_task: 'projectTaskId',
  contract: 'contractId',
  opportunity: 'opportunityId',
  document: 'parentDocumentId',
} as const;

export type UploadTargetEntityType = keyof typeof TARGET_OPTION_BY_ENTITY_TYPE;

export function isUploadTargetEntityType(value: unknown): value is UploadTargetEntityType {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(TARGET_OPTION_BY_ENTITY_TYPE, value);
}

export function uploadOptionsForSession(
  session: Pick<UploadSession, 'entity_type' | 'entity_id' | 'target_options'>,
): DocumentUploadOptions {
  const key = TARGET_OPTION_BY_ENTITY_TYPE[session.entity_type as UploadTargetEntityType];
  return { ...session.target_options, ...(key ? { [key]: session.entity_id } : {}) };
}

// ---------------------------------------------------------------------------------------------
// Configuration

export interface UploadSessionConfig {
  chunkSize: number;
  /** How long a session lives after its last activity. */
  ttlMs: number;
  /** How long a chunk request may hold the session before another may take over. */
  claimMs: number;
}

function positiveNumber(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Chunk size is kept between the part-size default (8 MiB) and twice that (16 MiB). */
export function getUploadSessionConfig(env: NodeJS.ProcessEnv = process.env): UploadSessionConfig {
  const requested = positiveNumber(env.DOCUMENT_UPLOAD_CHUNK_SIZE_BYTES, DEFAULT_PART_SIZE);
  return {
    chunkSize: Math.min(Math.max(Math.floor(requested), DEFAULT_PART_SIZE), DEFAULT_PART_SIZE * 2),
    ttlMs: positiveNumber(env.DOCUMENT_UPLOAD_SESSION_TTL_HOURS, 24) * 60 * 60 * 1000,
    claimMs: positiveNumber(env.DOCUMENT_UPLOAD_CHUNK_CLAIM_SECONDS, 120) * 1000,
  };
}

// ---------------------------------------------------------------------------------------------
// Row access

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sessions(conn: Knex | Knex.Transaction, tenant: string): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(UPLOAD_SESSION_TABLE);
}

function jsonb(value: unknown): string {
  return JSON.stringify(value);
}

function hydrate(row: any): UploadSession {
  return {
    ...row,
    declared_size: Number(row.declared_size),
    committed_offset: Number(row.committed_offset),
    chunk_size: Number(row.chunk_size),
    parts: typeof row.parts === 'string' ? JSON.parse(row.parts) : (row.parts ?? []),
    write_handle: typeof row.write_handle === 'string' ? JSON.parse(row.write_handle) : row.write_handle,
    target_options: typeof row.target_options === 'string' ? JSON.parse(row.target_options) : (row.target_options ?? {}),
    expires_at: new Date(row.expires_at),
  } as UploadSession;
}

/** The session, if it exists in this tenant and belongs to this uploader; otherwise null (a 404). */
export async function findUploadSession(
  knex: Knex,
  tenant: string,
  userId: string,
  sessionId: string,
): Promise<UploadSession | null> {
  if (!UUID_RE.test(sessionId)) return null;
  const row = await sessions(knex, tenant).where({ session_id: sessionId, uploaded_by: userId }).first();
  return row ? hydrate(row) : null;
}

async function requireSession(knex: Knex, tenant: string, userId: string, sessionId: string): Promise<UploadSession> {
  const session = await findUploadSession(knex, tenant, userId, sessionId);
  if (!session) throw new UploadSessionError(404, 'UPLOAD_NOT_FOUND', 'Upload session not found');
  return session;
}

/** Conditional status change; true when this caller made the transition. */
async function transition(
  conn: Knex | Knex.Transaction,
  tenant: string,
  sessionId: string,
  from: UploadSessionStatus | UploadSessionStatus[],
  patch: Record<string, unknown>,
): Promise<boolean> {
  const updated = await sessions(conn, tenant)
    .where({ session_id: sessionId })
    .whereIn('status', Array.isArray(from) ? from : [from])
    .update({ ...patch, updated_at: new Date() });
  return updated === 1;
}

function offsetHeaders(session: Pick<UploadSession, 'committed_offset'>): Record<string, string> {
  return { 'Upload-Offset': String(session.committed_offset) };
}

/** The error a request gets for a session that can no longer take this operation. */
function unavailable(session: UploadSession): UploadSessionError {
  if (session.status === 'expired' || (session.status === 'active' && session.expires_at.getTime() < Date.now())) {
    return new UploadSessionError(410, 'UPLOAD_EXPIRED', 'Upload session has expired', offsetHeaders(session));
  }
  if (session.status === 'aborted') {
    return new UploadSessionError(410, 'UPLOAD_ABORTED', 'Upload session was aborted');
  }
  return new UploadSessionError(409, `UPLOAD_${session.status.toUpperCase()}`, `Upload session is ${session.status}`, offsetHeaders(session));
}

// ---------------------------------------------------------------------------------------------
// Create

export interface CreateUploadSessionInput {
  knex: Knex;
  tenant: string;
  user: IUser;
  fileName: unknown;
  mimeType: unknown;
  size: unknown;
  entityType: unknown;
  entityId: unknown;
  options?: UploadSessionTargetOptions;
}

export interface CreatedUploadSession {
  sessionId: string;
  chunkSize: number;
  maxFileSize: number;
  expiresAt: string;
}

function badRequest(message: string, code = 'INVALID_REQUEST'): UploadSessionError {
  return new UploadSessionError(400, code, message);
}

/** The permission check throws for a draft attachment the user may not write; both forms are a 403. */
async function authorizeTarget(
  user: IUser,
  tenant: string,
  knex: Knex,
  options: DocumentUploadOptions,
): Promise<void> {
  try {
    const denied = await assertDocumentUploadAllowed(user, tenant, knex, options);
    if (denied) throw new UploadSessionError(403, 'FORBIDDEN', (denied as ActionPermissionErrorShape).permissionError);
  } catch (error) {
    if (error instanceof UploadSessionError) throw error;
    if (error instanceof Error && error.message.startsWith('Permission denied')) {
      throw new UploadSessionError(403, 'FORBIDDEN', error.message);
    }
    throw error;
  }
}

export async function createUploadSession(input: CreateUploadSessionInput): Promise<CreatedUploadSession> {
  const { knex, tenant, user } = input;
  const fileName = typeof input.fileName === 'string' ? input.fileName.trim() : '';
  const mimeType = typeof input.mimeType === 'string' ? input.mimeType.trim() : '';
  if (!fileName) throw badRequest('fileName is required');
  if (!mimeType) throw badRequest('mimeType is required');
  if (typeof input.size !== 'number' || !Number.isSafeInteger(input.size) || input.size <= 0) {
    throw badRequest('size must be a positive integer number of bytes');
  }
  if (!isUploadTargetEntityType(input.entityType)) {
    throw badRequest(`entityType must be one of: ${Object.keys(TARGET_OPTION_BY_ENTITY_TYPE).join(', ')}`);
  }
  if (typeof input.entityId !== 'string' || !UUID_RE.test(input.entityId)) {
    throw badRequest('entityId must be a UUID');
  }
  const size = input.size;
  const targetOptions: UploadSessionTargetOptions = {
    ...(input.options?.commentAttachmentDraft === true ? { commentAttachmentDraft: true } : {}),
    ...(typeof input.options?.folder_path === 'string' ? { folder_path: input.options.folder_path } : {}),
    ...(typeof input.options?.isClientVisible === 'boolean' ? { isClientVisible: input.options.isClientVisible } : {}),
  };

  await authorizeTarget(user, tenant, knex, uploadOptionsForSession({
    entity_type: input.entityType,
    entity_id: input.entityId,
    target_options: targetOptions,
  }));

  // The same single limit and allowlist the storage layer enforces, read from the provider.
  const policy = await getUploadPolicy();
  try {
    await StorageService.validateFileUpload(tenant, mimeType, size);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('File size exceeds limit')) throw new UploadSessionError(413, 'UPLOAD_TOO_LARGE', message);
    if (message === 'File type not allowed') throw new UploadSessionError(415, 'UPLOAD_TYPE_NOT_ALLOWED', message);
    throw error;
  }

  const config = getUploadSessionConfig();
  const provider = await StorageProviderFactory.createProvider();
  const storagePath = generateStoragePath(tenant, '', fileName);
  const handle = await provider.beginWrite(storagePath, { mimeType });
  const sessionId = uuidv4();
  const expiresAt = new Date(Date.now() + config.ttlMs);
  try {
    await sessions(knex, tenant).insert({
      tenant,
      session_id: sessionId,
      uploaded_by: user.user_id,
      entity_type: input.entityType,
      entity_id: input.entityId,
      target_options: jsonb(targetOptions),
      file_name: fileName,
      mime_type: mimeType,
      declared_size: size,
      write_handle: jsonb(handle),
      storage_path: storagePath,
      chunk_size: config.chunkSize,
      committed_offset: 0,
      parts: jsonb([]),
      status: 'active',
      expires_at: expiresAt,
    });
  } catch (error) {
    await provider.abortWrite(handle).catch(() => undefined);
    throw error;
  }
  return { sessionId, chunkSize: config.chunkSize, maxFileSize: policy.maxFileSize, expiresAt: expiresAt.toISOString() };
}

// ---------------------------------------------------------------------------------------------
// Chunks

export interface ContentRange {
  start: number;
  /** Inclusive. */
  end: number;
  /** Declared total, or undefined for `bytes a-b/*`. */
  total: number | undefined;
}

/** `bytes <start>-<end>/<total|*>`; anything else is a 400. */
export function parseContentRange(header: string | null): ContentRange {
  const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec((header ?? '').trim());
  if (!match) throw badRequest('Content-Range must be "bytes <start>-<end>/<total>"', 'INVALID_CONTENT_RANGE');
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = match[3] === '*' ? undefined : Number(match[3]);
  if (![start, end].every(Number.isSafeInteger) || end < start || (total !== undefined && !Number.isSafeInteger(total))) {
    throw badRequest('Content-Range is not a valid byte range', 'INVALID_CONTENT_RANGE');
  }
  return { start, end, total };
}

/** Passes exactly `length` bytes: a longer body fails as soon as it overruns, a shorter one at the end. */
function exactLength(length: number): Transform & { readonly bytes: number } {
  let bytes = 0;
  const stage = new Transform({
    transform(chunk, _enc, cb) {
      bytes += chunk.length;
      if (bytes > length) {
        return cb(badRequest(`Body is longer than the ${length} bytes declared by Content-Range`, 'BODY_LENGTH_MISMATCH'));
      }
      cb(null, chunk);
    },
    flush(cb) {
      if (bytes !== length) {
        return cb(badRequest(`Body is ${bytes} bytes but Content-Range declares ${length}`, 'BODY_LENGTH_MISMATCH'));
      }
      cb();
    },
  }) as Transform & { readonly bytes: number };
  Object.defineProperty(stage, 'bytes', { get: () => bytes });
  return stage;
}

function mapChunkError(error: unknown, limit: number): unknown {
  if (error instanceof UploadSessionError) return error;
  if (isUploadSizeLimitError(error)) {
    return new UploadSessionError(413, 'UPLOAD_TOO_LARGE', `Chunk would exceed the upload limit of ${limit} bytes`);
  }
  if (isUploadContentTypeError(error)) {
    return new UploadSessionError(415, 'UPLOAD_TYPE_REJECTED', error.message);
  }
  if (error instanceof StorageError && ['INVALID_PART', 'PART_TOO_SMALL', 'PART_SIZE_MISMATCH'].includes(error.code)) {
    return new UploadSessionError(400, error.code, error.message);
  }
  return error;
}

export interface ReceiveChunkInput {
  knex: Knex;
  tenant: string;
  userId: string;
  sessionId: string;
  contentRange: string | null;
  contentLength: string | null;
  body: ReadableStream<Uint8Array> | null;
  /** Injected for tests; defaults to the configured provider. */
  provider?: StorageProviderInterface;
}

export interface ChunkReceipt {
  committedOffset: number;
  complete: boolean;
}

export async function receiveChunk(input: ReceiveChunkInput): Promise<ChunkReceipt> {
  const { knex, tenant, userId, sessionId } = input;
  const session = await requireSession(knex, tenant, userId, sessionId);
  if (session.status !== 'active' || session.expires_at.getTime() < Date.now()) throw unavailable(session);

  const range = parseContentRange(input.contentRange);
  if (range.total !== undefined && range.total !== session.declared_size) {
    throw badRequest(`Content-Range total ${range.total} does not match the declared size ${session.declared_size}`, 'INVALID_CONTENT_RANGE');
  }
  if (range.start !== session.committed_offset) {
    throw new UploadSessionError(409, 'OFFSET_MISMATCH',
      `Chunk starts at ${range.start} but the upload is at ${session.committed_offset}`, offsetHeaders(session));
  }
  const length = range.end - range.start + 1;
  if (input.contentLength !== null && Number(input.contentLength) !== length) {
    throw badRequest(`Content-Length ${input.contentLength} does not match the ${length} bytes in Content-Range`, 'BODY_LENGTH_MISMATCH');
  }
  if (!input.body) throw badRequest('Chunk body is required', 'BODY_LENGTH_MISMATCH');

  const policy = await getUploadPolicy();
  const limit = Math.min(session.declared_size, policy.maxFileSize);
  if (range.end + 1 > limit) {
    throw new UploadSessionError(413, 'UPLOAD_TOO_LARGE', `Chunk would exceed the upload limit of ${limit} bytes`, offsetHeaders(session));
  }
  const isFinal = range.end + 1 === session.declared_size;
  if (length > session.chunk_size) {
    throw new UploadSessionError(413, 'CHUNK_TOO_LARGE', `Chunks may be at most ${session.chunk_size} bytes`, offsetHeaders(session));
  }
  if (!isFinal && length < MIN_NON_FINAL_PART_SIZE) {
    throw badRequest(`Only the last chunk may be smaller than ${MIN_NON_FINAL_PART_SIZE} bytes`, 'CHUNK_TOO_SMALL');
  }

  const config = getUploadSessionConfig();
  const claim = uuidv4();
  const now = new Date();
  // Claim the session for this offset. Exactly one request wins; the rest see why they lost.
  const claimed = await sessions(knex, tenant)
    .where({ session_id: sessionId, status: 'active', committed_offset: range.start })
    .where((q) => q.whereNull('chunk_claim_token').orWhere('chunk_claim_expires_at', '<', now))
    .update({ chunk_claim_token: claim, chunk_claim_expires_at: new Date(now.getTime() + config.claimMs), updated_at: now });
  if (claimed !== 1) {
    const current = await findUploadSession(knex, tenant, userId, sessionId);
    if (!current) throw new UploadSessionError(404, 'UPLOAD_NOT_FOUND', 'Upload session not found');
    if (current.status !== 'active') throw unavailable(current);
    if (current.committed_offset !== range.start) {
      throw new UploadSessionError(409, 'OFFSET_MISMATCH',
        `Chunk starts at ${range.start} but the upload is at ${current.committed_offset}`, offsetHeaders(current));
    }
    throw new UploadSessionError(409, 'CHUNK_IN_PROGRESS', 'Another chunk is being written for this upload',
      { ...offsetHeaders(current), 'Retry-After': '5' });
  }

  try {
    const provider = input.provider ?? await StorageProviderFactory.createProvider();
    const partNumber = session.parts.length + 1;

    // LEVERAGE: friction storage-ingest-pipeline — ingestToWriteSession assumes one request owns a whole write session (open, stream, commit, hash); a chunk is one part of a session that lives across requests, so the stages are composed by hand here and no content hash can be taken.
    // byteCounter enforces the file limit mid-stream (413); exactLength the Content-Range (400).
    // The first chunk is also sniffed against the declared type, exactly as a one-shot upload is.
    const counter = byteCounter(limit - range.start);
    const sniff = range.start === 0
      ? sniffHead((detected, info) => resolveUploadMime(session.mime_type, detected, policy.allowedMimeTypes, info).mime)
      : null;
    const guard = exactLength(length);
    // The part body handed to storage. It is fed by `tail` rather than being a pipeline stage, so a
    // failing pipeline cannot destroy it with an error before the storage request is cancelled.
    const sink = new PassThrough();
    const tail = new Writable({
      write(chunk, _enc, cb) {
        if (sink.write(chunk)) cb();
        else sink.once('drain', () => cb());
      },
      final(cb) {
        sink.end(() => cb());
      },
    });
    const stages: IngestStage[] = [counter, ...(sniff ? [sniff] : []), guard, tail];
    const cancel = new AbortController();
    const piped = runPipeline(Readable.fromWeb(input.body as never), ...(stages as [IngestStage, ...IngestStage[]]));
    const written = provider.writePart(session.write_handle, partNumber, sink, length, { final: isFinal, signal: cancel.signal });
    // A body failure must cancel the part at once (it is never stored) instead of leaving the storage
    // request waiting for bytes; a storage failure must stop reading the request body.
    // Whichever side fails first is the cause; the other only fails because we stopped it.
    let cause: { error: unknown } | undefined;
    piped.catch((error) => { cause ??= { error }; cancel.abort(); sink.destroy(); });
    written.catch((error) => { cause ??= { error }; tail.destroy(); sink.destroy(); });
    const [pipeResult, writeResult] = await Promise.allSettled([piped, written]);
    if (pipeResult.status === 'rejected' || writeResult.status === 'rejected') {
      throw mapChunkError(cause?.error ?? (pipeResult.status === 'rejected' ? pipeResult.reason : (writeResult as PromiseRejectedResult).reason), limit);
    }
    const receipt = writeResult.value;

    // The part is durable: advance the offset, but only if nothing else changed the session.
    const advanced = await sessions(knex, tenant)
      .where({ session_id: sessionId, status: 'active', committed_offset: range.start, chunk_claim_token: claim })
      .update({
        committed_offset: range.end + 1,
        parts: jsonb([...session.parts, receipt]),
        chunk_claim_token: null,
        chunk_claim_expires_at: null,
        ...(sniff?.resolvedMime ? { mime_type: sniff.resolvedMime } : {}),
        expires_at: new Date(Date.now() + config.ttlMs),
        updated_at: new Date(),
      });
    if (advanced !== 1) {
      const current = await findUploadSession(knex, tenant, userId, sessionId);
      throw current && current.status !== 'active'
        ? unavailable(current)
        : new UploadSessionError(409, 'CHUNK_REJECTED', 'The upload changed while the chunk was written; retry from the reported offset',
            current ? offsetHeaders(current) : {});
    }
    return { committedOffset: range.end + 1, complete: isFinal };
  } finally {
    // Release the lease if the chunk failed (a successful commit already cleared it).
    await sessions(knex, tenant)
      .where({ session_id: sessionId, chunk_claim_token: claim })
      .update({ chunk_claim_token: null, chunk_claim_expires_at: null })
      .catch((error: unknown) => console.error('[documentUploadSessions] Failed to release chunk claim', error));
  }
}

// ---------------------------------------------------------------------------------------------
// Complete

export interface CompleteUploadInput {
  knex: Knex;
  tenant: string;
  user: IUser;
  sessionId: string;
  provider?: StorageProviderInterface;
}

/**
 * What a completed upload reports about its document. Built from the session, never by reading the
 * `documents` table back: a repeated complete must not return a row without the document read
 * authorization, and the uploader needs nothing beyond what they declared.
 */
export interface UploadedDocumentSummary {
  document_id: string;
  document_name: string;
  mime_type: string;
  file_size: number;
}

export interface CompletedUpload {
  document: UploadedDocumentSummary;
  /** True when this call found the upload already completed and created nothing. */
  alreadyCompleted: boolean;
}

export async function completeUploadSession(input: CompleteUploadInput): Promise<CompletedUpload> {
  const { knex, tenant, user, sessionId } = input;
  const session = await requireSession(knex, tenant, user.user_id, sessionId);

  const summarize = (current: UploadSession, documentId: string | null): UploadedDocumentSummary => {
    if (!documentId) throw new UploadSessionError(409, 'UPLOAD_COMPLETED', 'Upload was completed but its document is no longer available');
    return { document_id: documentId, document_name: current.file_name, mime_type: current.mime_type, file_size: current.declared_size };
  };
  const existing = async (current: UploadSession): Promise<CompletedUpload> =>
    ({ document: summarize(current, current.document_id), alreadyCompleted: true });
  if (session.status === 'completed') return existing(session);
  if (session.status !== 'active' || session.expires_at.getTime() < Date.now()) throw unavailable(session);

  // The permission rules may have changed since the session was created.
  await authorizeTarget(user, tenant, knex, uploadOptionsForSession(session));

  // active -> completing, only if the whole file is committed and no chunk is mid-write. One caller wins.
  const now = new Date();
  const claimed = await sessions(knex, tenant)
    .where({ session_id: sessionId, status: 'active' })
    .whereRaw('committed_offset = declared_size')
    .where((q) => q.whereNull('chunk_claim_token').orWhere('chunk_claim_expires_at', '<', now))
    .update({ status: 'completing', updated_at: now });
  if (claimed !== 1) {
    const current = await requireSession(knex, tenant, user.user_id, sessionId);
    if (current.status === 'completed') return existing(current);
    if (current.status === 'completing') {
      throw new UploadSessionError(409, 'COMPLETE_IN_PROGRESS', 'Upload is already being completed', offsetHeaders(current));
    }
    if (current.status !== 'active' || current.expires_at.getTime() < Date.now()) throw unavailable(current);
    if (current.committed_offset !== current.declared_size) {
      throw new UploadSessionError(409, 'UPLOAD_INCOMPLETE',
        `Upload has ${current.committed_offset} of ${current.declared_size} bytes`, offsetHeaders(current));
    }
    throw new UploadSessionError(409, 'CHUNK_IN_PROGRESS', 'A chunk is still being written', { ...offsetHeaders(current), 'Retry-After': '5' });
  }

  const provider = input.provider ?? await StorageProviderFactory.createProvider();
  let storedPath: string;
  try {
    const stored = await provider.completeWrite(session.write_handle, session.parts);
    storedPath = stored.path;
    if (stored.size !== session.declared_size) {
      await provider.delete(stored.path).catch(() => undefined);
      await transition(knex, tenant, sessionId, 'completing', { status: 'aborted' });
      throw new UploadSessionError(422, 'SIZE_MISMATCH',
        `Stored object is ${stored.size} bytes but ${session.declared_size} were declared`);
    }
  } catch (error) {
    if (error instanceof UploadSessionError) throw error;
    // Nothing was stored: let the client retry complete (or abort).
    await transition(knex, tenant, sessionId, 'completing', { status: 'active' });
    throw new UploadSessionError(502, 'STORAGE_COMPLETE_FAILED',
      `Storage could not assemble the upload: ${error instanceof Error ? error.message : String(error)}`);
  }

  let fileId: string | undefined;
  try {
    const file = await StorageService.recordCommittedUpload(
      tenant,
      { storagePath: storedPath, originalName: session.file_name, mime: session.mime_type, size: session.declared_size },
      { uploaded_by_id: user.user_id },
    );
    fileId = file.file_id;
    const documentType = await resolveDocumentTypeForMime(knex, tenant, session.mime_type);
    const created = await createDocumentFromCommittedFile({
      user,
      tenant,
      knex,
      file: { file_id: file.file_id, storage_path: file.storage_path },
      name: session.file_name,
      mimeType: session.mime_type,
      size: session.declared_size,
      documentType,
      options: uploadOptionsForSession(session),
      source: 'resumableUpload',
      // The session becomes `completed` in the same transaction as the document it produced, so a
      // crash can never leave a document behind a session that still says `completing`.
      withinTransaction: async (trx, document) => {
        const done = await transition(trx, tenant, sessionId, 'completing', { status: 'completed', document_id: document.document_id });
        if (!done) throw new UploadSessionError(409, 'UPLOAD_NOT_COMPLETING', 'Upload session is no longer completing');
      },
    });
    if (isActionPermissionErrorResult(created)) {
      throw new UploadSessionError(403, 'FORBIDDEN', (created as ActionPermissionErrorShape).permissionError);
    }
    return { document: summarize(session, created.document.document_id), alreadyCompleted: false };
  } catch (error) {
    // If the document did commit (a failure after it), the upload succeeded: never delete its bytes.
    const current = await findUploadSession(knex, tenant, user.user_id, sessionId).catch(() => null);
    if (current?.status === 'completed') return existing(current);
    if (fileId) await StorageService.deleteFile(fileId, user.user_id).catch((cleanup) =>
      console.error('[documentUploadSessions] Failed to remove the unclaimed file', cleanup));
    else await provider.delete(storedPath).catch(() => undefined);
    await transition(knex, tenant, sessionId, 'completing', { status: 'aborted' });
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------
// Abort and expiry

export interface AbortUploadInput {
  knex: Knex;
  tenant: string;
  userId: string;
  sessionId: string;
  provider?: StorageProviderInterface;
}

/** Idempotent: aborting an aborted or expired upload re-attempts the provider abort and succeeds. */
export async function abortUploadSession(input: AbortUploadInput): Promise<void> {
  const { knex, tenant, userId, sessionId } = input;
  const session = await requireSession(knex, tenant, userId, sessionId);
  if (session.status === 'completed') {
    throw new UploadSessionError(409, 'UPLOAD_COMPLETED', 'Upload is already completed; delete the document instead');
  }
  if (session.status === 'completing') {
    throw new UploadSessionError(409, 'COMPLETE_IN_PROGRESS', 'Upload is being completed');
  }
  if (session.status === 'active') {
    const won = await transition(knex, tenant, sessionId, 'active', { status: 'aborted', chunk_claim_token: null, chunk_claim_expires_at: null });
    if (!won) {
      // Lost a race with complete/another abort/the sweeper: report the state it is in now.
      const current = await requireSession(knex, tenant, userId, sessionId);
      if (current.status === 'completed' || current.status === 'completing') {
        throw new UploadSessionError(409, `UPLOAD_${current.status.toUpperCase()}`, `Upload is ${current.status}`);
      }
    }
  }
  const provider = input.provider ?? await StorageProviderFactory.createProvider();
  // The provider abort is idempotent; a failure is surfaced so the client can repeat the DELETE.
  await provider.abortWrite(session.write_handle);
}

export interface ExpireUploadsResult {
  expired: number;
  abortFailures: number;
}

/**
 * Expires this tenant's sessions that are past `expires_at` and still `active` or `completing`:
 * marks each `expired` (conditionally, so a session that just completed is left alone), then aborts
 * its provider write session. An abort error is logged and never stops the sweep; the bucket
 * lifecycle rule is the backstop for anything that stays behind.
 */
export async function expireUploadSessions(
  knex: Knex,
  tenant: string,
  options: { now?: Date; limit?: number; provider?: StorageProviderInterface } = {},
): Promise<ExpireUploadsResult> {
  const now = options.now ?? new Date();
  const due = await sessions(knex, tenant)
    .whereIn('status', ['active', 'completing'])
    .where('expires_at', '<', now)
    .orderBy('expires_at')
    .limit(options.limit ?? 100)
    .select('session_id', 'write_handle');
  const result: ExpireUploadsResult = { expired: 0, abortFailures: 0 };
  let provider = options.provider;
  for (const row of due) {
    try {
      const won = await sessions(knex, tenant)
        .where({ session_id: row.session_id })
        .whereIn('status', ['active', 'completing'])
        .where('expires_at', '<', now)
        .update({ status: 'expired', chunk_claim_token: null, chunk_claim_expires_at: null, updated_at: new Date() });
      if (won !== 1) continue;
      result.expired += 1;
      provider ??= await StorageProviderFactory.createProvider();
      const handle = typeof row.write_handle === 'string' ? JSON.parse(row.write_handle) : row.write_handle;
      await provider.abortWrite(handle);
    } catch (error) {
      result.abortFailures += 1;
      console.error('[documentUploadSessions] Failed to abort expired upload session', { tenant, sessionId: row.session_id, error });
    }
  }
  return result;
}
