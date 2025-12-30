import { z } from 'zod';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { getActionRegistryV2, type ActionContext } from '../registries/actionRegistry';
import { TicketModel } from '../../../models/ticketModel';
import { ClientModel } from '../../../models/clientModel';
import { ContactModel } from '../../../models/contactModel';

type TenantTxContext = {
  tenantId: string;
  actorUserId: string;
  trx: Knex.Transaction;
};

type ActionErrorCategory = 'ValidationError' | 'ActionError' | 'TransientError';

function throwActionError(
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

function rethrowAsStandardError(ctx: ActionContext, error: unknown): never {
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

function parseJsonMaybe(value: unknown): any {
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

function isJsonArrayString(value: string): boolean {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed);
  } catch {
    return false;
  }
}

function buildBlockNoteWithMentions(params: { body: string; mentions?: string[] | null }): string {
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

async function setTenantContext(trx: Knex.Transaction, tenantId: string): Promise<void> {
  await trx.raw(`select set_config('app.current_tenant', ?, true)`, [tenantId]);
}

async function resolveRunActorUserId(trx: Knex.Transaction, runId: string): Promise<string | null> {
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

async function hasPermissionByUserId(
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

async function requirePermission(
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

async function writeRunAudit(
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

async function withTenantTransaction<T>(
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

const uuidSchema = z.string().uuid();
const isoDateTimeSchema = z.string().datetime();

const attachmentSourceSchema = z.object({
  file_id: uuidSchema.optional().describe('Existing storage file id (external_files.file_id)'),
  document_id: uuidSchema.optional().describe('Existing document id (documents.document_id)'),
  url: z.string().url().optional().describe('URL to download and ingest into storage')
}).refine((val) => Boolean(val.file_id || val.document_id || val.url), {
  message: 'One of file_id, document_id, or url is required'
});

type AttachmentSource = z.infer<typeof attachmentSourceSchema>;

const MAX_ATTACHMENT_BYTES = Number(process.env.WORKFLOW_ACTION_ATTACHMENT_MAX_BYTES ?? 10 * 1024 * 1024);
const ALLOWED_ATTACHMENT_MIME_TYPES = new Set<string>([
  'application/pdf',
  'text/plain',
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/octet-stream'
]);

function isAllowedAttachmentMimeType(mimeType: string | null): boolean {
  if (!mimeType) return true;
  const normalized = mimeType.split(';')[0]?.trim().toLowerCase() ?? mimeType.toLowerCase();
  return ALLOWED_ATTACHMENT_MIME_TYPES.has(normalized);
}

async function attachDocumentToTicket(
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

    const { StorageProviderFactory, generateStoragePath } = await import('server/src/lib/storage/StorageProviderFactory');
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

function actionProvidedKey(input: { idempotency_key?: string | null }, ctx: ActionContext): string {
  if (input.idempotency_key && String(input.idempotency_key).trim()) return String(input.idempotency_key).trim();
  return `run:${ctx.runId}:${ctx.stepPath}`;
}

export function registerBusinessOperationsActionsV2(): void {
  const registry = getActionRegistryV2();

  // ---------------------------------------------------------------------------
  // A01 — tickets.create
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'tickets.create',
    version: 1,
    inputSchema: z.object({
      client_id: uuidSchema.describe('Client id'),
      contact_id: uuidSchema.nullable().optional().describe('Optional contact id'),
      title: z.string().min(1).describe('Ticket subject/title'),
      description: z.string().default('').describe('Ticket description/body'),
      board_id: uuidSchema.describe('Board id'),
      status_id: uuidSchema.describe('Status id'),
      priority_id: uuidSchema.describe('Priority id'),
      assigned_to: uuidSchema.nullable().optional().describe('Assigned user id'),
      category_id: uuidSchema.nullable().optional().describe('Category id'),
      subcategory_id: uuidSchema.nullable().optional().describe('Subcategory id'),
      tags: z.array(z.string()).optional().describe('Optional tags (stored in ticket attributes)'),
      custom_fields: z.record(z.unknown()).optional().describe('Optional custom fields (stored in ticket attributes)'),
      attributes: z.record(z.unknown()).optional().describe('Additional attributes (merged into ticket.attributes)'),
      initial_comment: z.object({
        body: z.string().min(1).describe('Initial comment body'),
        visibility: z.enum(['public', 'internal']).default('public').describe('Comment visibility')
      }).optional().describe('Optional initial comment'),
      attachments: z.array(z.object({
        source: attachmentSourceSchema,
        filename: z.string().optional(),
        visibility: z.enum(['public', 'internal']).optional()
      })).optional().describe('Optional attachments (documents)'),
      idempotency_key: z.string().optional().describe('Optional external idempotency key')
    }),
    outputSchema: z.object({
      ticket_id: uuidSchema,
      ticket_number: z.string(),
      url: z.string().nullable(),
      created_at: isoDateTimeSchema,
      status_id: uuidSchema,
      priority_id: uuidSchema
    }),
    sideEffectful: true,
    idempotency: { mode: 'actionProvided', key: actionProvidedKey },
    ui: {
      label: 'Create Ticket',
      category: 'Business Operations',
      description: 'Create a ticket in Alga PSA'
    },
    examples: {
      minimal: {
        client_id: '00000000-0000-0000-0000-000000000000',
        title: 'Printer not working',
        description: 'The office printer is jammed.',
        board_id: '00000000-0000-0000-0000-000000000000',
        status_id: '00000000-0000-0000-0000-000000000000',
        priority_id: '00000000-0000-0000-0000-000000000000'
      }
    },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, { resource: 'ticket', action: 'create' });

      const mergedAttributes: Record<string, any> = {
        ...(input.attributes ?? {})
      };
      if (input.tags?.length) mergedAttributes.tags = input.tags;
      if (input.custom_fields) mergedAttributes.custom_fields = input.custom_fields;

      let created: any;
      try {
        created = await TicketModel.createTicket(
          {
            title: input.title,
            description: input.description ?? '',
            client_id: input.client_id,
            contact_id: input.contact_id ?? undefined,
            board_id: input.board_id,
            status_id: input.status_id,
            priority_id: input.priority_id,
            assigned_to: input.assigned_to ?? undefined,
            category_id: input.category_id ?? undefined,
            subcategory_id: input.subcategory_id ?? undefined,
            entered_by: tx.actorUserId,
            attributes: mergedAttributes
          },
          tx.tenantId,
          tx.trx,
          {},
          undefined,
          undefined,
          tx.actorUserId
        );
      } catch (error) {
        rethrowAsStandardError(ctx, error);
      }

      if (input.initial_comment?.body) {
        try {
          await TicketModel.createComment(
            {
              ticket_id: created.ticket_id,
              content: input.initial_comment.body,
              is_internal: input.initial_comment.visibility === 'internal',
              is_resolution: false,
              author_type: 'system',
              author_id: tx.actorUserId,
              metadata: { source: 'workflow', run_id: ctx.runId, step_path: ctx.stepPath }
            },
            tx.tenantId,
            tx.trx,
            undefined,
            undefined,
            tx.actorUserId
          );
        } catch (error) {
          rethrowAsStandardError(ctx, error);
        }
      }

      if (input.attachments?.length) {
        for (const attachment of input.attachments) {
          await attachDocumentToTicket(ctx, tx, created.ticket_id, {
            source: attachment.source,
            filename: attachment.filename ?? null,
            visibility: attachment.visibility
          });
        }
      }

      await writeRunAudit(ctx, tx, {
        operation: 'workflow_action:tickets.create',
        changedData: { ticket_id: created.ticket_id, ticket_number: created.ticket_number },
        details: { action_id: 'tickets.create', action_version: 1, ticket_id: created.ticket_id }
      });

      return {
        ticket_id: created.ticket_id,
        ticket_number: created.ticket_number,
        url: (created as any).url ?? null,
        created_at: created.entered_at,
        status_id: input.status_id,
        priority_id: input.priority_id
      };
    })
  });

  // ---------------------------------------------------------------------------
  // A02 — tickets.add_comment
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'tickets.add_comment',
    version: 1,
    inputSchema: z.object({
      ticket_id: uuidSchema.describe('Ticket id'),
      body: z.string().min(1).describe('Comment body'),
      visibility: z.enum(['public', 'internal']).default('public').describe('Comment visibility'),
      mentions: z.array(z.string().min(1)).optional().describe('Optional mentioned user ids (or @everyone)'),
      attachments: z.array(z.object({
        source: attachmentSourceSchema,
        filename: z.string().optional()
      })).optional().describe('Optional attachments (added to ticket)'),
      idempotency_key: z.string().optional().describe('Optional external idempotency key')
    }),
    outputSchema: z.object({
      comment_id: uuidSchema,
      created_at: isoDateTimeSchema,
      visibility: z.enum(['public', 'internal'])
    }),
    sideEffectful: true,
    idempotency: { mode: 'actionProvided', key: actionProvidedKey },
    ui: {
      label: 'Add Ticket Comment',
      category: 'Business Operations',
      description: 'Add a public or internal comment to a ticket'
    },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, { resource: 'ticket', action: 'update' });

      const content = input.mentions?.length ? buildBlockNoteWithMentions({ body: input.body, mentions: input.mentions }) : input.body;

      let created: any;
      try {
        created = await TicketModel.createComment(
          {
            ticket_id: input.ticket_id,
            content,
            is_internal: input.visibility === 'internal',
            is_resolution: false,
            author_type: 'system',
            author_id: tx.actorUserId,
            metadata: { source: 'workflow', run_id: ctx.runId, step_path: ctx.stepPath }
          },
          tx.tenantId,
          tx.trx,
          undefined,
          undefined,
          tx.actorUserId
        );
      } catch (error) {
        rethrowAsStandardError(ctx, error);
      }

      if (input.attachments?.length) {
        for (const attachment of input.attachments) {
          await attachDocumentToTicket(ctx, tx, input.ticket_id, {
            source: attachment.source,
            filename: attachment.filename ?? null
          });
        }
      }

      await writeRunAudit(ctx, tx, {
        operation: 'workflow_action:tickets.add_comment',
        changedData: { ticket_id: input.ticket_id, comment_id: created.comment_id },
        details: { action_id: 'tickets.add_comment', action_version: 1, ticket_id: input.ticket_id, comment_id: created.comment_id }
      });

      return {
        comment_id: created.comment_id,
        created_at: created.created_at,
        visibility: input.visibility
      };
    })
  });

  // ---------------------------------------------------------------------------
  // A03 — tickets.update_fields
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'tickets.update_fields',
    version: 1,
    inputSchema: z.object({
      ticket_id: uuidSchema.describe('Ticket id'),
      patch: z.object({
        status_id: uuidSchema.optional().describe('New status id'),
        priority_id: uuidSchema.optional().describe('New priority id'),
        assigned_to: uuidSchema.nullable().optional().describe('New assigned user id'),
        title: z.string().min(1).optional().describe('New title'),
        category_id: uuidSchema.nullable().optional().describe('Category id'),
        subcategory_id: uuidSchema.nullable().optional().describe('Subcategory id'),
        due_date: isoDateTimeSchema.nullable().optional().describe('Optional due date (stored in ticket.attributes.due_date)'),
        tags: z.array(z.string()).optional().describe('Tags (stored in ticket attributes)'),
        custom_fields: z.record(z.unknown()).optional().describe('Custom fields (stored in ticket attributes)'),
        attributes: z.record(z.unknown()).optional().describe('Attributes merge')
      }).describe('Patch object').refine((patch) => Object.keys(patch).length > 0, {
        message: 'Patch must include at least one field'
      }),
      expected_updated_at: isoDateTimeSchema.optional().describe('Optional optimistic concurrency token (ticket.updated_at)'),
      idempotency_key: z.string().optional().describe('Optional external idempotency key')
    }),
    outputSchema: z.object({
      ticket_id: uuidSchema,
      updated_at: isoDateTimeSchema,
      status_id: uuidSchema.nullable(),
      priority_id: uuidSchema.nullable(),
      tags: z.array(z.string()).nullable()
    }),
    sideEffectful: true,
    idempotency: { mode: 'actionProvided', key: actionProvidedKey },
    ui: {
      label: 'Update Ticket Fields',
      category: 'Business Operations',
      description: 'Patch core ticket fields (status, priority, assignment, attributes)'
    },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, { resource: 'ticket', action: 'update' });

      const current = await tx.trx('tickets').where({ tenant: tx.tenantId, ticket_id: input.ticket_id }).first();
      if (!current) {
        throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Ticket not found', details: { ticket_id: input.ticket_id } });
      }

      if (input.expected_updated_at) {
        const currentUpdated = current.updated_at ? new Date(current.updated_at).toISOString() : null;
        if (!currentUpdated || currentUpdated !== input.expected_updated_at) {
          throwActionError(ctx, {
            category: 'ActionError',
            code: 'CONFLICT',
            message: 'Ticket was modified since expected_updated_at',
            details: { expected_updated_at: input.expected_updated_at, actual_updated_at: currentUpdated }
          });
        }
      }

      if (input.patch.status_id) {
        const status = await tx.trx('statuses').where({ tenant: tx.tenantId, status_id: input.patch.status_id, status_type: 'ticket' }).first();
        if (!status) {
          throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: 'Invalid status_id for ticket' });
        }
      }
      if (input.patch.priority_id) {
        const priority = await tx.trx('priorities').where({ tenant: tx.tenantId, priority_id: input.patch.priority_id }).first();
        if (!priority) {
          throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: 'Invalid priority_id for ticket' });
        }
      }

      let currentAttributes: Record<string, any> = {};
      const parsedAttrs = parseJsonMaybe(current.attributes);
      currentAttributes = parsedAttrs && typeof parsedAttrs === 'object' && !Array.isArray(parsedAttrs) ? parsedAttrs : {};

      const mergedAttributes = {
        ...currentAttributes,
        ...(input.patch.attributes ?? {})
      } as Record<string, any>;
      if (input.patch.tags) mergedAttributes.tags = input.patch.tags;
      if (input.patch.custom_fields) mergedAttributes.custom_fields = input.patch.custom_fields;
      if (input.patch.due_date !== undefined) mergedAttributes.due_date = input.patch.due_date;

      const before = {
        title: (current.title as string | null) ?? null,
        status_id: (current.status_id as string | null) ?? null,
        priority_id: (current.priority_id as string | null) ?? null,
        assigned_to: (current.assigned_to as string | null) ?? null,
        category_id: (current.category_id as string | null) ?? null,
        subcategory_id: (current.subcategory_id as string | null) ?? null,
        due_date: (currentAttributes.due_date as string | null | undefined) ?? null,
        tags: (currentAttributes.tags as string[] | undefined) ?? null
      };

      let updated: any;
      try {
        updated = await TicketModel.updateTicket(
          input.ticket_id,
          {
            ...(input.patch.title ? { title: input.patch.title } : {}),
            ...(input.patch.status_id ? { status_id: input.patch.status_id } : {}),
            ...(input.patch.priority_id ? { priority_id: input.patch.priority_id } : {}),
            ...(input.patch.assigned_to !== undefined ? { assigned_to: input.patch.assigned_to } : {}),
            ...(input.patch.category_id !== undefined ? { category_id: input.patch.category_id } : {}),
            ...(input.patch.subcategory_id !== undefined ? { subcategory_id: input.patch.subcategory_id } : {}),
            attributes: mergedAttributes,
            updated_by: tx.actorUserId
          },
          tx.tenantId,
          tx.trx,
          {},
          undefined,
          undefined,
          tx.actorUserId
        );
      } catch (error) {
        rethrowAsStandardError(ctx, error);
      }

      const updatedAttributes = parseJsonMaybe(updated.attributes);
      const normalizedUpdatedAttributes =
        updatedAttributes && typeof updatedAttributes === 'object' && !Array.isArray(updatedAttributes) ? updatedAttributes : {};

      const after = {
        title: (updated.title as string | null) ?? null,
        status_id: (updated.status_id as string | null) ?? null,
        priority_id: (updated.priority_id as string | null) ?? null,
        assigned_to: (updated.assigned_to as string | null) ?? null,
        category_id: (updated.category_id as string | null) ?? null,
        subcategory_id: (updated.subcategory_id as string | null) ?? null,
        due_date: (normalizedUpdatedAttributes.due_date as string | null | undefined) ?? null,
        tags: (normalizedUpdatedAttributes.tags as string[] | undefined) ?? null
      };

      await writeRunAudit(ctx, tx, {
        operation: 'workflow_action:tickets.update_fields',
        changedData: { ticket_id: input.ticket_id, before, after },
        details: { action_id: 'tickets.update_fields', action_version: 1, ticket_id: input.ticket_id }
      });

      return {
        ticket_id: input.ticket_id,
        updated_at: new Date(updated.updated_at ?? new Date().toISOString()).toISOString(),
        status_id: (updated.status_id as string | null) ?? null,
        priority_id: (updated.priority_id as string | null) ?? null,
        tags: (after.tags as string[] | null) ?? null
      };
    })
  });

  // ---------------------------------------------------------------------------
  // A04 — tickets.assign
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'tickets.assign',
    version: 1,
    inputSchema: z.object({
      ticket_id: uuidSchema.describe('Ticket id'),
      assignee: z.object({
        type: z.enum(['user', 'team', 'queue']).describe('Assignee type'),
        id: uuidSchema.describe('Assignee id (user_id, team_id, or queue id)')
      }),
      reason: z.string().optional().describe('Optional assignment reason'),
      comment: z.object({
        body: z.string().min(1).describe('Optional assignment comment body'),
        visibility: z.enum(['public', 'internal']).default('internal').describe('Comment visibility')
      }).optional().describe('Optional assignment comment'),
      no_op_if_already_assigned: z.boolean().default(true).describe('No-op if ticket is already assigned to the resolved user')
    }),
    outputSchema: z.object({
      ticket_id: uuidSchema,
      assigned_type: z.enum(['user', 'team', 'queue']),
      assigned_id: uuidSchema,
      assigned_to: uuidSchema.nullable(),
      updated_at: isoDateTimeSchema
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Assign Ticket',
      category: 'Business Operations',
      description: 'Assign a ticket to a user (or resolve from team/queue)'
    },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, { resource: 'ticket', action: 'update' });

      const resolveAssigneeUserId = async (): Promise<string> => {
        if (input.assignee.type === 'user') return input.assignee.id;

        if (input.assignee.type === 'team') {
          const team = await tx.trx('teams').where({ tenant: tx.tenantId, team_id: input.assignee.id }).first();
          if (!team) {
            throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Team not found', details: { team_id: input.assignee.id } });
          }
          return team.manager_id as string;
        }

        // queue: best-effort, treat as a team-like group backed by team_members (id == team_id)
        const member = await tx.trx('team_members')
          .where({ tenant: tx.tenantId, team_id: input.assignee.id })
          .orderBy('created_at', 'asc')
          .first();
        if (!member) {
          throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Queue has no members', details: { queue_id: input.assignee.id } });
        }
        return member.user_id as string;
      };

      const assigneeUserId = await resolveAssigneeUserId();

      // Ensure user exists
      const user = await tx.trx('users').where({ tenant: tx.tenantId, user_id: assigneeUserId }).first();
      if (!user) {
        throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'User not found', details: { user_id: assigneeUserId } });
      }

      const ticket = await tx.trx('tickets').where({ tenant: tx.tenantId, ticket_id: input.ticket_id }).first();
      if (!ticket) {
        throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Ticket not found', details: { ticket_id: input.ticket_id } });
      }

      if (input.no_op_if_already_assigned && ticket.assigned_to === assigneeUserId) {
        await writeRunAudit(ctx, tx, {
          operation: 'workflow_action:tickets.assign',
          changedData: { ticket_id: input.ticket_id, noop: true, assigned_to: assigneeUserId, assignee: input.assignee, reason: input.reason ?? null },
          details: { action_id: 'tickets.assign', action_version: 1, ticket_id: input.ticket_id, assigned_to: assigneeUserId, noop: true }
        });

        return {
          ticket_id: input.ticket_id,
          assigned_type: input.assignee.type,
          assigned_id: input.assignee.id,
          assigned_to: (ticket.assigned_to as string | null) ?? null,
          updated_at: new Date(ticket.updated_at ?? new Date().toISOString()).toISOString()
        };
      }

      let updated: any;
      try {
        updated = await TicketModel.updateTicketWithAssignmentChange(
          input.ticket_id,
          { assigned_to: assigneeUserId, updated_by: tx.actorUserId },
          tx.tenantId,
          tx.trx
        );
      } catch (error) {
        rethrowAsStandardError(ctx, error);
      }

      let commentId: string | null = null;
      if (input.comment?.body) {
        try {
          const comment = await TicketModel.createComment(
            {
              ticket_id: input.ticket_id,
              content: input.comment.body,
              is_internal: input.comment.visibility === 'internal',
              is_resolution: false,
              author_type: 'system',
              author_id: tx.actorUserId,
              metadata: { source: 'workflow', run_id: ctx.runId, step_path: ctx.stepPath, reason: input.reason ?? null }
            },
            tx.tenantId,
            tx.trx,
            undefined,
            undefined,
            tx.actorUserId
          );
          commentId = (comment?.comment_id as string | undefined) ?? null;
        } catch (error) {
          rethrowAsStandardError(ctx, error);
        }
      }

      await writeRunAudit(ctx, tx, {
        operation: 'workflow_action:tickets.assign',
        changedData: { ticket_id: input.ticket_id, assigned_to: assigneeUserId, assignee: input.assignee, reason: input.reason ?? null, comment_id: commentId },
        details: { action_id: 'tickets.assign', action_version: 1, ticket_id: input.ticket_id, assigned_to: assigneeUserId, comment_id: commentId }
      });

      return {
        ticket_id: input.ticket_id,
        assigned_type: input.assignee.type,
        assigned_id: input.assignee.id,
        assigned_to: (updated.assigned_to as string | null) ?? null,
        updated_at: new Date(updated.updated_at ?? new Date().toISOString()).toISOString()
      };
    })
  });

  // ---------------------------------------------------------------------------
  // A05 — tickets.close
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'tickets.close',
    version: 1,
    inputSchema: z.object({
      ticket_id: uuidSchema.describe('Ticket id'),
      resolution: z.object({
        code: z.string().min(1).describe('Resolution code'),
        text: z.string().min(1).optional().describe('Resolution text/summary')
      }).describe('Resolution information'),
      public_note: z.string().optional().describe('Optional public closure note'),
      internal_note: z.string().optional().describe('Optional internal closure note'),
      notify_requester: z.boolean().default(false).describe('Notify requester via email'),
      email: z.object({
        subject: z.string().optional(),
        html: z.string().optional(),
        text: z.string().optional()
      }).optional().describe('Optional email overrides')
    }),
    outputSchema: z.object({
      ticket_id: uuidSchema,
      closed_at: isoDateTimeSchema,
      resolution_code: z.string(),
      final_status_id: uuidSchema
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Close Ticket',
      category: 'Business Operations',
      description: 'Close a ticket with resolution and optional notification'
    },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, { resource: 'ticket', action: 'update' });

      const ticket = await tx.trx('tickets').where({ tenant: tx.tenantId, ticket_id: input.ticket_id }).first();
      if (!ticket) {
        throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Ticket not found', details: { ticket_id: input.ticket_id } });
      }

      if (ticket.closed_at) {
        throwActionError(ctx, { category: 'ActionError', code: 'CONFLICT', message: 'Ticket already closed', details: { ticket_id: input.ticket_id } });
      }

      const currentStatus = ticket.status_id
        ? await tx.trx('statuses').where({ tenant: tx.tenantId, status_id: ticket.status_id }).first()
        : null;
      if (currentStatus?.is_closed) {
        throwActionError(ctx, { category: 'ActionError', code: 'CONFLICT', message: 'Ticket is already in a closed status', details: { status_id: ticket.status_id } });
      }

      // Choose a closed status.
      const closedStatus = await tx.trx('statuses')
        .where({ tenant: tx.tenantId, status_type: 'ticket' })
        .andWhere('is_closed', true)
        .orderBy('is_default', 'desc')
        .orderBy('order_number', 'asc')
        .first();
      if (!closedStatus) {
        throwActionError(ctx, { category: 'ActionError', code: 'INTERNAL_ERROR', message: 'No closed ticket status configured' });
      }

      const nowIso = new Date().toISOString();

      // Update ticket closure fields.
      await tx.trx('tickets')
        .where({ tenant: tx.tenantId, ticket_id: input.ticket_id })
        .update({
          status_id: closedStatus.status_id,
          closed_at: nowIso,
          closed_by: tx.actorUserId,
          resolution_code: input.resolution.code,
          updated_at: nowIso,
          updated_by: tx.actorUserId
        });

      if (input.public_note) {
        await TicketModel.createComment(
          {
            ticket_id: input.ticket_id,
            content: input.public_note,
            is_internal: false,
            is_resolution: true,
            author_type: 'system',
            author_id: tx.actorUserId,
            metadata: { source: 'workflow', run_id: ctx.runId, step_path: ctx.stepPath }
          },
          tx.tenantId,
          tx.trx,
          undefined,
          undefined,
          tx.actorUserId
        );
      }

      if (input.internal_note) {
        await TicketModel.createComment(
          {
            ticket_id: input.ticket_id,
            content: input.internal_note,
            is_internal: true,
            is_resolution: true,
            author_type: 'system',
            author_id: tx.actorUserId,
            metadata: { source: 'workflow', run_id: ctx.runId, step_path: ctx.stepPath }
          },
          tx.tenantId,
          tx.trx,
          undefined,
          undefined,
          tx.actorUserId
        );
      }

      if (input.notify_requester) {
        const contactId = (ticket.contact_name_id as string | null) ?? null;
        if (!contactId) {
          throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: 'Ticket has no requester contact to notify' });
        }
        const contact = await tx.trx('contacts').where({ tenant: tx.tenantId, contact_name_id: contactId }).first();
        const email = contact?.email ? String(contact.email) : null;
        if (!email) {
          throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: 'Requester contact has no email address' });
        }

        const { TenantEmailService } = await import('server/src/lib/services/TenantEmailService');
        const { StaticTemplateProcessor } = await import('server/src/lib/services/email/templateProcessors');
        const service = TenantEmailService.getInstance(tx.tenantId);
        const subject = input.email?.subject ?? `Ticket ${ticket.ticket_number ?? ''} closed`;
        const html = input.email?.html ?? `<p>Your ticket has been closed.</p><p>Resolution: ${input.resolution.code}</p>`;
        const text = input.email?.text ?? `Your ticket has been closed.\nResolution: ${input.resolution.code}`;
        const templateProcessor = new StaticTemplateProcessor(subject, html, text);
        const result = await service.sendEmail({
          tenantId: tx.tenantId,
          to: { email },
          templateProcessor,
          templateData: {
            ticket: {
              ticketNumber: ticket.ticket_number ?? null,
              title: ticket.title ?? null,
              resolutionCode: input.resolution.code,
              resolutionText: input.resolution.text ?? null
            }
          }
        } as any);
        if (!result.success) {
          throwActionError(ctx, { category: 'TransientError', code: 'TRANSIENT_FAILURE', message: result.error ?? 'Failed to send requester email' });
        }
      }

      await writeRunAudit(ctx, tx, {
        operation: 'workflow_action:tickets.close',
        changedData: { ticket_id: input.ticket_id, closed_at: nowIso, resolution_code: input.resolution.code },
        details: { action_id: 'tickets.close', action_version: 1, ticket_id: input.ticket_id, closed_at: nowIso }
      });

      return {
        ticket_id: input.ticket_id,
        closed_at: nowIso,
        resolution_code: input.resolution.code,
        final_status_id: closedStatus.status_id as string
      };
    })
  });

  // ---------------------------------------------------------------------------
  // A06 — tickets.link_entities (implemented after schema is added)
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'tickets.link_entities',
    version: 1,
    inputSchema: z.object({
      ticket_id: uuidSchema.describe('Ticket id'),
      entity_type: z.enum(['project', 'project_task', 'asset', 'contract']).describe('Entity type'),
      entity_id: uuidSchema.describe('Entity id'),
      link_type: z.string().min(1).describe('Link type'),
      metadata: z.record(z.unknown()).optional().describe('Optional link metadata')
    }),
    outputSchema: z.object({
      link_id: uuidSchema,
      entity_type: z.string(),
      entity_id: uuidSchema,
      link_type: z.string(),
      linked_entity_summary: z.object({
        type: z.string(),
        id: uuidSchema,
        name: z.string().nullable(),
        url: z.string().nullable()
      })
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Link Ticket Entity', category: 'Business Operations', description: 'Link a ticket to another entity' },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, { resource: 'ticket', action: 'update' });

      const ticket = await tx.trx('tickets').where({ tenant: tx.tenantId, ticket_id: input.ticket_id }).first();
      if (!ticket) {
        throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Ticket not found' });
      }

      let linkedEntitySummary: { type: string; id: string; name: string | null; url: string | null } = {
        type: input.entity_type,
        id: input.entity_id,
        name: null,
        url: null
      };

      // Entity existence checks
      if (input.entity_type === 'project') {
        const project = await tx.trx('projects').where({ tenant: tx.tenantId, project_id: input.entity_id }).first();
        if (!project) throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Project not found' });
        linkedEntitySummary = {
          type: 'project',
          id: input.entity_id,
          name: (project.project_name as string | null) ?? null,
          url: null
        };
      } else if (input.entity_type === 'project_task') {
        const task = await tx.trx('project_tasks').where({ tenant: tx.tenantId, task_id: input.entity_id }).first();
        if (!task) throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Project task not found' });
        linkedEntitySummary = {
          type: 'project_task',
          id: input.entity_id,
          name: (task.task_name as string | null) ?? null,
          url: null
        };
      } else if (input.entity_type === 'asset') {
        const asset = await tx.trx('assets').where({ tenant: tx.tenantId, asset_id: input.entity_id }).first();
        if (!asset) throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Asset not found' });
        const assetName =
          (asset.asset_name as string | null | undefined) ??
          (asset.name as string | null | undefined) ??
          (asset.asset_tag as string | null | undefined) ??
          null;
        linkedEntitySummary = { type: 'asset', id: input.entity_id, name: assetName, url: null };
      } else if (input.entity_type === 'contract') {
        const contract = await tx.trx('contracts').where({ tenant: tx.tenantId, contract_id: input.entity_id }).first().catch(() => null);
        if (!contract) throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Contract not found' });
        const contractName =
          (contract.contract_name as string | null | undefined) ??
          (contract.name as string | null | undefined) ??
          (contract.contract_number as string | null | undefined) ??
          null;
        linkedEntitySummary = { type: 'contract', id: input.entity_id, name: contractName, url: null };
      }

      const linkId = uuidv4();
      const nowIso = new Date().toISOString();

      // Generic polymorphic link table (added via migration in this plan).
      try {
        await tx.trx('ticket_entity_links').insert({
          tenant: tx.tenantId,
          link_id: linkId,
          ticket_id: input.ticket_id,
          entity_type: input.entity_type,
          entity_id: input.entity_id,
          link_type: input.link_type,
          metadata: input.metadata ?? null,
          created_at: nowIso
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (/duplicate|unique/i.test(msg)) {
          throwActionError(ctx, { category: 'ActionError', code: 'CONFLICT', message: 'Link already exists' });
        }
        throw error;
      }

      await writeRunAudit(ctx, tx, {
        operation: 'workflow_action:tickets.link_entities',
        changedData: { ticket_id: input.ticket_id, entity_type: input.entity_type, entity_id: input.entity_id, link_type: input.link_type },
        details: { action_id: 'tickets.link_entities', action_version: 1, link_id: linkId }
      });

      return {
        link_id: linkId,
        entity_type: input.entity_type,
        entity_id: input.entity_id,
        link_type: input.link_type,
        linked_entity_summary: linkedEntitySummary
      };
    })
  });

  // ---------------------------------------------------------------------------
  // A07 — tickets.add_attachment
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'tickets.add_attachment',
    version: 1,
    inputSchema: z.object({
      ticket_id: uuidSchema.describe('Ticket id'),
      source: attachmentSourceSchema.describe('Attachment source'),
      filename: z.string().optional().describe('Optional filename'),
      visibility: z.enum(['public', 'internal']).optional().describe('Visibility (currently informational)'),
      comment: z.object({
        body: z.string().min(1),
        visibility: z.enum(['public', 'internal']).default('public')
      }).optional().describe('Optional comment to add alongside the attachment'),
      idempotency_key: z.string().optional().describe('Optional external idempotency key')
    }),
    outputSchema: z.object({
      attachment_id: uuidSchema.describe('Document id used as the attachment identifier'),
      filename: z.string(),
      mime_type: z.string().nullable(),
      storage_ref: z.string().nullable().describe('Storage file id (external_files.file_id) when available')
    }),
    sideEffectful: true,
    idempotency: { mode: 'actionProvided', key: actionProvidedKey },
    ui: { label: 'Add Ticket Attachment', category: 'Business Operations', description: 'Attach a document/file to a ticket' },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, { resource: 'ticket', action: 'update' });
      await requirePermission(ctx, tx, { resource: 'document', action: 'create' });
      const attached = await attachDocumentToTicket(ctx, tx, input.ticket_id, {
        source: input.source,
        filename: input.filename ?? null,
        visibility: input.visibility
      });

      if (input.comment?.body) {
        await TicketModel.createComment(
          {
            ticket_id: input.ticket_id,
            content: input.comment.body,
            is_internal: input.comment.visibility === 'internal',
            is_resolution: false,
            author_type: 'system',
            author_id: tx.actorUserId,
            metadata: { source: 'workflow', attachment_id: attached.document_id, run_id: ctx.runId, step_path: ctx.stepPath }
          },
          tx.tenantId,
          tx.trx,
          undefined,
          undefined,
          tx.actorUserId
        );
      }
      await writeRunAudit(ctx, tx, {
        operation: 'workflow_action:tickets.add_attachment',
        changedData: { ticket_id: input.ticket_id, document_id: attached.document_id },
        details: { action_id: 'tickets.add_attachment', action_version: 1, ticket_id: input.ticket_id, document_id: attached.document_id }
      });
      return {
        attachment_id: attached.document_id,
        filename: attached.filename,
        mime_type: attached.content_type ?? null,
        storage_ref: attached.file_id ?? null
      };
    })
  });

  // ---------------------------------------------------------------------------
  // A08 — tickets.find
  // ---------------------------------------------------------------------------
  const ticketSummarySchema = z.object({
    ticket_id: uuidSchema,
    ticket_number: z.string(),
    title: z.string().nullable(),
    url: z.string().nullable(),
    company_id: uuidSchema.nullable(),
    contact_name_id: uuidSchema.nullable(),
    status_id: uuidSchema.nullable(),
    priority_id: uuidSchema.nullable(),
    category_id: uuidSchema.nullable(),
    subcategory_id: uuidSchema.nullable(),
    assigned_to: uuidSchema.nullable(),
    entered_at: isoDateTimeSchema.nullable(),
    updated_at: isoDateTimeSchema.nullable(),
    closed_at: isoDateTimeSchema.nullable(),
    is_closed: z.boolean().nullable(),
    attributes: z.record(z.unknown()).optional()
  });

  const ticketCommentSchema = z.object({
    comment_id: uuidSchema,
    note: z.string(),
    is_internal: z.boolean(),
    is_resolution: z.boolean(),
    is_initial_description: z.boolean(),
    created_at: isoDateTimeSchema,
    user_id: uuidSchema.nullable(),
    contact_name_id: uuidSchema.nullable()
  });

  const ticketAttachmentSchema = z.object({
    document_id: uuidSchema,
    document_name: z.string(),
    file_id: uuidSchema.nullable(),
    mime_type: z.string().nullable(),
    associated_at: isoDateTimeSchema.nullable()
  });

  registry.register({
    id: 'tickets.find',
    version: 1,
    inputSchema: z.object({
      ticket_id: uuidSchema.optional().describe('Ticket id'),
      ticket_number: z.string().optional().describe('Ticket number'),
      external_ref: z.string().optional().describe('External reference (stored in tickets.attributes.external_ref)'),
      on_not_found: z.enum(['return_null', 'error']).default('return_null'),
      include: z.object({
        comments: z.boolean().optional(),
        attachments: z.boolean().optional(),
        attributes: z.boolean().optional().describe('Include ticket.attributes (raw JSON)'),
        custom_fields: z.boolean().optional().describe('Alias for include.attributes'),
        comments_limit: z.number().int().positive().max(200).optional(),
        attachments_limit: z.number().int().positive().max(200).optional()
      }).optional()
    }).refine((val) => Boolean(val.ticket_id || val.ticket_number || val.external_ref), { message: 'ticket_id, ticket_number, or external_ref is required' }),
    outputSchema: z.object({
      ticket: ticketSummarySchema.nullable(),
      comments: z.array(ticketCommentSchema).optional(),
      attachments: z.array(ticketAttachmentSchema).optional()
    }),
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Find Ticket', category: 'Business Operations', description: 'Fetch a ticket by id or number' },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, { resource: 'ticket', action: 'read' });

      const startedAt = Date.now();
      let ticket: any = null;
      if (input.ticket_id) {
        ticket = await tx.trx('tickets').where({ tenant: tx.tenantId, ticket_id: input.ticket_id }).first();
      } else if (input.ticket_number) {
        ticket = await tx.trx('tickets').where({ tenant: tx.tenantId, ticket_number: input.ticket_number }).first();
      } else if (input.external_ref) {
        ticket = await tx.trx('tickets')
          .where({ tenant: tx.tenantId })
          .andWhereRaw(`(attributes->>'external_ref') = ?`, [String(input.external_ref)])
          .first();
      }

      if (!ticket) {
        if (input.on_not_found === 'error') {
          throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Ticket not found' });
        }
        return { ticket: null, comments: [], attachments: [] };
      }

      const include = input.include ?? {};
      const includeAttributes = Boolean(include.attributes || include.custom_fields);
      const attrs = includeAttributes ? parseJsonMaybe(ticket.attributes) : undefined;

      const parsedTicket = ticketSummarySchema.parse({
        ticket_id: ticket.ticket_id,
        ticket_number: ticket.ticket_number,
        title: ticket.title ?? null,
        url: ticket.url ?? null,
        company_id: ticket.company_id ?? null,
        contact_name_id: ticket.contact_name_id ?? null,
        status_id: ticket.status_id ?? null,
        priority_id: ticket.priority_id ?? null,
        category_id: ticket.category_id ?? null,
        subcategory_id: ticket.subcategory_id ?? null,
        assigned_to: ticket.assigned_to ?? null,
        entered_at: ticket.entered_at ? new Date(ticket.entered_at).toISOString() : null,
        updated_at: ticket.updated_at ? new Date(ticket.updated_at).toISOString() : null,
        closed_at: ticket.closed_at ? new Date(ticket.closed_at).toISOString() : null,
        is_closed: ticket.is_closed ?? null,
        ...(includeAttributes ? { attributes: (attrs && typeof attrs === 'object' && !Array.isArray(attrs)) ? attrs : {} } : {})
      });

      const result: any = { ticket: parsedTicket };

      if (include.comments) {
        const rows = await tx.trx('comments')
          .where({ tenant: tx.tenantId, ticket_id: ticket.ticket_id })
          .orderBy('created_at', 'asc')
          .limit(include.comments_limit ?? 50);
        result.comments = rows.map((row: any) => ticketCommentSchema.parse({
          comment_id: row.comment_id,
          note: row.note,
          is_internal: Boolean(row.is_internal),
          is_resolution: Boolean(row.is_resolution),
          is_initial_description: Boolean(row.is_initial_description),
          created_at: new Date(row.created_at ?? new Date().toISOString()).toISOString(),
          user_id: row.user_id ?? null,
          contact_name_id: row.contact_name_id ?? null
        }));
      }

      if (include.attachments) {
        const rows = await tx.trx('document_associations as da')
          .join('documents as d', function joinDocs() {
            this.on('da.tenant', 'd.tenant').andOn('da.document_id', 'd.document_id');
          })
          .where({ 'da.tenant': tx.tenantId, 'da.entity_type': 'ticket', 'da.entity_id': ticket.ticket_id })
          .select('d.document_id', 'd.document_name', 'd.file_id', 'd.mime_type', 'da.created_at as associated_at');
        result.attachments = rows.slice(0, include.attachments_limit ?? 50).map((row: any) => ticketAttachmentSchema.parse({
          document_id: row.document_id,
          document_name: row.document_name,
          file_id: row.file_id ?? null,
          mime_type: row.mime_type ?? null,
          associated_at: row.associated_at ? new Date(row.associated_at).toISOString() : null
        }));
      }

      const durationMs = Date.now() - startedAt;
      ctx.logger?.info('workflow_action:tickets.find', {
        duration_ms: durationMs,
        include_comments: Boolean(include.comments),
        include_attachments: Boolean(include.attachments),
        comments_count: Array.isArray(result.comments) ? result.comments.length : 0,
        attachments_count: Array.isArray(result.attachments) ? result.attachments.length : 0
      });

      return result;
    })
  });

  // ---------------------------------------------------------------------------
  // A09 — clients.find
  // ---------------------------------------------------------------------------
  const clientSummarySchema = z.object({
    client_id: uuidSchema,
    client_name: z.string(),
    url: z.string().nullable(),
    is_inactive: z.boolean(),
    properties: z.record(z.unknown()).nullable()
  });

  const contactSummarySchema = z.object({
    contact_name_id: uuidSchema,
    full_name: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    client_id: uuidSchema.nullable()
  });

  registry.register({
    id: 'clients.find',
    version: 1,
    inputSchema: z.object({
      client_id: uuidSchema.optional(),
      name: z.string().optional().describe('Exact client name (case-insensitive)'),
      external_ref: z.string().optional().describe('External reference (stored in clients.properties.external_ref)'),
      include_primary_contact: z.boolean().default(false),
      on_not_found: z.enum(['return_null', 'error']).default('return_null')
    }).refine((val) => Boolean(val.client_id || val.name || val.external_ref), { message: 'client_id, name, or external_ref required' })
      .refine((val) => !val.external_ref || /^[A-Za-z0-9._:-]+$/.test(String(val.external_ref)), { message: 'external_ref has invalid format' }),
    outputSchema: z.object({
      client: clientSummarySchema.nullable(),
      primary_contact: contactSummarySchema.nullable()
    }),
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Find Client', category: 'Business Operations', description: 'Find a client by id, name, or external ref' },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, { resource: 'client', action: 'read' });

      const startedAt = Date.now();
      let client: any = null;
      let matchedBy: 'client_id' | 'name' | 'external_ref' | null = null;
      if (input.client_id) {
        client = await ClientModel.getClientById(input.client_id, tx.tenantId, tx.trx);
        matchedBy = 'client_id';
      } else if (input.name) {
        const name = String(input.name).trim();
        client = await tx.trx('clients')
          .where({ tenant: tx.tenantId })
          .andWhereRaw('lower(client_name) = ?', [name.toLowerCase()])
          .first();
        matchedBy = 'name';
      } else if (input.external_ref) {
        client = await tx.trx('clients')
          .where({ tenant: tx.tenantId })
          .andWhereRaw(`(properties->>'external_ref') = ?`, [input.external_ref])
          .first();
        matchedBy = 'external_ref';
      }

      if (!client) {
        if (input.on_not_found === 'error') {
          throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Client not found', details: { matched_by: matchedBy } });
        }
        return { client: null, primary_contact: null };
      }

      let properties: Record<string, unknown> | null = null;
      if (client && client.properties) {
        const parsed = parseJsonMaybe(client.properties);
        properties = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
      }

      const parsedClient = clientSummarySchema.parse({
        client_id: client.client_id,
        client_name: client.client_name,
        url: client.url ?? null,
        is_inactive: Boolean(client.is_inactive),
        properties
      });

      let primaryContact: any = null;
      if (input.include_primary_contact) {
        primaryContact = await tx.trx('contacts')
          .where({ tenant: tx.tenantId, client_id: client.client_id })
          .orderBy('is_inactive', 'asc')
          .orderBy('created_at', 'asc')
          .first();
      }

      const parsedPrimaryContact = primaryContact ? contactSummarySchema.parse({
        contact_name_id: primaryContact.contact_name_id,
        full_name: primaryContact.full_name ?? null,
        email: primaryContact.email ?? null,
        phone: primaryContact.phone ?? null,
        client_id: primaryContact.client_id ?? null
      }) : null;

      ctx.logger?.info('workflow_action:clients.find', {
        duration_ms: Date.now() - startedAt,
        matched_by: matchedBy,
        include_primary_contact: input.include_primary_contact
      });

      return { client: parsedClient, primary_contact: parsedPrimaryContact };
    })
  });

  // ---------------------------------------------------------------------------
  // A10 — clients.search
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'clients.search',
    version: 1,
    inputSchema: z.object({
      query: z.string().min(1).describe('Search query'),
      filters: z.object({
        include_inactive: z.boolean().optional(),
        tags: z.array(z.string()).optional(),
        sort_by: z.enum(['name', 'updated_at']).optional(),
        sort_order: z.enum(['asc', 'desc']).optional()
      }).optional(),
      page: z.number().int().positive().default(1),
      page_size: z.number().int().positive().max(100).default(25)
    }),
    outputSchema: z.object({
      clients: z.array(clientSummarySchema),
      first_client: clientSummarySchema.nullable(),
      page: z.number().int(),
      page_size: z.number().int(),
      total: z.number().int()
    }),
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Search Clients', category: 'Business Operations', description: 'Search clients by name' },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, { resource: 'client', action: 'read' });

      const startedAt = Date.now();
      const minQueryLen = Number(process.env.WORKFLOW_CLIENT_SEARCH_MIN_QUERY_LEN ?? 2);
      const rawQuery = String(input.query ?? '').trim();
      if (rawQuery.length < minQueryLen) {
        throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: `query must be at least ${minQueryLen} characters` });
      }
      const escaped = rawQuery.replace(/[%_\\]/g, (m) => `\\${m}`);
      const pattern = `%${escaped}%`;

      const page = input.page ?? 1;
      const pageSize = input.page_size ?? 25;
      const offset = (page - 1) * pageSize;
      const filters = input.filters ?? {};

      let base = tx.trx('clients').where({ tenant: tx.tenantId });
      if (!filters.include_inactive) {
        base = base.where(function onlyActive() {
          this.where('is_inactive', false).orWhereNull('is_inactive');
        });
      }

      base = base.andWhereRaw(`client_name ILIKE ? ESCAPE '\\\\'`, [pattern]);

      if (filters.tags?.length) {
        base = base
          .join('tag_mappings as tm', function joinTagMappings() {
            this.on('tm.tenant', 'clients.tenant').andOn('tm.tagged_id', 'clients.client_id');
          })
          .join('tag_definitions as td', function joinTagDefs() {
            this.on('td.tenant', 'tm.tenant').andOn('td.tag_id', 'tm.tag_id');
          })
          .where('tm.tagged_type', 'client')
          .whereIn('td.tag_text', filters.tags);
      }

      const countRow = await base.clone().clearSelect().clearOrder().countDistinct({ count: 'clients.client_id' }).first();
      const total = parseInt(String((countRow as any)?.count ?? 0), 10);
      const sortBy = filters.sort_by ?? 'name';
      const sortOrder = filters.sort_order ?? 'asc';
      const clients = await base
        .clone()
        .clearSelect()
        .select('clients.*')
        .orderBy(sortBy === 'updated_at' ? 'clients.updated_at' : 'clients.client_name', sortOrder)
        .orderBy('clients.client_id', 'asc')
        .limit(pageSize)
        .offset(offset);

      const parsedClients = clients.map((row: any) => {
        const props = row?.properties ? parseJsonMaybe(row.properties) : null;
        return clientSummarySchema.parse({
          client_id: row.client_id,
          client_name: row.client_name,
          url: row.url ?? null,
          is_inactive: Boolean(row.is_inactive),
          properties: (props && typeof props === 'object' && !Array.isArray(props)) ? props : null
        });
      });

      ctx.logger?.info('workflow_action:clients.search', {
        duration_ms: Date.now() - startedAt,
        query_len: rawQuery.length,
        filters: {
          include_inactive: Boolean(filters.include_inactive),
          tags_count: Array.isArray(filters.tags) ? filters.tags.length : 0,
          sort_by: sortBy,
          sort_order: sortOrder
        },
        result_count: parsedClients.length,
        page,
        page_size: pageSize,
        total
      });

      return { clients: parsedClients, first_client: parsedClients[0] ?? null, page, page_size: pageSize, total };
    })
  });

  // ---------------------------------------------------------------------------
  // A11 — contacts.find
  // ---------------------------------------------------------------------------
  const contactDetailsSchema = z.object({
    contact_name_id: uuidSchema,
    full_name: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    client_id: uuidSchema.nullable(),
    is_inactive: z.boolean()
  });

  registry.register({
    id: 'contacts.find',
    version: 1,
    inputSchema: z.object({
      contact_id: uuidSchema.optional(),
      email: z.string().email().optional(),
      phone: z.string().optional().describe('Phone number (normalized digits match)'),
      client_id: uuidSchema.optional().describe('Optional client scope'),
      on_not_found: z.enum(['return_null', 'error']).default('return_null'),
      match_strategy: z.enum(['first_created', 'most_recent']).default('first_created').describe('Deterministic ordering when multiple matches exist')
    }).refine((val) => Boolean(val.contact_id || val.email || val.phone), { message: 'contact_id, email, or phone required' }),
    outputSchema: z.object({
      contact: contactDetailsSchema.nullable()
    }),
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Find Contact', category: 'Business Operations', description: 'Find a contact by id or email' },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, { resource: 'contact', action: 'read' });
      const startedAt = Date.now();
      let matchedBy: 'contact_id' | 'email' | 'phone' | null = null;
      let contacts: any[] = [];
      if (input.contact_id) {
        const contact = await ContactModel.getContactById(input.contact_id, tx.tenantId, tx.trx);
        if (contact) contacts = [contact];
        matchedBy = 'contact_id';
      } else if (input.email) {
        const email = input.email.toLowerCase().trim();
        matchedBy = 'email';
        contacts = await tx.trx('contacts')
          .where({ tenant: tx.tenantId })
          .andWhereRaw('lower(email) = ?', [email])
          .orderBy('is_inactive', 'asc')
          .orderBy(input.match_strategy === 'most_recent' ? 'created_at' : 'created_at', input.match_strategy === 'most_recent' ? 'desc' : 'asc')
          .limit(5);
      } else if (input.phone) {
        const digits = String(input.phone).replace(/\D/g, '');
        if (digits.length < 7) {
          throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: 'phone is invalid' });
        }
        matchedBy = 'phone';
        contacts = await tx.trx('contacts')
          .where({ tenant: tx.tenantId })
          .andWhereRaw(`regexp_replace(coalesce(phone,''), '\\\\D', '', 'g') = ?`, [digits])
          .orderBy('is_inactive', 'asc')
          .orderBy(input.match_strategy === 'most_recent' ? 'created_at' : 'created_at', input.match_strategy === 'most_recent' ? 'desc' : 'asc')
          .limit(5);
      }

      // Apply client scope filter and choose first match deterministically.
      if (input.client_id) {
        contacts = contacts.filter((c) => c?.client_id === input.client_id);
      }

      const contact = contacts[0] ?? null;
      if (!contact) {
        if (input.on_not_found === 'error') {
          throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Contact not found', details: { matched_by: matchedBy } });
        }
        return { contact: null };
      }

      const parsed = contactDetailsSchema.parse({
        contact_name_id: contact.contact_name_id,
        full_name: contact.full_name ?? null,
        email: contact.email ?? null,
        phone: contact.phone ?? null,
        client_id: contact.client_id ?? null,
        is_inactive: Boolean(contact.is_inactive)
      });

      ctx.logger?.info('workflow_action:contacts.find', {
        duration_ms: Date.now() - startedAt,
        matched_by: matchedBy,
        match_count: contacts.length
      });

      return { contact: parsed };
    })
  });

  // ---------------------------------------------------------------------------
  // A12 — contacts.search
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'contacts.search',
    version: 1,
    inputSchema: z.object({
      query: z.string().min(1).describe('Search query (name/email/phone)'),
      client_id: uuidSchema.optional().describe('Optional client scope'),
      filters: z.object({
        tags: z.array(z.string()).optional(),
        sort_by: z.enum(['name', 'updated_at']).optional(),
        sort_order: z.enum(['asc', 'desc']).optional()
      }).optional(),
      page: z.number().int().positive().default(1),
      page_size: z.number().int().positive().max(100).default(25)
    }),
    outputSchema: z.object({
      contacts: z.array(contactDetailsSchema),
      first_contact: contactDetailsSchema.nullable(),
      page: z.number().int(),
      page_size: z.number().int(),
      total: z.number().int()
    }),
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Search Contacts', category: 'Business Operations', description: 'Search contacts by name or email' },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, { resource: 'contact', action: 'read' });

      const startedAt = Date.now();
      const minQueryLen = Number(process.env.WORKFLOW_CONTACT_SEARCH_MIN_QUERY_LEN ?? 2);
      const rawQuery = String(input.query ?? '').trim();
      if (rawQuery.length < minQueryLen) {
        throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: `query must be at least ${minQueryLen} characters` });
      }
      const escaped = rawQuery.replace(/[%_\\]/g, (m) => `\\${m}`);
      const pattern = `%${escaped}%`;

      const page = input.page ?? 1;
      const pageSize = input.page_size ?? 25;
      const offset = (page - 1) * pageSize;
      const filters = input.filters ?? {};

      let base = tx.trx('contacts')
        .where({ tenant: tx.tenantId })
        .where(function q() {
          this.whereRaw(`full_name ILIKE ? ESCAPE '\\\\'`, [pattern])
            .orWhereRaw(`email ILIKE ? ESCAPE '\\\\'`, [pattern])
            .orWhereRaw(`phone ILIKE ? ESCAPE '\\\\'`, [pattern]);
        });
      if (input.client_id) base = base.andWhere('client_id', input.client_id);

      if (filters.tags?.length) {
        base = base
          .join('tag_mappings as tm', function joinTagMappings() {
            this.on('tm.tenant', 'contacts.tenant').andOn('tm.tagged_id', 'contacts.contact_name_id');
          })
          .join('tag_definitions as td', function joinTagDefs() {
            this.on('td.tenant', 'tm.tenant').andOn('td.tag_id', 'tm.tag_id');
          })
          .where('tm.tagged_type', 'contact')
          .whereIn('td.tag_text', filters.tags);
      }

      const countRow = await base.clone().clearSelect().clearOrder().countDistinct({ count: 'contact_name_id' }).first();
      const total = parseInt(String((countRow as any)?.count ?? 0), 10);

      const sortBy = filters.sort_by ?? 'name';
      const sortOrder = filters.sort_order ?? 'asc';

      const rows = await base
        .clone()
        .clearSelect()
        .select('*')
        .orderBy(sortBy === 'updated_at' ? 'updated_at' : 'full_name', sortOrder)
        .orderBy('contact_name_id', 'asc')
        .limit(pageSize)
        .offset(offset);

      const contacts = rows.map((row: any) => contactDetailsSchema.parse({
        contact_name_id: row.contact_name_id,
        full_name: row.full_name ?? null,
        email: row.email ?? null,
        phone: row.phone ?? null,
        client_id: row.client_id ?? null,
        is_inactive: Boolean(row.is_inactive)
      }));

      ctx.logger?.info('workflow_action:contacts.search', {
        duration_ms: Date.now() - startedAt,
        query_len: rawQuery.length,
        client_scope: input.client_id ?? null,
        filters: { tags_count: Array.isArray(filters.tags) ? filters.tags.length : 0, sort_by: sortBy, sort_order: sortOrder },
        result_count: contacts.length,
        page,
        page_size: pageSize,
        total
      });

      return { contacts, first_contact: contacts[0] ?? null, page, page_size: pageSize, total };
    })
  });

  // ---------------------------------------------------------------------------
  // A13 — email.send
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'email.send',
    version: 1,
    inputSchema: z.object({
      to: z.array(z.object({ email: z.string().email(), name: z.string().optional() })).min(1).describe('Recipients'),
      cc: z.array(z.object({ email: z.string().email(), name: z.string().optional() })).optional(),
      bcc: z.array(z.object({ email: z.string().email(), name: z.string().optional() })).optional(),
      from: z.object({ email: z.string().email(), name: z.string().optional() }).optional().describe('Optional from override'),
      subject: z.string().min(1).describe('Subject template (supports {{var}})'),
      html: z.string().optional().describe('HTML template (supports {{var}})'),
      text: z.string().optional().describe('Text template (supports {{var}})'),
      template_data: z.record(z.unknown()).optional().describe('Template data for {{var}} replacement'),
      attachment_file_ids: z.array(uuidSchema).optional().describe('Attachment file ids (external_files.file_id)'),
      provider_id: z.string().optional().describe('Optional provider override (providerId from tenant email settings)'),
      idempotency_key: z.string().optional().describe('Optional external idempotency key')
    }),
    outputSchema: z.object({
      success: z.boolean(),
      message_id: z.string().nullable(),
      provider_id: z.string().nullable(),
      provider_type: z.string().nullable(),
      status: z.enum(['sent']).describe('Delivery status'),
      sent_at: isoDateTimeSchema.nullable()
    }),
    sideEffectful: true,
    retryHint: { maxAttempts: 3, backoffMs: 1000, retryOn: ['TransientError'] },
    idempotency: { mode: 'actionProvided', key: actionProvidedKey },
    ui: { label: 'Send Email', category: 'Business Operations', description: 'Send an outbound email via tenant email settings' },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      // Use the existing email permission taxonomy (email:process).
      await requirePermission(ctx, tx, { resource: 'email', action: 'process' });

      const { TenantEmailService } = await import('server/src/lib/services/TenantEmailService');
      const { StaticTemplateProcessor } = await import('server/src/lib/services/email/templateProcessors');
      const { EmailProviderManager } = await import('server/src/services/email/EmailProviderManager');
      const { StorageProviderFactory } = await import('server/src/lib/storage/StorageProviderFactory');
      const { EmailProviderError } = await import('@shared/types/email');

      const settings = await TenantEmailService.getTenantEmailSettings(tx.tenantId, tx.trx);
      if (!settings) {
        throwActionError(ctx, { category: 'ActionError', code: 'VALIDATION_ERROR', message: 'Tenant email settings not configured' });
      }

      const providerConfigs = Array.isArray(settings.providerConfigs) ? [...settings.providerConfigs] : [];
      if (input.provider_id) {
        const idx = providerConfigs.findIndex((c) => c.providerId === input.provider_id);
        if (idx === -1) {
          throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: 'Unknown provider_id' });
        }
        const [picked] = providerConfigs.splice(idx, 1);
        providerConfigs.unshift(picked!);
      }

      const manager = new EmailProviderManager();
      await manager.initialize({ ...settings, providerConfigs } as any);
      const providers = await manager.getAvailableProviders(tx.tenantId);
      const provider = providers[0] ?? null;
      if (!provider) {
        throwActionError(ctx, { category: 'ActionError', code: 'VALIDATION_ERROR', message: 'No enabled email provider configured' });
      }

      // Build content via static templating.
      const templateProcessor = new StaticTemplateProcessor(input.subject, input.html ?? '', input.text);
      const content = await templateProcessor.process({ templateData: (input.template_data ?? {}) as any });

      // Resolve from address.
      const resolveDefaultFrom = (): { email: string; name?: string } => {
        const fallbackDomain = settings.defaultFromDomain || settings.customDomains?.[0];
        const email = settings.ticketingFromEmail || (fallbackDomain ? `no-reply@${fallbackDomain}` : null);
        if (!email) {
          throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: 'No default From address configured for tenant' });
        }
        return { email };
      };
      const from = input.from ?? resolveDefaultFrom();

      // From domain constraints: allow tenant custom domains or the defaultFromDomain.
      const fromDomain = String(from.email).split('@')[1]?.toLowerCase() ?? '';
      const allowedDomains = new Set<string>([
        ...(settings.customDomains ?? []).map((d) => String(d).toLowerCase()),
        ...(settings.defaultFromDomain ? [String(settings.defaultFromDomain).toLowerCase()] : [])
      ]);
      if (fromDomain && allowedDomains.size > 0 && !allowedDomains.has(fromDomain)) {
        throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: 'From address domain is not allowed for this tenant' });
      }

      // Attachments via storage file refs.
      const attachmentFileIds = Array.isArray(input.attachment_file_ids) ? input.attachment_file_ids : [];
      const attachments: Array<{ filename: string; content: Buffer; contentType?: string }> = [];
      if (attachmentFileIds.length) {
        if (!provider.capabilities.supportsAttachments) {
          throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: 'Email provider does not support attachments' });
        }
        const maxPerAttachment = provider.capabilities.maxAttachmentSize ?? MAX_ATTACHMENT_BYTES;
        const storage = await StorageProviderFactory.createProvider();
        for (const fileId of attachmentFileIds) {
          const file = await tx.trx('external_files').where({ tenant: tx.tenantId, file_id: fileId, is_deleted: false }).first();
          if (!file) {
            throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Attachment file not found', details: { file_id: fileId } });
          }
          const size = Number(file.file_size ?? 0);
          if (size > maxPerAttachment) {
            throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: 'Attachment too large' });
          }
          const mimeType = (file.mime_type as string | null) ?? null;
          if (!isAllowedAttachmentMimeType(mimeType)) {
            throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: 'Attachment mime_type not allowed' });
          }
          const content = await storage.download(String(file.storage_path));
          attachments.push({
            filename: String(file.original_name ?? file.file_name ?? 'attachment'),
            content,
            contentType: mimeType ?? undefined
          });
        }
      }

      const recipientsCount = (input.to?.length ?? 0) + (input.cc?.length ?? 0) + (input.bcc?.length ?? 0);
      const maxRecipients = provider.capabilities.maxRecipientsPerMessage ?? 100;
      if (recipientsCount > maxRecipients) {
        throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: 'Too many recipients for email provider' });
      }

      try {
        const result = await manager.sendEmail(
          {
            from,
            to: input.to,
            cc: input.cc,
            bcc: input.bcc,
            subject: content.subject,
            html: content.html,
            text: content.text,
            attachments: attachments.length ? attachments : undefined
          } as any,
          tx.tenantId
        );

        if (!result.success) {
          throwActionError(ctx, { category: 'TransientError', code: 'TRANSIENT_FAILURE', message: result.error ?? 'Email send failed' });
        }

        await writeRunAudit(ctx, tx, {
          operation: 'workflow_action:email.send',
          changedData: { to_count: input.to.length, cc_count: input.cc?.length ?? 0, bcc_count: input.bcc?.length ?? 0 },
          details: { action_id: 'email.send', action_version: 1, provider_id: result.providerId, provider_type: result.providerType, message_id: result.messageId ?? null }
        });

        return {
          success: true,
          message_id: result.messageId ?? null,
          provider_id: result.providerId ?? null,
          provider_type: result.providerType ?? null,
          status: 'sent' as const,
          sent_at: result.sentAt ? new Date(result.sentAt).toISOString() : null
        };
      } catch (error) {
        if (error instanceof EmailProviderError) {
          if ((error.errorCode ?? '').toUpperCase().includes('RATE')) {
            throwActionError(ctx, { category: 'TransientError', code: 'RATE_LIMITED', message: error.message });
          }
          if (error.isRetryable) {
            throwActionError(ctx, { category: 'TransientError', code: 'TRANSIENT_FAILURE', message: error.message });
          }
          throwActionError(ctx, { category: 'ActionError', code: 'INTERNAL_ERROR', message: error.message });
        }
        throw error;
      }
    })
  });

  // ---------------------------------------------------------------------------
  // A14 — notifications.send_in_app
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'notifications.send_in_app',
    version: 1,
    inputSchema: z.object({
      recipients: z.object({
        user_ids: z.array(uuidSchema).optional().describe('User ids'),
        role_ids: z.array(uuidSchema).optional().describe('Role ids (users with these roles receive the notification)'),
        role_names: z.array(z.string().min(1)).optional().describe('Role names (case-insensitive)')
      }).describe('Recipients'),
      title: z.string().min(1).describe('Title'),
      body: z.string().min(1).describe('Body'),
      severity: z.enum(['info', 'success', 'warning', 'error']).default('info'),
      link: z.string().optional().describe('Optional deep link'),
      dedupe_key: z.string().optional().describe('Optional dedupe key (idempotency)')
    }),
    outputSchema: z.object({
      notification_ids: z.array(uuidSchema),
      delivered_count: z.number().int()
    }),
    sideEffectful: true,
    idempotency: { mode: 'actionProvided', key: (input: any, ctx: ActionContext) => input.dedupe_key ? String(input.dedupe_key) : actionProvidedKey(input, ctx) },
    ui: { label: 'Send In-App Notification', category: 'Business Operations', description: 'Create internal_notifications records for users' },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, { resource: 'notification', action: 'manage' });

      const explicitUserIds = Array.isArray(input.recipients?.user_ids) ? input.recipients.user_ids : [];
      const roleIds = Array.isArray(input.recipients?.role_ids) ? input.recipients.role_ids : [];
      const roleNames = Array.isArray(input.recipients?.role_names) ? input.recipients.role_names : [];

      const resolvedRoleIds: string[] = [];
      if (roleIds.length) resolvedRoleIds.push(...roleIds);
      if (roleNames.length) {
        const roleNamesLower = roleNames.map((n) => n.toLowerCase());
        const roles = await tx.trx('roles')
          .where({ tenant: tx.tenantId })
          .andWhere(function matchRoleNames() {
            roleNamesLower.forEach((name) => {
              this.orWhereRaw('lower(role_name) = ?', [name]);
            });
          })
          .select('role_id');
        resolvedRoleIds.push(...roles.map((r: any) => r.role_id));
      }

      const roleUserIds: string[] = resolvedRoleIds.length
        ? (await tx.trx('user_roles')
            .where({ tenant: tx.tenantId })
            .whereIn('role_id', resolvedRoleIds)
            .select('user_id'))
            .map((row: any) => row.user_id)
        : [];

      const userIds = Array.from(new Set([...explicitUserIds, ...roleUserIds]));
      if (!userIds.length) {
        throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: 'At least one recipient user_id is required' });
      }

      const existingUsers = await tx.trx('users')
        .where({ tenant: tx.tenantId })
        .whereIn('user_id', userIds)
        .select('user_id');
      const existingSet = new Set(existingUsers.map((u: any) => u.user_id));
      const missing = userIds.filter((id: string) => !existingSet.has(id));
      if (missing.length) {
        throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'One or more users not found', details: { missing_user_ids: missing } });
      }

      const nowIso = new Date().toISOString();
      const ids: string[] = [];
      for (const userId of userIds) {
        const notificationId = uuidv4();
        ids.push(notificationId);
        await tx.trx('internal_notifications').insert({
          internal_notification_id: notificationId,
          tenant: tx.tenantId,
          user_id: userId,
          template_name: 'workflow-custom',
          language_code: 'en',
          title: input.title,
          message: input.body,
          type: input.severity,
          category: 'workflow',
          link: input.link ?? null,
          metadata: { source: 'workflow', run_id: ctx.runId, step_path: ctx.stepPath },
          is_read: false,
          delivery_status: 'pending',
          delivery_attempts: 0,
          created_at: nowIso,
          updated_at: nowIso
        });
      }

      await writeRunAudit(ctx, tx, {
        operation: 'workflow_action:notifications.send_in_app',
        changedData: { delivered_count: ids.length },
        details: { action_id: 'notifications.send_in_app', action_version: 1, delivered_count: ids.length }
      });

      return { notification_ids: ids, delivered_count: ids.length };
    })
  });

  // ---------------------------------------------------------------------------
  // A15 — scheduling.assign_user
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'scheduling.assign_user',
    version: 1,
    inputSchema: z.object({
      user_id: uuidSchema.describe('Assigned user id'),
      window: z.object({
        start: isoDateTimeSchema.describe('Start time (ISO)'),
        end: isoDateTimeSchema.describe('End time (ISO)'),
        timezone: z.string().optional().describe('IANA timezone (informational)')
      }),
      link: z.object({
        type: z.enum(['ticket', 'project_task']).describe('Work item type'),
        id: uuidSchema.describe('Work item id')
      }),
      title: z.string().optional().describe('Schedule entry title'),
      notes: z.string().optional().describe('Notes'),
      conflict_mode: z.enum(['fail', 'shift', 'override']).default('fail').describe('Conflict handling mode')
    }),
    outputSchema: z.object({
      schedule_event_id: uuidSchema,
      assigned_user_id: uuidSchema,
      start: isoDateTimeSchema,
      end: isoDateTimeSchema
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Assign User (Schedule Entry)', category: 'Business Operations', description: 'Create a schedule entry for a user' },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, { resource: 'user_schedule', action: 'create' });

      // Verify user exists
      const user = await tx.trx('users').where({ tenant: tx.tenantId, user_id: input.user_id }).first();
      if (!user) throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'User not found' });
      // Technician eligibility (best-effort): require Technician role.
      const technicianRole = await tx.trx('user_roles as ur')
        .join('roles as r', function joinRoles() {
          this.on('ur.tenant', 'r.tenant').andOn('ur.role_id', 'r.role_id');
        })
        .where({ 'ur.tenant': tx.tenantId, 'ur.user_id': input.user_id })
        .whereRaw('lower(r.role_name) = ?', ['technician'])
        .first();
      if (!technicianRole) {
        throwActionError(ctx, { category: 'ActionError', code: 'PERMISSION_DENIED', message: 'User is not eligible for scheduling (requires Technician role)' });
      }

      // Verify linked entity exists
      if (input.link.type === 'ticket') {
        const t = await tx.trx('tickets').where({ tenant: tx.tenantId, ticket_id: input.link.id }).first();
        if (!t) throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Ticket not found' });
      } else {
        const task = await tx.trx('project_tasks').where({ tenant: tx.tenantId, task_id: input.link.id }).first();
        if (!task) throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Project task not found' });
      }

      let start = new Date(input.window.start);
      let end = new Date(input.window.end);
      if (!(start.getTime() < end.getTime())) {
        throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: 'window.start must be before window.end' });
      }

      const findConflicts = async (s: Date, e: Date) => tx.trx('schedule_entries')
        .where({ tenant: tx.tenantId, user_id: input.user_id })
        .andWhere('scheduled_start', '<', e.toISOString())
        .andWhere('scheduled_end', '>', s.toISOString())
        .select('*');

      let conflicts = await findConflicts(start, end);
      if (conflicts.length && input.conflict_mode === 'fail') {
        throwActionError(ctx, { category: 'ActionError', code: 'CONFLICT', message: 'Schedule conflict detected' });
      }

      if (conflicts.length && input.conflict_mode === 'shift') {
        // Shift to the end of the latest conflicting entry.
        const latestEnd = conflicts
          .map((c: any) => new Date(c.scheduled_end).getTime())
          .reduce((a: number, b: number) => Math.max(a, b), start.getTime());
        const durationMs = end.getTime() - start.getTime();
        start = new Date(latestEnd);
        end = new Date(latestEnd + durationMs);
        conflicts = await findConflicts(start, end);
        if (conflicts.length) {
          throwActionError(ctx, { category: 'ActionError', code: 'CONFLICT', message: 'Unable to shift schedule entry to a non-conflicting window' });
        }
      }

      const entryId = uuidv4();
      const nowIso = new Date().toISOString();
      await tx.trx('schedule_entries').insert({
        tenant: tx.tenantId,
        entry_id: entryId,
        title: input.title ?? 'Scheduled work',
        work_item_id: input.link.id,
        user_id: input.user_id,
        scheduled_start: start.toISOString(),
        scheduled_end: end.toISOString(),
        status: 'scheduled',
        notes: input.notes ?? null,
        work_item_type: input.link.type,
        created_at: nowIso,
        updated_at: nowIso
      });

      if (input.conflict_mode === 'override') {
        // Record conflicts (best-effort).
        const overlapping = await findConflicts(start, end);
        for (const other of overlapping) {
          if (other.entry_id === entryId) continue;
          await tx.trx('schedule_conflicts').insert({
            tenant: tx.tenantId,
            conflict_id: uuidv4(),
            entry_id_1: entryId,
            entry_id_2: other.entry_id,
            conflict_type: 'overlap',
            resolved: false,
            created_at: nowIso,
            updated_at: nowIso
          });
        }
      }

      await writeRunAudit(ctx, tx, {
        operation: 'workflow_action:scheduling.assign_user',
        changedData: { entry_id: entryId, user_id: input.user_id, start: start.toISOString(), end: end.toISOString(), link: input.link },
        details: { action_id: 'scheduling.assign_user', action_version: 1, schedule_event_id: entryId }
      });

      return { schedule_event_id: entryId, assigned_user_id: input.user_id, start: start.toISOString(), end: end.toISOString() };
    })
  });

  // ---------------------------------------------------------------------------
  // A16 — projects.create_task
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'projects.create_task',
    version: 1,
    inputSchema: z.object({
      project_id: uuidSchema.describe('Project id'),
      phase_id: uuidSchema.optional().describe('Optional phase id (defaults to first phase)'),
      title: z.string().min(1).describe('Task title'),
      description: z.string().optional().describe('Task description'),
      due_date: isoDateTimeSchema.optional().describe('Optional due date'),
      status_id: uuidSchema.optional().describe('Optional initial status id (project_task status)'),
      priority_id: uuidSchema.nullable().optional().describe('Optional priority id'),
      assignee: z.object({
        type: z.enum(['user', 'team']).describe('Assignee type'),
        id: uuidSchema.describe('User id or team id')
      }).optional().describe('Optional assignee'),
      link_ticket_id: uuidSchema.optional().describe('Optional ticket id to link')
    }),
    outputSchema: z.object({
      task_id: uuidSchema,
      url: z.string(),
      status_id: uuidSchema.nullable(),
      priority_id: uuidSchema.nullable(),
      created_at: isoDateTimeSchema
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Create Project Task', category: 'Business Operations', description: 'Create a task under a project' },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, { resource: 'project_task', action: 'create' });

      const project = await tx.trx('projects').where({ tenant: tx.tenantId, project_id: input.project_id }).first();
      if (!project) throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Project not found' });

      const phaseId = input.phase_id ?? (await tx.trx('project_phases')
        .where({ tenant: tx.tenantId, project_id: input.project_id })
        .orderBy('order_number', 'asc')
        .first())?.phase_id;
      if (!phaseId) throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Project phase not found' });

      const assignedTo = input.assignee
        ? (input.assignee.type === 'user'
            ? input.assignee.id
            : (await tx.trx('teams').where({ tenant: tx.tenantId, team_id: input.assignee.id }).first())?.manager_id)
        : null;
      if (input.assignee && input.assignee.type === 'team' && !assignedTo) {
        throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Team not found' });
      }
      if (assignedTo) {
        const user = await tx.trx('users').where({ tenant: tx.tenantId, user_id: assignedTo }).first();
        if (!user) throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Assignee user not found' });
      }

      let statusId: string | null = input.status_id ?? null;
      if (statusId) {
        const status = await tx.trx('statuses').where({ tenant: tx.tenantId, status_id: statusId, status_type: 'project_task' }).first();
        if (!status) throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: 'Invalid project task status_id' });
      } else {
        const defaultStatus = await tx.trx('statuses')
          .where({ tenant: tx.tenantId, status_type: 'project_task' })
          .orderBy('is_default', 'desc')
          .orderBy('order_number', 'asc')
          .first();
        statusId = (defaultStatus?.status_id as string | undefined) ?? null;
      }

      // Generate next WBS code within phase.
      const phase = await tx.trx('project_phases').where({ tenant: tx.tenantId, phase_id: phaseId }).first();
      const baseWbs = (phase?.wbs_code as string) ?? '1';
      const countRow = await tx.trx('project_tasks')
        .where({ tenant: tx.tenantId, phase_id: phaseId })
        .count('* as count')
        .first();
      const n = parseInt(String((countRow as any)?.count ?? 0), 10) + 1;
      const wbsCode = `${baseWbs}.${n}`;

      const taskId = uuidv4();
      const nowIso = new Date().toISOString();
      await tx.trx('project_tasks').insert({
        tenant: tx.tenantId,
        task_id: taskId,
        phase_id: phaseId,
        task_name: input.title,
        description: input.description ?? null,
        assigned_to: assignedTo,
        due_date: input.due_date ?? null,
        status_id: statusId,
        priority_id: input.priority_id ?? null,
        wbs_code: wbsCode,
        created_at: nowIso,
        updated_at: nowIso
      });

      if (input.link_ticket_id) {
        // Best-effort link to ticket via project_ticket_links.
        await tx.trx('project_ticket_links').insert({
          tenant: tx.tenantId,
          link_id: uuidv4(),
          project_id: input.project_id,
          phase_id: phaseId,
          task_id: taskId,
          ticket_id: input.link_ticket_id,
          created_at: nowIso
        }).catch(() => undefined);

        // Also link from the ticket side using ticket_entity_links (introduced by this plan).
        await tx.trx('ticket_entity_links').insert({
          tenant: tx.tenantId,
          link_id: uuidv4(),
          ticket_id: input.link_ticket_id,
          entity_type: 'project_task',
          entity_id: taskId,
          link_type: 'project_task',
          metadata: { project_id: input.project_id, phase_id: phaseId },
          created_at: nowIso
        }).catch(() => undefined);
      }

      await writeRunAudit(ctx, tx, {
        operation: 'workflow_action:projects.create_task',
        changedData: { project_id: input.project_id, task_id: taskId, phase_id: phaseId, link_ticket_id: input.link_ticket_id ?? null },
        details: { action_id: 'projects.create_task', action_version: 1, task_id: taskId }
      });

      return {
        task_id: taskId,
        url: `/msp/projects/${input.project_id}?task=${taskId}`,
        status_id: statusId,
        priority_id: input.priority_id ?? null,
        created_at: nowIso
      };
    })
  });

  // ---------------------------------------------------------------------------
  // A17 — time.create_entry
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'time.create_entry',
    version: 1,
    inputSchema: z.object({
      user_id: uuidSchema.describe('User id'),
      start: isoDateTimeSchema.describe('Start time (ISO)'),
      duration_minutes: z.number().int().positive().describe('Duration in minutes'),
      billable: z.boolean().default(true),
      rounding_minutes: z.number().int().positive().default(6).describe('Rounding increment in minutes'),
      link: z.object({
        type: z.enum(['ticket', 'project', 'project_task']).describe('Work item type'),
        id: uuidSchema.describe('Work item id')
      }).optional(),
      billing_plan_id: uuidSchema.nullable().optional().describe('Optional billing plan/service code selection'),
      tax_rate_id: uuidSchema.nullable().optional().describe('Optional tax rate id'),
      notes: z.string().optional()
    }),
    outputSchema: z.object({
      time_entry_id: uuidSchema,
      total_minutes: z.number().int(),
      billable_minutes: z.number().int()
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Create Time Entry', category: 'Business Operations', description: 'Create a time entry linked to work' },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, { resource: 'timeentry', action: 'create' });
      // Logging time for another user is restricted; require timeentry:update as a coarse-grained elevated permission.
      if (input.user_id !== tx.actorUserId) {
        await requirePermission(ctx, tx, { resource: 'timeentry', action: 'update' });
      }

      const user = await tx.trx('users').where({ tenant: tx.tenantId, user_id: input.user_id }).first();
      if (!user) throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'User not found' });

      if (input.link) {
        if (input.link.type === 'ticket') {
          const t = await tx.trx('tickets').where({ tenant: tx.tenantId, ticket_id: input.link.id }).first();
          if (!t) throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Ticket not found' });
        } else if (input.link.type === 'project') {
          const p = await tx.trx('projects').where({ tenant: tx.tenantId, project_id: input.link.id }).first();
          if (!p) throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Project not found' });
        } else {
          const task = await tx.trx('project_tasks').where({ tenant: tx.tenantId, task_id: input.link.id }).first();
          if (!task) throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Project task not found' });
        }
      }

      const increment = Math.max(1, input.rounding_minutes ?? 6);
      const rounded = Math.ceil(input.duration_minutes / increment) * increment;
      if (rounded > 24 * 60) {
        throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: 'duration_minutes too large' });
      }

      const start = new Date(input.start);
      const end = new Date(start.getTime() + rounded * 60 * 1000);
      const workTimezone = (user.timezone as string | null) ?? 'UTC';
      const workDate = start.toISOString().slice(0, 10);
      const entryId = uuidv4();
      const nowIso = new Date().toISOString();
      await tx.trx('time_entries').insert({
        tenant: tx.tenantId,
        entry_id: entryId,
        user_id: input.user_id,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        work_date: workDate,
        work_timezone: workTimezone,
        notes: input.notes ?? null,
        work_item_id: input.link?.id ?? null,
        work_item_type: input.link?.type ?? null,
        billable_duration: input.billable ? rounded : 0,
        billing_plan_id: input.billing_plan_id ?? null,
        tax_rate_id: input.tax_rate_id ?? null,
        approval_status: 'DRAFT',
        created_at: nowIso,
        updated_at: nowIso
      });

      await writeRunAudit(ctx, tx, {
        operation: 'workflow_action:time.create_entry',
        changedData: { entry_id: entryId, user_id: input.user_id, minutes: rounded, billable: input.billable },
        details: { action_id: 'time.create_entry', action_version: 1, time_entry_id: entryId }
      });

      return { time_entry_id: entryId, total_minutes: rounded, billable_minutes: input.billable ? rounded : 0 };
    })
  });

  // ---------------------------------------------------------------------------
  // A18 — crm.create_activity_note
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'crm.create_activity_note',
    version: 1,
    inputSchema: z.object({
      target: z.object({
        type: z.enum(['client', 'contact', 'ticket', 'project']).describe('Target type'),
        id: uuidSchema.describe('Target id')
      }),
      body: z.string().min(1).describe('Note body'),
      visibility: z.enum(['internal', 'client_visible']).default('internal'),
      tags: z.array(z.string()).optional(),
      category: z.string().optional()
    }),
    outputSchema: z.object({
      note_id: uuidSchema,
      created_at: isoDateTimeSchema,
      target_type: z.string(),
      target_id: uuidSchema,
      target_summary: z.record(z.unknown()).nullable()
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Create Activity Note', category: 'Business Operations', description: 'Create a CRM activity note (interaction)' },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, { resource: 'interaction', action: 'create' });

      // Policy: client_visible notes require a client/contact/ticket target (project visibility support is tenant-dependent).
      if (input.visibility === 'client_visible' && input.target.type === 'project') {
        throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: 'client_visible notes are not supported for project targets' });
      }

      // Validate target and set foreign keys.
      let clientId: string | null = null;
      let contactId: string | null = null;
      let ticketId: string | null = null;
      let projectId: string | null = null;
      let targetSummary: Record<string, unknown> | null = null;

      if (input.target.type === 'client') {
        const client = await tx.trx('clients').where({ tenant: tx.tenantId, client_id: input.target.id }).first();
        if (!client) throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Client not found' });
        clientId = input.target.id;
        targetSummary = { client_id: input.target.id, client_name: client.client_name ?? null };
      } else if (input.target.type === 'contact') {
        const contact = await tx.trx('contacts').where({ tenant: tx.tenantId, contact_name_id: input.target.id }).first();
        if (!contact) throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Contact not found' });
        contactId = input.target.id;
        clientId = (contact.client_id as string | null) ?? null;
        targetSummary = { contact_id: input.target.id, full_name: contact.full_name ?? null, email: contact.email ?? null, client_id: clientId };
      } else if (input.target.type === 'ticket') {
        const ticket = await tx.trx('tickets').where({ tenant: tx.tenantId, ticket_id: input.target.id }).first();
        if (!ticket) throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Ticket not found' });
        ticketId = input.target.id;
        clientId = (ticket.client_id as string | null) ?? null;
        contactId = (ticket.contact_name_id as string | null) ?? null;
        targetSummary = { ticket_id: input.target.id, ticket_number: ticket.ticket_number ?? null, title: ticket.title ?? null, client_id: clientId };
      } else if (input.target.type === 'project') {
        const project = await tx.trx('projects').where({ tenant: tx.tenantId, project_id: input.target.id }).first();
        if (!project) throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Project not found' });
        projectId = input.target.id;
        clientId = (project.client_id as string | null) ?? null;
        targetSummary = { project_id: input.target.id, project_name: project.project_name ?? null, client_id: clientId };
      }

      const noteType = await tx.trx('system_interaction_types').where({ type_name: 'Note' }).first();
      if (!noteType) throwActionError(ctx, { category: 'ActionError', code: 'INTERNAL_ERROR', message: 'System interaction type Note missing' });

      const noteId = uuidv4();
      const nowIso = new Date().toISOString();
      await tx.trx('interactions').insert({
        tenant: tx.tenantId,
        interaction_id: noteId,
        type_id: noteType.type_id,
        contact_name_id: contactId,
        client_id: clientId,
        ticket_id: ticketId,
        project_id: projectId,
        user_id: tx.actorUserId,
        title: input.category ?? 'Note',
        notes: input.body,
        interaction_date: nowIso,
        start_time: nowIso,
        end_time: nowIso,
        duration: 0,
        status_id: null,
        visibility: input.visibility,
        category: input.category ?? null,
        tags: input.tags ?? null
      });

      await writeRunAudit(ctx, tx, {
        operation: 'workflow_action:crm.create_activity_note',
        changedData: { interaction_id: noteId, target: input.target },
        details: { action_id: 'crm.create_activity_note', action_version: 1, note_id: noteId }
      });

      return { note_id: noteId, created_at: nowIso, target_type: input.target.type, target_id: input.target.id, target_summary: targetSummary };
    })
  });
}
