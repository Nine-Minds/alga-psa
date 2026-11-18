import { z } from 'zod';
import type { Knex } from 'knex';
import { admitWrite, tenantDb, withTransaction } from '@alga-psa/db';
import { isCoManagedLifecycleError } from '@alga-psa/licensing/lifecycle-error';
import { v4 as uuidv4 } from 'uuid';
import type { ActionContext } from '../../registries/actionRegistry';
import { coManagedWorkflowTicketSeam } from '../../../../lib/coManagedDelivery';

export type TenantTxContext = {
  tenantId: string;
  actorUserId: string;
  /** The workflow definition this run executes. */
  workflowId: string;
  /** Workflow ids that caused this run (from its trigger metadata), oldest first. */
  lineage: string[];
  trx: Knex.Transaction;
};

export type ActionErrorCategory = 'ValidationError' | 'ActionError' | 'TransientError';
export const phoneMatchModes = ['exact', 'last7', 'last10'] as const;
export type PhoneMatchMode = (typeof phoneMatchModes)[number];

export function throwActionError(
  ctx: ActionContext,
  params: { category: ActionErrorCategory; code: string; message: string; details?: Record<string, unknown> }
): never {
  throw {
    category: params.category,
    code: params.code,
    message: params.message,
    details: params.details ?? null,
    nodePath: ctx.stepPath,
    at: new Date().toISOString()
  };
}

/** A lifecycle refusal keeps its own code, so a run fails as "read-only" or
 * "awaiting acceptance" rather than as an internal error. */
function throwIfLifecycleRefusal(ctx: ActionContext, error: unknown): void {
  if (isCoManagedLifecycleError(error)) {
    throwActionError(ctx, {
      category: 'ActionError',
      code: error.code,
      message: error.message,
      details: { lifecycle_state: error.lifecycle.state },
    });
  }
}

/**
 * Write admission for a workflow action whose transaction will change
 * tag_definitions or tag_mappings. Call it before the action writes any row,
 * in the action's own transaction. It dispatches through the write-admission
 * primitive: with no provider registered it resolves without touching `tx.trx`.
 * A lifecycle refusal from a provider surfaces as an ActionError.
 */
// LEVERAGE: friction workflow-lifecycle-admission — withTenantTransaction admits nothing, so tag writes admit per action and the same actions' non-tag writes (ticket, contact and client rows) stay unadmitted for a read-only workspace; admission belongs in the runtime's write transaction
export async function admitWorkflowTagWrite(ctx: ActionContext, tx: TenantTxContext): Promise<void> {
  try {
    await admitWrite(tx.trx, { tenant: tx.tenantId, operation: 'workflow-tag-write' });
  } catch (error) {
    throwIfLifecycleRefusal(ctx, error);
    throw error;
  }
}

export function rethrowAsStandardError(ctx: ActionContext, error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);

  throwIfLifecycleRefusal(ctx, error);
  if (error instanceof z.ZodError) {
    throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message });
  }
  // Human-work guard (R5.3): keep the guard's stable codes instead of collapsing to INTERNAL_ERROR.
  const guardCode = (error as { code?: unknown } | null)?.code;
  if (guardCode === 'HUMAN_WORK_ASSIGNEE_INVALID' || guardCode === 'HUMAN_WORK_OWNER_REQUIRED') {
    const guardError = error as { userIds?: string[]; field?: string };
    throwActionError(ctx, {
      category: 'ValidationError',
      code: guardCode,
      message,
      details: guardCode === 'HUMAN_WORK_ASSIGNEE_INVALID' ? { userIds: guardError.userIds ?? [] } : { field: guardError.field ?? null },
    });
  }
  if (/VALIDATION_ERROR:|validation failed|input validation failed/i.test(message)) {
    throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message });
  }
  if (/not found/i.test(message)) {
    throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message });
  }
  if (/duplicate|unique|conflict/i.test(message)) {
    throwActionError(ctx, { category: 'ActionError', code: 'CONFLICT', message });
  }
  if (/rate limit/i.test(message)) {
    throwActionError(ctx, { category: 'TransientError', code: 'RATE_LIMITED', message });
  }
  if (/deadlock|timeout|temporar/i.test(message)) {
    throwActionError(ctx, { category: 'TransientError', code: 'TRANSIENT_FAILURE', message });
  }

  throwActionError(ctx, { category: 'ActionError', code: 'INTERNAL_ERROR', message });
}

export function parseJsonMaybe(value: unknown): any {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (typeof value === 'object') return value;
  return null;
}

export function normalizePhoneDigits(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

export function buildNormalizedPhoneMatchCondition(
  columnRef: string,
  digits: string,
  mode: PhoneMatchMode = 'exact'
): { sql: string; bindings: Array<string | number> } {
  const normalizedColumn = `regexp_replace(coalesce(??, ''), '\\D', '', 'g')`;

  if (mode === 'last7' || mode === 'last10') {
    const length = mode === 'last7' ? 7 : 10;
    return {
      sql: `right(${normalizedColumn}, ?) = right(?, ?)`,
      bindings: [columnRef, length, digits, length],
    };
  }

  return {
    sql: `${normalizedColumn} = ?`,
    bindings: [columnRef, digits],
  };
}

export function isJsonArrayString(value: string): boolean {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed);
  } catch {
    return false;
  }
}

export function buildBlockNoteWithMentions(params: { body: string; mentions?: string[] | null }): string {
  const body = params.body ?? '';
  if (isJsonArrayString(body)) return body;

  const mentions = (params.mentions ?? []).filter((value) => String(value).trim());
  const paragraph: any = {
    type: 'paragraph',
    content: [] as any[]
  };

  for (const userId of mentions) {
    paragraph.content.push({ type: 'mention', props: { userId: String(userId) } });
  }

  if (body.trim()) {
    paragraph.content.push({
      type: 'text',
      text: `${mentions.length ? ' ' : ''}${body}`
    });
  }

  return JSON.stringify([paragraph]);
}

export async function setTenantContext(trx: Knex.Transaction, tenantId: string): Promise<void> {
  await trx.raw(`select set_config('app.current_tenant', ?, true)`, [tenantId]);
}

export type RunContext = {
  actorUserId: string;
  workflowId: string;
  lineage: string[];
};

/**
 * Resolves who a run acts as and where it sits in a workflow-triggered chain.
 * The actor is the publisher (else the creator) of the workflow version the run executed; the
 * lineage is `trigger_metadata_json.workflowLineage`, stamped by the event-stream
 * worker when an event published by another workflow launched this run.
 */
export async function resolveRunContext(trx: Knex.Transaction, tenantId: string, runId: string): Promise<RunContext | null> {
  const db = tenantDb(trx, tenantId);
  const query = db.table('workflow_runs as wr');
  db.tenantJoin(query, 'workflow_definition_versions as wdv', 'wr.workflow_id', 'wdv.workflow_id', {
    type: 'left',
    rootTenantColumn: 'wr.tenant',
    // Pin to the version this run actually executed; without it every published
    // version of the workflow matches and .first() picks an arbitrary publisher.
    on: join => join.andOn('wr.workflow_version', '=', 'wdv.version')
  });
  db.tenantJoin(query, 'workflow_definitions as wd', 'wr.workflow_id', 'wd.workflow_id', {
    type: 'left',
    rootTenantColumn: 'wr.tenant'
  });
  const row = await query
    .select(
      'wd.workflow_id as matched_workflow_id',
      'wdv.published_by as published_by',
      'wd.created_by as created_by',
      'wr.trigger_metadata_json as trigger_metadata'
    )
    .where('wr.run_id', runId)
    .first() as {
      matched_workflow_id?: string | null;
      published_by?: string | null;
      created_by?: string | null;
      trigger_metadata?: unknown;
    } | undefined;
  if (!row?.matched_workflow_id) return null;
  const actorUserId = (row.published_by as string | null) ?? (row.created_by as string | null) ?? null;
  if (!actorUserId) return null;

  let metadata = row.trigger_metadata;
  if (typeof metadata === 'string') {
    try {
      metadata = JSON.parse(metadata);
    } catch {
      metadata = null;
    }
  }
  const rawLineage = (metadata as { workflowLineage?: unknown } | null | undefined)?.workflowLineage;
  const lineage = Array.isArray(rawLineage)
    ? rawLineage.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : [];

  return { actorUserId, workflowId: row.matched_workflow_id, lineage };
}

export async function hasPermissionByUserId(
  trx: Knex.Transaction,
  tenantId: string,
  userId: string,
  resource: string,
  action: string
): Promise<boolean> {
  const db = tenantDb(trx, tenantId);
  const query = db.table('user_roles as ur');
  db.tenantJoin(query, 'roles as r', 'ur.role_id', 'r.role_id', {
    rootTenantColumn: 'ur.tenant'
  });
  db.tenantJoin(query, 'role_permissions as rp', 'r.role_id', 'rp.role_id', {
    rootTenantColumn: 'ur.tenant'
  });
  db.tenantJoin(query, 'permissions as p', 'rp.permission_id', 'p.permission_id', {
    rootTenantColumn: 'ur.tenant'
  });
  const row = await query
    .where({
      'ur.user_id': userId,
      'p.resource': resource,
      'p.action': action
    })
    // Default to MSP portal permissions for workflow executions.
    .where('p.msp', true)
    .where('r.msp', true)
    .first();

  return !!row;
}

export async function requirePermission(
  ctx: ActionContext,
  tx: TenantTxContext,
  permission: { resource: string; action: string }
): Promise<void> {
  const ok = await hasPermissionByUserId(tx.trx, tx.tenantId, tx.actorUserId, permission.resource, permission.action);
  if (ok) return;
  throwActionError(ctx, {
    category: 'ActionError',
    code: 'PERMISSION_DENIED',
    message: `Permission denied: ${permission.resource}:${permission.action}`,
    details: permission
  });
}

export async function writeRunAudit(
  ctx: ActionContext,
  tx: TenantTxContext,
  params: { operation: string; changedData?: Record<string, unknown>; details?: Record<string, unknown> }
): Promise<void> {
  await tenantDb(tx.trx, tx.tenantId).table('audit_logs').insert({
    audit_id: uuidv4(),
    tenant: tx.tenantId,
    user_id: tx.actorUserId,
    operation: params.operation,
    table_name: 'workflow_runs',
    record_id: ctx.runId,
    changed_data: params.changedData ?? {},
    details: {
      action_id: params.details?.action_id ?? null,
      action_version: params.details?.action_version ?? null,
      step_path: ctx.stepPath,
      ...params.details
    },
    timestamp: new Date().toISOString()
  });
}

export async function withTenantTransaction<T>(
  ctx: ActionContext,
  fn: (tx: TenantTxContext) => Promise<T>
): Promise<T> {
  const tenantId = ctx.tenantId ?? null;
  if (!tenantId) {
    throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: 'tenantId is required' });
  }
  const knex = ctx.knex as Knex | undefined;
  if (!knex) {
    throwActionError(ctx, { category: 'ActionError', code: 'INTERNAL_ERROR', message: 'Database connection unavailable' });
  }

  // An owning withTransaction frame (not a raw knex.transaction) so that
  // registerAfterCommit hooks registered by an action - such as the ticket
  // events from createTicketWithSideEffects - flush after the commit instead of
  // being dropped. ctx.knex is a root connection, never an outer transaction.
  return await withTransaction(knex, async (trx) => {
    await setTenantContext(trx, tenantId);
    const run = await resolveRunContext(trx, tenantId, ctx.runId);
    if (!run) {
      throwActionError(ctx, { category: 'ActionError', code: 'INTERNAL_ERROR', message: 'Workflow actor user not found' });
    }
    return await fn({ tenantId, actorUserId: run.actorUserId, workflowId: run.workflowId, lineage: run.lineage, trx });
  });
}

export const uuidSchema = z.string().guid();
export const isoDateTimeSchema = z.string().datetime();

export const attachmentSourceSchema = z.object({
  file_id: uuidSchema.optional().describe('Existing storage file id (external_files.file_id)'),
  document_id: uuidSchema.optional().describe('Existing document id (documents.document_id)'),
  url: z.string().url().optional().describe('URL to download and ingest into storage')
}).refine((val) => Boolean(val.file_id || val.document_id || val.url), {
  message: 'One of file_id, document_id, or url is required'
});

export type AttachmentSource = z.infer<typeof attachmentSourceSchema>;

/**
 * What a workflow action may attach, in bytes. Deliberately below the provider max: a workflow
 * runs unattended and an attachment is also re-read into memory when an email action sends it.
 * Never advertised above the provider's own limit: `effectiveBufferedCap` clamps it at use.
 */
export function getMaxAttachmentBytes(): number {
  // Read at call time: a malformed value fails the attachment action with a clear error, not module import.
  return parseAttachmentMaxBytes(process.env.WORKFLOW_ACTION_ATTACHMENT_MAX_BYTES, 10 * 1024 * 1024);
}

/** Strict: a whole number of bytes > 0. `Number("10MB")` is NaN, which would silently disable the limit. */
export function parseAttachmentMaxBytes(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const bytes = /^\s*\d+\s*$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new Error(`WORKFLOW_ACTION_ATTACHMENT_MAX_BYTES must be a whole number of bytes greater than 0, e.g. 10485760 (got "${raw}")`);
  }
  return bytes;
}

/** Total time a url attachment may take to download (headers and body), via AbortController. */
export const ATTACHMENT_URL_FETCH_TIMEOUT_MS = 60_000;

export async function attachDocumentToTicket(
  ctx: ActionContext,
  tx: TenantTxContext,
  ticketId: string,
  input: { source: AttachmentSource; filename?: string | null; visibility?: 'public' | 'internal' }
): Promise<{ document_id: string; file_id?: string | null; filename: string; content_type?: string | null }> {
  const db = tenantDb(tx.trx, tx.tenantId);

  // Ensure ticket exists.
  const ticket = await db.table('tickets').where({ ticket_id: ticketId }).first();
  if (!ticket) {
    throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Ticket not found', details: { ticket_id: ticketId } });
  }

  const nowIso = new Date().toISOString();

  // If this is already a document, just associate it to the ticket.
  if (input.source.document_id) {
    const doc = await db.table('documents').where({ document_id: input.source.document_id }).first();
    if (!doc) {
      throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Document not found', details: { document_id: input.source.document_id } });
    }

    await db.table('document_associations')
      .insert({
        tenant: tx.tenantId,
        document_id: input.source.document_id,
        entity_id: ticketId,
        entity_type: 'ticket',
        created_at: nowIso
      })
      .onConflict(['tenant', 'document_id', 'entity_id', 'entity_type'])
      .ignore();

    return {
      document_id: input.source.document_id,
      file_id: (doc.file_id as string | null) ?? null,
      filename: (doc.document_name as string) ?? 'document',
      content_type: (doc.mime_type as string | null) ?? null
    };
  }

  // For file_id or url, ensure we have a file record (create one if url).
  let fileRecord: any | null = null;
  // Set once the url branch has committed an object; removed if the rows that claim it do not land.
  let unclaimedObject: { delete(path: string): Promise<void>; path: string } | null = null;
  if (input.source.file_id) {
    fileRecord = await db.table('external_files').where({ file_id: input.source.file_id, is_deleted: false }).first();
    if (!fileRecord) {
      throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'File not found', details: { file_id: input.source.file_id } });
    }
    if (typeof fileRecord.file_size === 'number' && fileRecord.file_size > getMaxAttachmentBytes()) {
      throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: 'Attachment too large' });
    }
    // Unify with the same MIME/size policy manual upload uses so workflow
    // attachments (including audio) accept exactly what a tenant may upload.
    // Import the narrow subpath (not the barrel): StorageService delegates to
    // this same function and the barrel drags in a validation module that the
    // native workflow-worker runtime cannot resolve.
    try {
      const { validateFileUpload } = await import('@alga-psa/storage/config/storage');
      await validateFileUpload(
        fileRecord.mime_type ?? 'application/octet-stream',
        Number(fileRecord.file_size ?? 0)
      );
    } catch (error) {
      throwActionError(ctx, {
        category: 'ValidationError',
        code: 'VALIDATION_ERROR',
        message: error instanceof Error ? error.message : 'Attachment mime_type not allowed'
      });
    }
  } else if (input.source.url) {
    const url = new URL(input.source.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: 'Only http(s) URLs are allowed for attachment ingest' });
    }

    // The policy is the provider's: size ceiling and MIME allowlist, same as manual upload. Narrow
    // subpaths only (never the barrel): the native workflow-worker runtime cannot resolve it.
    const { getUploadPolicy } = await import('@alga-psa/storage/config/storage');
    const { effectiveBufferedCap } = await import('@alga-psa/storage/ingest/bufferedCap');
    const { ingestToWriteSession } = await import('@alga-psa/storage/ingest/pipeline');
    const { isUploadContentTypeError, isUploadSizeLimitError } = await import('@alga-psa/storage/ingest/errors');
    const { StorageProviderFactory, generateStoragePath } = await import('@alga-psa/storage/StorageProviderFactory');
    const { Readable } = await import('node:stream');

    const policy = await getUploadPolicy();
    const cap = effectiveBufferedCap(getMaxAttachmentBytes(), policy.maxFileSize, 'WORKFLOW_ACTION_ATTACHMENT_MAX_BYTES');
    const filename = input.filename ?? new URL(input.source.url).pathname.split('/').filter(Boolean).pop() ?? 'attachment.bin';
    const provider = await StorageProviderFactory.createProvider();
    const storagePath = generateStoragePath(tx.tenantId, '', filename);

    // LEVERAGE: friction safe-fetch-in-shared — server/src/lib/net/safeFetch (SSRF policy, host allowlist, pinned DNS, byte guard) is the fetch the REST url source uses, but shared/ cannot import server/; this is a bare fetch with only a byte guard and timeout. Moving safeFetch into shared/ would give workflows the same policy.
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), ATTACHMENT_URL_FETCH_TIMEOUT_MS);
    let ingested: Awaited<ReturnType<typeof ingestToWriteSession>>;
    let contentType: string | null = null;
    try {
      const response = await (globalThis as any).fetch(input.source.url, { signal: abort.signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      contentType = response.headers.get('content-type');
      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > cap) {
        await response.body?.cancel?.().catch?.(() => undefined);
        throw Object.assign(new Error('Attachment too large'), { tooLarge: true });
      }
      // Streamed into the ingest: the byte guard aborts past the cap, so the body is never held whole.
      ingested = await ingestToWriteSession(
        response.body ? Readable.fromWeb(response.body) : Readable.from([]),
        provider,
        storagePath,
        {
          maxFileSize: cap,
          declaredMime: contentType?.split(';')[0]?.trim().toLowerCase() || 'application/octet-stream',
          allowedMimeTypes: policy.allowedMimeTypes,
        }
      );
    } catch (error) {
      if (isUploadSizeLimitError(error) || (error as any)?.tooLarge) {
        throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: 'Attachment too large' });
      }
      if (isUploadContentTypeError(error)) {
        throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: error.message });
      }
      throwActionError(ctx, {
        category: 'TransientError',
        code: 'TRANSIENT_FAILURE',
        message: 'Failed to download attachment URL',
        details: {
          url: input.source.url,
          error: abort.signal.aborted ? 'Timed out' : error instanceof Error ? error.message : String(error)
        }
      });
    } finally {
      clearTimeout(timer);
      abort.abort();
    }

    const uploadPath = ingested.upload.path ?? storagePath;
    unclaimedObject = { delete: (path) => provider.delete(path), path: uploadPath };
    try {
      const storedMime = ingested.mime;
      const fileId = uuidv4();
      const fileName = storagePath.split('/').pop() ?? filename;
      await db.table('external_files').insert({
        tenant: tx.tenantId,
        file_id: fileId,
        file_name: fileName,
        original_name: filename,
        mime_type: storedMime,
        file_size: ingested.size,
        content_sha256: ingested.sha256,
        storage_path: uploadPath,
        uploaded_by_id: tx.actorUserId,
        created_at: nowIso,
        updated_at: nowIso,
        is_deleted: false,
        metadata: { source: 'workflow', url: input.source.url }
      });

      fileRecord = {
        file_id: fileId,
        file_name: fileName,
        original_name: filename,
        mime_type: storedMime,
        file_size: ingested.size,
        storage_path: uploadPath
      };
    } catch (error) {
      await removeUnclaimedObject(unclaimedObject);
      throw error;
    }
  }

  if (!fileRecord) {
    throwActionError(ctx, { category: 'ActionError', code: 'INTERNAL_ERROR', message: 'Attachment source resolution failed' });
  }

  // Create a document pointing at the file, then associate it to the ticket.
  const documentName = input.filename ?? fileRecord.original_name ?? fileRecord.file_name ?? 'attachment';
  const documentId = uuidv4();
  try {
    await db.table('documents').insert({
      tenant: tx.tenantId,
      document_id: documentId,
      document_name: documentName,
      type_id: null,
      shared_type_id: null,
      user_id: tx.actorUserId,
      created_by: tx.actorUserId,
      entered_at: nowIso,
      updated_at: nowIso,
      file_id: fileRecord.file_id,
      storage_path: fileRecord.storage_path,
      mime_type: fileRecord.mime_type,
      file_size: fileRecord.file_size
    });

    await db.table('document_associations').insert({
      tenant: tx.tenantId,
      document_id: documentId,
      entity_id: ticketId,
      entity_type: 'ticket',
      created_at: nowIso
    });
  } catch (error) {
    await removeUnclaimedObject(unclaimedObject);
    throw error;
  }

  return {
    document_id: documentId,
    file_id: fileRecord.file_id ?? null,
    filename: documentName,
    content_type: fileRecord.mime_type ?? null
  };
}

/** Best-effort removal of an object whose external_files/documents rows were not created. */
async function removeUnclaimedObject(object: { delete(path: string): Promise<void>; path: string } | null): Promise<void> {
  if (!object) return;
  try {
    await object.delete(object.path);
  } catch (cleanupError) {
    console.error('[workflow] Unable to remove unclaimed attachment from storage', cleanupError);
  }
}

export function actionProvidedKey(input: { idempotency_key?: string | null }, ctx: ActionContext): string {
  if (input.idempotency_key && String(input.idempotency_key).trim()) return String(input.idempotency_key).trim();
  return `run:${ctx.runId}:${ctx.stepPath}`;
}

/** Thrown when co-managed serves (or may serve) the tenant but no workflow-ticket authority could be resolved (provider missing, or the verdict is unknown/errored). */
export class WorkflowTicketAuthorityUnavailableError extends Error {
  readonly code = 'WORKFLOW_TICKET_AUTHORITY_UNAVAILABLE';
  constructor(readonly reason: string, readonly providerRegistered: boolean) {
    super(`Co-managed workflow ticket authority is unavailable (provider ${providerRegistered ? 'registered' : 'not registered'}; capability verdict: ${reason}); refusing the ticket mutation`);
    this.name = 'WorkflowTicketAuthorityUnavailableError';
  }
}

/** The only serves() reasons that are a definite "co-managed does not serve this tenant". Anything else is unknown. */
const DEFINITE_NOT_SERVED_REASONS = new Set(['forced-off', 'not-participating']);

/**
 * Ticket-mutation adapter (CM L4a): for a tenant the co-managed capability serves, retain the executing
 * run / published-version / author authority before a workflow action mutates a ticket. A tenant that is
 * not served costs one cached `serves()` verdict and runs the action unchanged. Workflow actions never
 * publish TICKET_COMMENT_ADDED (DO-NOT-PORT #2); this adapter publishes nothing either.
 *
 * Fails closed: whenever no authority resolves (no provider, or a registered provider whose serves() verdict is unknown, e.g. participation-error), anything but a definite not-served throws,
 * so a worker that missed the co-managed registration can never fall back to the coarse role check.
 */
export async function retainWorkflowTicketAuthority(ctx: ActionContext, tx: TenantTxContext, ticketId: string, fields: string[], readFields: string[] = []): Promise<void> {
  const authority = await coManagedWorkflowTicketSeam.resolve(tx.tenantId);
  if (!authority) {
    // resolve() is null for "not served" AND for no provider / unknown verdict; only a definite not-served may proceed.
    // serves() hits the cache resolve() just filled (or answers from the forced value), so this is no extra SQL.
    const { serves } = await import('@alga-psa/core/capability');
    const verdict = await serves('co-managed', tx.tenantId);
    if (verdict.served || !DEFINITE_NOT_SERVED_REASONS.has(verdict.reasons.served)) {
      throw new WorkflowTicketAuthorityUnavailableError(verdict.served ? 'served' : verdict.reasons.served, coManagedWorkflowTicketSeam.hasProvider());
    }
    return;
  }
  await authority.retain(tx.trx, { tenant: tx.tenantId, ticketId, workflowRunId: ctx.runId, actorUserId: tx.actorUserId, fields, readFields });
}
