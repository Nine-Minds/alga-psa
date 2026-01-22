import { z } from 'zod';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import type { ActionContext } from '../../registries/actionRegistry';

export type TenantTxContext = {
  tenantId: string;
  actorUserId: string;
  trx: Knex.Transaction;
};

export type ActionErrorCategory = 'ValidationError' | 'ActionError' | 'TransientError';

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

export function rethrowAsStandardError(ctx: ActionContext, error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);

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

export async function resolveRunActorUserId(trx: Knex.Transaction, runId: string): Promise<string | null> {
  const row = await trx('workflow_runs as wr')
    .leftJoin('workflow_definition_versions as wdv', function joinVersions() {
      this.on('wr.workflow_id', 'wdv.workflow_id').andOn('wr.workflow_version', 'wdv.version');
    })
    .leftJoin('workflow_definitions as wd', 'wr.workflow_id', 'wd.workflow_id')
    .select(
      'wdv.published_by as published_by',
      'wd.created_by as created_by'
    )
    .where('wr.run_id', runId)
    .first();
  return (row?.published_by as string | null) ?? (row?.created_by as string | null) ?? null;
}

export async function hasPermissionByUserId(
  trx: Knex.Transaction,
  tenantId: string,
  userId: string,
  resource: string,
  action: string
): Promise<boolean> {
  const row = await trx('user_roles as ur')
    .join('roles as r', function joinRoles() {
      this.on('ur.tenant', 'r.tenant').andOn('ur.role_id', 'r.role_id');
    })
    .join('role_permissions as rp', function joinRolePerms() {
      this.on('r.tenant', 'rp.tenant').andOn('r.role_id', 'rp.role_id');
    })
    .join('permissions as p', function joinPerms() {
      this.on('rp.tenant', 'p.tenant').andOn('rp.permission_id', 'p.permission_id');
    })
    .where({
      'ur.tenant': tenantId,
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
  await tx.trx('audit_logs').insert({
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

  return await knex.transaction(async (trx) => {
    await setTenantContext(trx, tenantId);
    const actorUserId = await resolveRunActorUserId(trx, ctx.runId);
    if (!actorUserId) {
      throwActionError(ctx, { category: 'ActionError', code: 'INTERNAL_ERROR', message: 'Workflow actor user not found' });
    }
    return await fn({ tenantId, actorUserId, trx });
  });
}

export const uuidSchema = z.string().uuid();
export const isoDateTimeSchema = z.string().datetime();

export const attachmentSourceSchema = z.object({
  file_id: uuidSchema.optional().describe('Existing storage file id (external_files.file_id)'),
  document_id: uuidSchema.optional().describe('Existing document id (documents.document_id)'),
  url: z.string().url().optional().describe('URL to download and ingest into storage')
}).refine((val) => Boolean(val.file_id || val.document_id || val.url), {
  message: 'One of file_id, document_id, or url is required'
});

export type AttachmentSource = z.infer<typeof attachmentSourceSchema>;

export const MAX_ATTACHMENT_BYTES = Number(process.env.WORKFLOW_ACTION_ATTACHMENT_MAX_BYTES ?? 10 * 1024 * 1024);
export const ALLOWED_ATTACHMENT_MIME_TYPES = new Set<string>([
  'application/pdf',
  'text/plain',
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/octet-stream'
]);

export function isAllowedAttachmentMimeType(mimeType: string | null): boolean {
  if (!mimeType) return true;
  const normalized = mimeType.split(';')[0]?.trim().toLowerCase() ?? mimeType.toLowerCase();
  return ALLOWED_ATTACHMENT_MIME_TYPES.has(normalized);
}

export async function attachDocumentToTicket(
  ctx: ActionContext,
  tx: TenantTxContext,
  ticketId: string,
  input: { source: AttachmentSource; filename?: string | null; visibility?: 'public' | 'internal' }
): Promise<{ document_id: string; file_id?: string | null; filename: string; content_type?: string | null }> {
  // Ensure ticket exists.
  const ticket = await tx.trx('tickets').where({ tenant: tx.tenantId, ticket_id: ticketId }).first();
  if (!ticket) {
    throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Ticket not found', details: { ticket_id: ticketId } });
  }

  const nowIso = new Date().toISOString();

  // If this is already a document, just associate it to the ticket.
  if (input.source.document_id) {
    const doc = await tx.trx('documents').where({ tenant: tx.tenantId, document_id: input.source.document_id }).first();
    if (!doc) {
      throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Document not found', details: { document_id: input.source.document_id } });
    }

    await tx.trx('document_associations')
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
  if (input.source.file_id) {
    fileRecord = await tx.trx('external_files').where({ tenant: tx.tenantId, file_id: input.source.file_id, is_deleted: false }).first();
    if (!fileRecord) {
      throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'File not found', details: { file_id: input.source.file_id } });
    }
    if (typeof fileRecord.file_size === 'number' && fileRecord.file_size > MAX_ATTACHMENT_BYTES) {
      throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: 'Attachment too large' });
    }
    if (!isAllowedAttachmentMimeType(fileRecord.mime_type ?? null)) {
      throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: 'Attachment mime_type not allowed' });
    }
  } else if (input.source.url) {
    const url = new URL(input.source.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: 'Only http(s) URLs are allowed for attachment ingest' });
    }

    let buffer: Buffer;
    let contentType: string | null = null;
    try {
      const response = await (globalThis as any).fetch(input.source.url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const arrayBuf = await response.arrayBuffer();
      buffer = Buffer.from(arrayBuf);
      contentType = response.headers.get('content-type');
    } catch (error) {
      throwActionError(ctx, {
        category: 'TransientError',
        code: 'TRANSIENT_FAILURE',
        message: 'Failed to download attachment URL',
        details: { url: input.source.url, error: error instanceof Error ? error.message : String(error) }
      });
    }

    if (buffer.length > MAX_ATTACHMENT_BYTES) {
      throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: 'Attachment too large' });
    }
    if (!isAllowedAttachmentMimeType(contentType)) {
      throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: 'Attachment mime_type not allowed' });
    }

    const { StorageProviderFactory, generateStoragePath } = await import('@/lib/storage/StorageProviderFactory');
    const provider = await StorageProviderFactory.createProvider();
    const filename = input.filename ?? new URL(input.source.url).pathname.split('/').filter(Boolean).pop() ?? 'attachment.bin';
    const storagePath = generateStoragePath(tx.tenantId, '', filename);

    let uploadPath: string;
    try {
      const result = await provider.upload(buffer, storagePath, { mime_type: contentType ?? 'application/octet-stream' } as any);
      uploadPath = (result as any).path ?? storagePath;
    } catch (error) {
      throwActionError(ctx, {
        category: 'TransientError',
        code: 'TRANSIENT_FAILURE',
        message: 'Failed to upload attachment to storage',
        details: { error: error instanceof Error ? error.message : String(error) }
      });
    }

    const fileId = uuidv4();
    const fileName = storagePath.split('/').pop() ?? filename;
    await tx.trx('external_files').insert({
      tenant: tx.tenantId,
      file_id: fileId,
      file_name: fileName,
      original_name: filename,
      mime_type: contentType ?? 'application/octet-stream',
      file_size: buffer.length,
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
      mime_type: contentType ?? 'application/octet-stream',
      file_size: buffer.length,
      storage_path: uploadPath
    };
  }

  if (!fileRecord) {
    throwActionError(ctx, { category: 'ActionError', code: 'INTERNAL_ERROR', message: 'Attachment source resolution failed' });
  }

  // Create a document pointing at the file, then associate it to the ticket.
  const documentId = uuidv4();
  const documentName = input.filename ?? fileRecord.original_name ?? fileRecord.file_name ?? 'attachment';
  await tx.trx('documents').insert({
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

  await tx.trx('document_associations').insert({
    tenant: tx.tenantId,
    document_id: documentId,
    entity_id: ticketId,
    entity_type: 'ticket',
    created_at: nowIso
  });

  return {
    document_id: documentId,
    file_id: fileRecord.file_id ?? null,
    filename: documentName,
    content_type: fileRecord.mime_type ?? null
  };
}

export function actionProvidedKey(input: { idempotency_key?: string | null }, ctx: ActionContext): string {
  if (input.idempotency_key && String(input.idempotency_key).trim()) return String(input.idempotency_key).trim();
  return `run:${ctx.runId}:${ctx.stepPath}`;
}
