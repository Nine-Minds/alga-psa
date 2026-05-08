import { v4 as uuidv4 } from 'uuid';
import type { EmailProviderConfig } from '@alga-psa/shared/interfaces/inbound-email.interfaces';
import {
  MAX_ATTACHMENT_BYTES,
  ORIGINAL_EMAIL_ATTACHMENT_ID,
  buildDeterministicRfc822Message,
  buildOriginalEmailFileName,
  extractEmbeddedImageAttachments,
  hasRawMimeOverCapSkipReason,
  maybeExtractRawMimeFromEmailData,
  sanitizeGeneratedFileName,
} from './emailAttachmentHelpers';

const STALE_PROCESSING_MS = 30 * 60 * 1000; // 30 minutes

type ActionExecutionContext = {
  tenant: string;
  executionId: string;
  idempotencyKey: string;
  knex?: unknown;
};

type LegacyActionRegistry = {
  registerSimpleAction: (
    name: string,
    description: string,
    parameters: Array<{ name: string; type: string; required: boolean; description?: string }>,
    executeFn: (params: Record<string, any>, context: ActionExecutionContext) => Promise<any>
  ) => void;
};

function isUniqueViolation(error: any): boolean {
  return error?.code === '23505' || String(error?.message || '').toLowerCase().includes('duplicate');
}

function isBase64(value: string): boolean {
  return /^[A-Za-z0-9+/=\s]+$/.test(value);
}

async function resolveSystemUserId(knex: any, tenant: string): Promise<string | null> {
  const inboundDefaults = await knex('inbound_ticket_defaults')
    .select('entered_by')
    .where({ tenant, is_active: true })
    .whereNotNull('entered_by')
    .orderBy('updated_at', 'desc')
    .first();
  if (inboundDefaults?.entered_by) return inboundDefaults.entered_by;

  const user = await knex('users')
    .select('user_id')
    .where({ tenant })
    .orderBy('created_at', 'asc')
    .first();
  return user?.user_id || null;
}

async function ensureKnex(context: ActionExecutionContext): Promise<any> {
  const existing = (context.knex as any) || null;
  if (existing) {
    return existing;
  }

  const { getAdminConnection } = await import('@alga-psa/db/admin');
  return await getAdminConnection();
}

async function loadProviderRow(knex: any, tenant: string, providerId: string): Promise<any | null> {
  return await knex('email_providers')
    .where({ tenant, id: providerId })
    .first();
}

async function buildMicrosoftProviderConfig(
  knex: any,
  tenant: string,
  providerRow: any
): Promise<EmailProviderConfig> {
  const mc = await knex('microsoft_email_provider_config')
    .where({ tenant, email_provider_id: providerRow.id })
    .first();
  if (!mc) {
    throw new Error(`Microsoft provider config not found for provider ${providerRow.id}`);
  }

  return {
    id: providerRow.id,
    tenant,
    name: providerRow.provider_name || providerRow.mailbox,
    provider_type: 'microsoft',
    mailbox: providerRow.mailbox,
    folder_to_monitor: 'Inbox',
    active: !!providerRow.is_active,
    webhook_notification_url: providerRow.webhook_notification_url || '',
    webhook_subscription_id: mc.webhook_subscription_id || undefined,
    webhook_verification_token: mc.webhook_verification_token || undefined,
    webhook_expires_at: mc.webhook_expires_at || undefined,
    connection_status: (providerRow.status as any) || 'connected',
    created_at: providerRow.created_at?.toISOString?.() ?? String(providerRow.created_at ?? new Date().toISOString()),
    updated_at: providerRow.updated_at?.toISOString?.() ?? String(providerRow.updated_at ?? new Date().toISOString()),
    provider_config: {
      client_id: mc.client_id,
      client_secret: mc.client_secret,
      tenant_id: mc.tenant_id,
      access_token: mc.access_token,
      refresh_token: mc.refresh_token,
      token_expires_at: mc.token_expires_at,
    },
  } as any;
}

async function buildGoogleProviderConfig(
  knex: any,
  tenant: string,
  providerRow: any
): Promise<EmailProviderConfig> {
  const gc = await knex('google_email_provider_config')
    .where({ tenant, email_provider_id: providerRow.id })
    .first();
  if (!gc) {
    throw new Error(`Google provider config not found for provider ${providerRow.id}`);
  }

  return {
    id: providerRow.id,
    tenant,
    name: providerRow.provider_name || providerRow.mailbox,
    provider_type: 'google',
    mailbox: providerRow.mailbox,
    folder_to_monitor: 'Inbox',
    active: !!providerRow.is_active,
    webhook_notification_url: providerRow.webhook_notification_url || '',
    connection_status: (providerRow.status as any) || 'connected',
    created_at: providerRow.created_at?.toISOString?.() ?? String(providerRow.created_at ?? new Date().toISOString()),
    updated_at: providerRow.updated_at?.toISOString?.() ?? String(providerRow.updated_at ?? new Date().toISOString()),
    provider_config: {
      project_id: gc.project_id,
      pubsub_topic_name: gc.pubsub_topic_name,
      pubsub_subscription_name: gc.pubsub_subscription_name,
      client_id: gc.client_id,
      client_secret: gc.client_secret,
      access_token: gc.access_token,
      refresh_token: gc.refresh_token,
      token_expires_at: gc.token_expires_at,
      history_id: gc.history_id,
      watch_expiration: gc.watch_expiration,
      label_filters: gc.label_filters,
      auto_process_emails: gc.auto_process_emails,
      max_emails_per_sync: gc.max_emails_per_sync,
    },
  } as any;
}

async function claimAttachmentRow(knex: any, args: {
  tenant: string;
  providerId: string;
  emailId: string;
  attachmentId: string;
  fileName: string;
  contentType: string;
  fileSize: number | null;
  contentId: string | null;
}): Promise<{ claimed: true } | { claimed: false; result: Record<string, any> }> {
  const now = new Date();

  try {
    await knex('email_processed_attachments').insert({
      tenant: args.tenant,
      provider_id: args.providerId,
      email_id: args.emailId,
      attachment_id: args.attachmentId,
      processing_status: 'processing',
      file_name: args.fileName || null,
      content_type: args.contentType || null,
      file_size: args.fileSize,
      content_id: args.contentId,
      created_at: now,
      updated_at: now,
    });

    return { claimed: true };
  } catch (error: any) {
    if (!isUniqueViolation(error)) {
      throw error;
    }

    const existing = await knex('email_processed_attachments')
      .where({
        tenant: args.tenant,
        provider_id: args.providerId,
        email_id: args.emailId,
        attachment_id: args.attachmentId,
      })
      .first();

    const status = String(existing?.processing_status || '').toLowerCase();
    if (status === 'failed') {
      const updated = await knex('email_processed_attachments')
        .where({
          tenant: args.tenant,
          provider_id: args.providerId,
          email_id: args.emailId,
          attachment_id: args.attachmentId,
        })
        .andWhere('processing_status', 'failed')
        .update({
          processing_status: 'processing',
          error_message: null,
          file_name: args.fileName || existing?.file_name || null,
          content_type: args.contentType || existing?.content_type || null,
          file_size: args.fileSize ?? existing?.file_size ?? null,
          content_id: args.contentId ?? existing?.content_id ?? null,
          updated_at: new Date(),
        });

      if (updated === 1) {
        return { claimed: true };
      }
    }

    if (status === 'processing') {
      const updatedAt = existing?.updated_at ? new Date(existing.updated_at) : null;
      const isStale =
        updatedAt instanceof Date &&
        Number.isFinite(updatedAt.getTime()) &&
        Date.now() - updatedAt.getTime() > STALE_PROCESSING_MS;

      if (isStale) {
        const takeover = await knex('email_processed_attachments')
          .where({
            tenant: args.tenant,
            provider_id: args.providerId,
            email_id: args.emailId,
            attachment_id: args.attachmentId,
          })
          .andWhere('processing_status', 'processing')
          .andWhere('updated_at', '<', new Date(Date.now() - STALE_PROCESSING_MS))
          .update({
            error_message: null,
            file_name: args.fileName || existing?.file_name || null,
            content_type: args.contentType || existing?.content_type || null,
            file_size: args.fileSize ?? existing?.file_size ?? null,
            content_id: args.contentId ?? existing?.content_id ?? null,
            updated_at: new Date(),
          });

        if (takeover === 1) {
          return { claimed: true };
        }
      }
    }

    return {
      claimed: false,
      result: {
        success: true,
        duplicate: true,
        processing_status: existing?.processing_status,
        documentId: existing?.document_id ?? null,
        fileId: existing?.file_id ?? null,
      },
    };
  }
}

async function markProcessedAttachment(
  knex: any,
  args: {
    tenant: string;
    providerId: string;
    emailId: string;
    attachmentId: string;
    status: 'skipped' | 'failed';
    errorMessage: string;
  }
): Promise<void> {
  await knex('email_processed_attachments')
    .where({
      tenant: args.tenant,
      provider_id: args.providerId,
      email_id: args.emailId,
      attachment_id: args.attachmentId,
    })
    .update({
      processing_status: args.status,
      error_message: args.errorMessage,
      updated_at: new Date(),
    });
}

async function persistDocumentForBuffer(args: {
  knex: any;
  tenant: string;
  providerId: string;
  emailId: string;
  attachmentId: string;
  ticketId: string;
  systemUserId: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<{
  success: boolean;
  message?: string;
  documentId?: string;
  fileId?: string;
}> {
  const { StorageProviderFactory, generateStoragePath } = await import('@alga-psa/storage');

  const safeFileName = sanitizeGeneratedFileName(args.fileName, 'attachment.bin');
  const storageProvider = await StorageProviderFactory.createProvider();
  const storagePath = generateStoragePath(args.tenant, '', safeFileName);

  let uploadResult: any;
  try {
    uploadResult = await storageProvider.upload(args.buffer, storagePath, {
      mime_type: args.mimeType,
    });
  } catch (uploadErr: any) {
    await markProcessedAttachment(args.knex, {
      tenant: args.tenant,
      providerId: args.providerId,
      emailId: args.emailId,
      attachmentId: args.attachmentId,
      status: 'failed',
      errorMessage: uploadErr?.message || String(uploadErr),
    });
    return { success: false, message: uploadErr?.message || String(uploadErr) };
  }

  const now = new Date();
  const fileId = uuidv4();
  const documentId = uuidv4();

  try {
    await args.knex.transaction(async (trx: any) => {
      await trx('external_files').insert({
        tenant: args.tenant,
        file_id: fileId,
        file_name: String(storagePath).split('/').pop(),
        original_name: safeFileName,
        mime_type: args.mimeType,
        file_size: args.buffer.length,
        storage_path: uploadResult.path,
        uploaded_by_id: args.systemUserId,
        created_at: now,
        updated_at: now,
      });

      await trx('documents').insert({
        tenant: args.tenant,
        document_id: documentId,
        document_name: safeFileName,
        type_id: null,
        shared_type_id: null,
        user_id: args.systemUserId,
        created_by: args.systemUserId,
        entered_at: now,
        updated_at: now,
        file_id: fileId,
        storage_path: uploadResult.path,
        mime_type: args.mimeType,
        file_size: args.buffer.length,
      });

      await trx('document_associations').insert({
        tenant: args.tenant,
        association_id: uuidv4(),
        document_id: documentId,
        entity_id: args.ticketId,
        entity_type: 'ticket',
        created_at: now,
      });

      await trx('email_processed_attachments')
        .where({
          tenant: args.tenant,
          provider_id: args.providerId,
          email_id: args.emailId,
          attachment_id: args.attachmentId,
        })
        .update({
          processing_status: 'success',
          file_id: fileId,
          document_id: documentId,
          file_name: safeFileName,
          content_type: args.mimeType,
          file_size: args.buffer.length,
          updated_at: now,
        });
    });

    return { success: true, documentId, fileId };
  } catch (dbErr: any) {
    await markProcessedAttachment(args.knex, {
      tenant: args.tenant,
      providerId: args.providerId,
      emailId: args.emailId,
      attachmentId: args.attachmentId,
      status: 'failed',
      errorMessage: dbErr?.message || String(dbErr),
    });
    return { success: false, message: dbErr?.message || String(dbErr) };
  }
}

async function downloadAttachmentBuffer(args: {
  knex: any;
  tenant: string;
  providerId: string;
  providerAttachmentId: string;
  emailId: string;
  contentType: string;
  fileName: string;
}): Promise<{ buffer: Buffer; contentType: string; fileName: string }> {
  const providerRow = await loadProviderRow(args.knex, args.tenant, args.providerId);
  if (!providerRow) {
    throw new Error('Email provider not found');
  }

  if (providerRow.provider_type === 'microsoft') {
    const { MicrosoftGraphAdapter } = await import(
      '@alga-psa/shared/services/email/providers/MicrosoftGraphAdapter'
    );
    const providerConfig = await buildMicrosoftProviderConfig(args.knex, args.tenant, providerRow);
    const adapter = new MicrosoftGraphAdapter(providerConfig);
    await adapter.connect();
    const downloaded = await adapter.downloadAttachmentBytes(args.emailId, args.providerAttachmentId);
    return {
      buffer: downloaded.buffer,
      contentType: downloaded.contentType || args.contentType,
      fileName: downloaded.fileName || args.fileName,
    };
  }

  if (providerRow.provider_type === 'google') {
    const { GmailAdapter } = await import('@alga-psa/integrations/runtime');
    const providerConfig = await buildGoogleProviderConfig(args.knex, args.tenant, providerRow);
    const adapter = new GmailAdapter(providerConfig);
    await adapter.connect();
    const buffer = await adapter.downloadAttachmentBytes(args.emailId, args.providerAttachmentId);
    return {
      buffer,
      contentType: args.contentType,
      fileName: args.fileName,
    };
  }

  throw new Error(`Unsupported provider_type: ${providerRow.provider_type}`);
}

async function downloadOriginalMime(args: {
  knex: any;
  tenant: string;
  providerId: string;
  emailId: string;
  emailData: any;
}): Promise<Buffer> {
  const rawFromPayload = maybeExtractRawMimeFromEmailData(args.emailData);
  if (rawFromPayload) {
    return rawFromPayload;
  }

  const providerRow = await loadProviderRow(args.knex, args.tenant, args.providerId);
  if (!providerRow) {
    return buildDeterministicRfc822Message(args.emailData || { id: args.emailId });
  }

  if (providerRow.provider_type === 'microsoft') {
    const { MicrosoftGraphAdapter } = await import(
      '@alga-psa/shared/services/email/providers/MicrosoftGraphAdapter'
    );
    const providerConfig = await buildMicrosoftProviderConfig(args.knex, args.tenant, providerRow);
    const adapter = new MicrosoftGraphAdapter(providerConfig);
    await adapter.connect();
    return await adapter.downloadMessageSource(args.emailId);
  }

  if (providerRow.provider_type === 'google') {
    const { GmailAdapter } = await import('@alga-psa/integrations/runtime');
    const providerConfig = await buildGoogleProviderConfig(args.knex, args.tenant, providerRow);
    const adapter = new GmailAdapter(providerConfig);
    await adapter.connect();
    return await adapter.downloadMessageSource(args.emailId);
  }

  // IMAP/MailHog path fallback.
  return buildDeterministicRfc822Message(args.emailData || { id: args.emailId });
}

export function registerEmailAttachmentActions(actionRegistry: LegacyActionRegistry): void {
  actionRegistry.registerSimpleAction(
    'extract_embedded_email_attachments',
    'Extract HTML embedded image attachments from data URLs and referenced CID images',
    [
      { name: 'emailId', type: 'string', required: true },
      { name: 'html', type: 'string', required: false },
      { name: 'attachments', type: 'array', required: false },
    ],
    async (params: Record<string, any>) => {
      const extracted = extractEmbeddedImageAttachments({
        emailId: String(params.emailId || ''),
        html: typeof params.html === 'string' ? params.html : '',
        attachments: Array.isArray(params.attachments) ? params.attachments : [],
        maxBytes: MAX_ATTACHMENT_BYTES,
      });

      return {
        success: true,
        attachments: extracted.attachments,
        warnings: extracted.warnings,
      };
    }
  );

  actionRegistry.registerSimpleAction(
    'process_email_attachment',
    'Process email attachment and associate with ticket (storage-backed, idempotent)',
    [
      { name: 'emailId', type: 'string', required: true },
      { name: 'attachmentId', type: 'string', required: true },
      { name: 'ticketId', type: 'string', required: true },
      { name: 'tenant', type: 'string', required: true },
      { name: 'providerId', type: 'string', required: true },
      { name: 'attachmentData', type: 'object', required: true },
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      const tenant = context.tenant || params.tenant;
      const providerId = params.providerId as string;
      const emailId = params.emailId as string;
      const attachmentId = params.attachmentId as string;
      const ticketId = params.ticketId as string;
      const attachment = params.attachmentData || {};

      const requestedFileName = String(attachment.name || '');
      const requestedContentType = String(attachment.contentType || 'application/octet-stream').toLowerCase();
      const declaredSize: number | null = typeof attachment.size === 'number' ? attachment.size : null;
      const contentId: string | null = attachment.contentId ? String(attachment.contentId) : null;
      const isInline: boolean = Boolean(attachment.isInline);
      const allowInlineProcessing = Boolean(attachment.allowInlineProcessing);
      const providerAttachmentId: string = String(attachment.providerAttachmentId || attachmentId);
      const providedContentBase64: string | null =
        typeof attachment.content === 'string' && attachment.content.trim().length > 0
          ? attachment.content.trim()
          : null;

      const knex = await ensureKnex(context);

      const claim = await claimAttachmentRow(knex, {
        tenant,
        providerId,
        emailId,
        attachmentId,
        fileName: requestedFileName,
        contentType: requestedContentType,
        fileSize: declaredSize,
        contentId,
      });

      if (!claim.claimed) {
        return (claim as { claimed: false; result: Record<string, any> }).result;
      }

      if (isInline && !allowInlineProcessing) {
        await markProcessedAttachment(knex, {
          tenant,
          providerId,
          emailId,
          attachmentId,
          status: 'skipped',
          errorMessage: 'Inline attachments are handled via embedded extraction',
        });
        return { success: true, skipped: true, reason: 'inline' };
      }

      if (!requestedFileName) {
        await markProcessedAttachment(knex, {
          tenant,
          providerId,
          emailId,
          attachmentId,
          status: 'skipped',
          errorMessage: 'Attachment missing filename',
        });
        return { success: true, skipped: true, reason: 'missing_filename' };
      }

      if (declaredSize !== null && declaredSize > MAX_ATTACHMENT_BYTES) {
        await markProcessedAttachment(knex, {
          tenant,
          providerId,
          emailId,
          attachmentId,
          status: 'skipped',
          errorMessage: `Attachment exceeds max size (${MAX_ATTACHMENT_BYTES} bytes)`,
        });
        return { success: true, skipped: true, reason: 'too_large' };
      }

      if (allowInlineProcessing && !requestedContentType.startsWith('image/')) {
        await markProcessedAttachment(knex, {
          tenant,
          providerId,
          emailId,
          attachmentId,
          status: 'skipped',
          errorMessage: 'Embedded extraction only supports image MIME types',
        });
        return { success: true, skipped: true, reason: 'non_image_embedded' };
      }

      const systemUserId = await resolveSystemUserId(knex, tenant);
      if (!systemUserId) {
        await markProcessedAttachment(knex, {
          tenant,
          providerId,
          emailId,
          attachmentId,
          status: 'failed',
          errorMessage: 'No system user id available for attachment attribution',
        });
        return { success: false, message: 'No system user id available for attachment attribution' };
      }

      let buffer: Buffer;
      let resolvedMimeType = requestedContentType;
      let resolvedFileName = requestedFileName;

      try {
        if (providedContentBase64) {
          if (!isBase64(providedContentBase64)) {
            throw new Error('Invalid base64 attachment payload');
          }
          buffer = Buffer.from(providedContentBase64.replace(/\s+/g, ''), 'base64');
        } else {
          const downloaded = await downloadAttachmentBuffer({
            knex,
            tenant,
            providerId,
            providerAttachmentId,
            emailId,
            contentType: requestedContentType,
            fileName: requestedFileName,
          });
          buffer = downloaded.buffer;
          resolvedMimeType = String(downloaded.contentType || requestedContentType).toLowerCase();
          resolvedFileName = downloaded.fileName || requestedFileName;
        }
      } catch (downloadErr: any) {
        const message = downloadErr?.message || String(downloadErr);
        const lower = String(message).toLowerCase();

        const isUnsupported =
          lower.includes('unsupported attachment type') ||
          lower.includes('contentbytes missing') ||
          lower.includes('invalid base64');

        await markProcessedAttachment(knex, {
          tenant,
          providerId,
          emailId,
          attachmentId,
          status: isUnsupported ? 'skipped' : 'failed',
          errorMessage: message,
        });

        return isUnsupported
          ? { success: true, skipped: true, reason: 'unsupported_attachment' }
          : { success: false, message };
      }

      if (buffer.length > MAX_ATTACHMENT_BYTES) {
        await markProcessedAttachment(knex, {
          tenant,
          providerId,
          emailId,
          attachmentId,
          status: 'skipped',
          errorMessage: `Attachment exceeds max size (${MAX_ATTACHMENT_BYTES} bytes)`,
        });
        return { success: true, skipped: true, reason: 'too_large_downloaded' };
      }

      if (allowInlineProcessing && !resolvedMimeType.startsWith('image/')) {
        await markProcessedAttachment(knex, {
          tenant,
          providerId,
          emailId,
          attachmentId,
          status: 'skipped',
          errorMessage: 'Embedded extraction only supports image MIME types',
        });
        return { success: true, skipped: true, reason: 'non_image_embedded' };
      }

      const persistResult = await persistDocumentForBuffer({
        knex,
        tenant,
        providerId,
        emailId,
        attachmentId,
        ticketId,
        systemUserId,
        fileName: resolvedFileName,
        mimeType: resolvedMimeType,
        buffer,
      });

      if (!persistResult.success) {
        return { success: false, message: persistResult.message || 'Failed to persist attachment' };
      }

      return {
        success: true,
        documentId: persistResult.documentId,
        fileId: persistResult.fileId,
        fileName: sanitizeGeneratedFileName(resolvedFileName),
        fileSize: buffer.length,
        contentType: resolvedMimeType,
      };
    }
  );

  actionRegistry.registerSimpleAction(
    'process_original_email_attachment',
    'Persist original source email MIME as .eml attachment on the ticket',
    [
      { name: 'emailId', type: 'string', required: true },
      { name: 'ticketId', type: 'string', required: true },
      { name: 'tenant', type: 'string', required: true },
      { name: 'providerId', type: 'string', required: true },
      { name: 'emailData', type: 'object', required: false },
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      const tenant = context.tenant || params.tenant;
      const providerId = params.providerId as string;
      const emailId = params.emailId as string;
      const ticketId = params.ticketId as string;
      const emailData = params.emailData || {};

      const attachmentId = ORIGINAL_EMAIL_ATTACHMENT_ID;
      const fileName = buildOriginalEmailFileName(emailId);
      const contentType = 'message/rfc822';

      const knex = await ensureKnex(context);

      const claim = await claimAttachmentRow(knex, {
        tenant,
        providerId,
        emailId,
        attachmentId,
        fileName,
        contentType,
        fileSize: null,
        contentId: null,
      });

      if (!claim.claimed) {
        return (claim as { claimed: false; result: Record<string, any> }).result;
      }

      if (hasRawMimeOverCapSkipReason(emailData)) {
        await markProcessedAttachment(knex, {
          tenant,
          providerId,
          emailId,
          attachmentId,
          status: 'skipped',
          errorMessage: 'Raw MIME source exceeds ingress cap',
        });
        return { success: true, skipped: true, reason: 'raw_mime_over_max_bytes' };
      }

      const systemUserId = await resolveSystemUserId(knex, tenant);
      if (!systemUserId) {
        await markProcessedAttachment(knex, {
          tenant,
          providerId,
          emailId,
          attachmentId,
          status: 'failed',
          errorMessage: 'No system user id available for attachment attribution',
        });
        return { success: false, message: 'No system user id available for attachment attribution' };
      }

      let buffer: Buffer;
      try {
        buffer = await downloadOriginalMime({
          knex,
          tenant,
          providerId,
          emailId,
          emailData,
        });
      } catch (error: any) {
        const message = error?.message || String(error);
        await markProcessedAttachment(knex, {
          tenant,
          providerId,
          emailId,
          attachmentId,
          status: 'failed',
          errorMessage: message,
        });
        return { success: false, message };
      }

      if (buffer.length > MAX_ATTACHMENT_BYTES) {
        await markProcessedAttachment(knex, {
          tenant,
          providerId,
          emailId,
          attachmentId,
          status: 'skipped',
          errorMessage: `Attachment exceeds max size (${MAX_ATTACHMENT_BYTES} bytes)`,
        });
        return { success: true, skipped: true, reason: 'too_large' };
      }

      const persistResult = await persistDocumentForBuffer({
        knex,
        tenant,
        providerId,
        emailId,
        attachmentId,
        ticketId,
        systemUserId,
        fileName,
        mimeType: contentType,
        buffer,
      });

      if (!persistResult.success) {
        return {
          success: false,
          message: persistResult.message || 'Failed to persist original email attachment',
        };
      }

      return {
        success: true,
        documentId: persistResult.documentId,
        fileId: persistResult.fileId,
        fileName,
        fileSize: buffer.length,
        contentType,
      };
    }
  );
}
