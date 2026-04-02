import { v4 as uuidv4 } from 'uuid';
import type {
  EmailMessageDetails,
  EmailProviderConfig,
} from '../../interfaces/inbound-email.interfaces';
import {
  MAX_ATTACHMENT_BYTES,
  ORIGINAL_EMAIL_ATTACHMENT_ID,
  buildDeterministicRfc822Message,
  buildOriginalEmailFileName,
  extractEmbeddedImageAttachments,
  hasRawMimeOverCapSkipReason,
  maybeExtractRawMimeFromEmailData,
  sanitizeGeneratedFileName,
} from './inboundEmailArtifactHelpers';

const STALE_PROCESSING_MS = 30 * 60 * 1000; // 30 minutes

interface PersistAttachmentInput {
  tenantId: string;
  providerId: string;
  emailId: string;
  ticketId: string;
  attachmentId: string;
  attachmentData: {
    id: string;
    name: string;
    contentType: string;
    size: number;
    contentId?: string;
    isInline?: boolean;
    content?: string;
    providerAttachmentId?: string;
    allowInlineProcessing?: boolean;
  };
}

interface PersistOriginalEmailInput {
  tenantId: string;
  providerId: string;
  emailId: string;
  ticketId: string;
  emailData: EmailMessageDetails;
}

export interface ProcessInboundEmailArtifactsInput {
  tenantId: string;
  providerId: string;
  ticketId: string;
  emailData: EmailMessageDetails;
  scopeLabel: 'new-ticket' | 'reply';
  maxAttachmentConcurrency?: number;
}

export interface EmbeddedImageUrlMapping {
  source: 'data-url' | 'cid';
  reference: string;
  fileId: string;
  documentId: string;
  url: string;
}

export interface ProcessInboundEmailArtifactsResult {
  embeddedImageUrlMappings: EmbeddedImageUrlMapping[];
}

function isUniqueViolation(error: any): boolean {
  return error?.code === '23505' || String(error?.message || '').toLowerCase().includes('duplicate');
}

function isBase64(value: string): boolean {
  return /^[A-Za-z0-9+/=\s]+$/.test(value);
}

function normalizeContentId(value: string | undefined | null): string {
  if (!value) return '';
  return String(value).trim().replace(/^cid:/i, '').replace(/^<|>$/g, '').toLowerCase();
}

function resolveAttachmentConcurrency(
  explicitLimit?: number
): number {
  if (Number.isFinite(explicitLimit) && (explicitLimit as number) > 0) {
    return Math.max(1, Math.min(8, Math.floor(explicitLimit as number)));
  }

  const raw =
    process.env.IMAP_INBOUND_EMAIL_IN_APP_ARTIFACT_CONCURRENCY ||
    process.env.INBOUND_EMAIL_IN_APP_ARTIFACT_CONCURRENCY;
  if (!raw) return 1;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return Math.max(1, Math.min(8, Math.floor(parsed)));
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;
  const concurrency = Math.max(1, Math.min(limit, items.length));
  let index = 0;

  const runners = Array.from({ length: concurrency }, async () => {
    while (true) {
      const current = index;
      index += 1;
      if (current >= items.length) {
        break;
      }
      await worker(items[current]);
    }
  });

  await Promise.all(runners);
}

async function getAdminKnex(): Promise<any> {
  const { getAdminConnection } = await import('@alga-psa/db/admin');
  return getAdminConnection();
}

async function loadProviderRow(knex: any, tenant: string, providerId: string): Promise<any | null> {
  return knex('email_providers')
    .where({ tenant, id: providerId })
    .first();
}

async function buildMicrosoftProviderConfig(
  knex: any,
  tenant: string,
  providerRow: any
): Promise<EmailProviderConfig> {
  const config = await knex('microsoft_email_provider_config')
    .where({ tenant, email_provider_id: providerRow.id })
    .first();
  if (!config) {
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
    webhook_subscription_id: config.webhook_subscription_id || undefined,
    webhook_verification_token: config.webhook_verification_token || undefined,
    webhook_expires_at: config.webhook_expires_at || undefined,
    connection_status: (providerRow.status as any) || 'connected',
    created_at:
      providerRow.created_at?.toISOString?.() ?? String(providerRow.created_at ?? new Date().toISOString()),
    updated_at:
      providerRow.updated_at?.toISOString?.() ?? String(providerRow.updated_at ?? new Date().toISOString()),
    provider_config: {
      client_id: config.client_id,
      client_secret: config.client_secret,
      tenant_id: config.tenant_id,
      access_token: config.access_token,
      refresh_token: config.refresh_token,
      token_expires_at: config.token_expires_at,
    },
  } as any;
}

async function buildGoogleProviderConfig(
  knex: any,
  tenant: string,
  providerRow: any
): Promise<EmailProviderConfig> {
  const config = await knex('google_email_provider_config')
    .where({ tenant, email_provider_id: providerRow.id })
    .first();
  if (!config) {
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
    created_at:
      providerRow.created_at?.toISOString?.() ?? String(providerRow.created_at ?? new Date().toISOString()),
    updated_at:
      providerRow.updated_at?.toISOString?.() ?? String(providerRow.updated_at ?? new Date().toISOString()),
    provider_config: {
      project_id: config.project_id,
      pubsub_topic_name: config.pubsub_topic_name,
      pubsub_subscription_name: config.pubsub_subscription_name,
      client_id: config.client_id,
      client_secret: config.client_secret,
      access_token: config.access_token,
      refresh_token: config.refresh_token,
      token_expires_at: config.token_expires_at,
      history_id: config.history_id,
      watch_expiration: config.watch_expiration,
      label_filters: config.label_filters,
      auto_process_emails: config.auto_process_emails,
      max_emails_per_sync: config.max_emails_per_sync,
    },
  } as any;
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

async function claimAttachmentRow(
  knex: any,
  args: {
    tenantId: string;
    providerId: string;
    emailId: string;
    attachmentId: string;
    fileName: string;
    contentType: string;
    fileSize: number | null;
    contentId: string | null;
  }
): Promise<{ claimed: true } | { claimed: false; result: Record<string, any> }> {
  const now = new Date();
  try {
    await knex('email_processed_attachments').insert({
      tenant: args.tenantId,
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
  }

  const existing = await knex('email_processed_attachments')
    .where({
      tenant: args.tenantId,
      provider_id: args.providerId,
      email_id: args.emailId,
      attachment_id: args.attachmentId,
    })
    .first();

  const status = String(existing?.processing_status || '').toLowerCase();
  if (status === 'failed') {
    const updated = await knex('email_processed_attachments')
      .where({
        tenant: args.tenantId,
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
          tenant: args.tenantId,
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

async function markProcessedAttachment(
  knex: any,
  args: {
    tenantId: string;
    providerId: string;
    emailId: string;
    attachmentId: string;
    status: 'skipped' | 'failed';
    errorMessage: string;
  }
): Promise<void> {
  await knex('email_processed_attachments')
    .where({
      tenant: args.tenantId,
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
  tenantId: string;
  providerId: string;
  emailId: string;
  attachmentId: string;
  ticketId: string;
  systemUserId: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<{ success: boolean; message?: string; documentId?: string; fileId?: string }> {
  const storageModule: any = await import('@alga-psa/storage/StorageProviderFactory');
  const StorageProviderFactory = storageModule.StorageProviderFactory;
  const generateStoragePath = storageModule.generateStoragePath;

  const safeFileName = sanitizeGeneratedFileName(args.fileName, 'attachment.bin');
  const storageProvider = await StorageProviderFactory.createProvider();
  const storagePath = generateStoragePath(args.tenantId, '', safeFileName);

  let uploadResult: any;
  try {
    uploadResult = await storageProvider.upload(args.buffer, storagePath, {
      mime_type: args.mimeType,
    });
  } catch (uploadErr: any) {
    await markProcessedAttachment(args.knex, {
      tenantId: args.tenantId,
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
        tenant: args.tenantId,
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
        tenant: args.tenantId,
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
        tenant: args.tenantId,
        association_id: uuidv4(),
        document_id: documentId,
        entity_id: args.ticketId,
        entity_type: 'ticket',
        created_at: now,
      });

      await trx('email_processed_attachments')
        .where({
          tenant: args.tenantId,
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
      tenantId: args.tenantId,
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
  tenantId: string;
  providerId: string;
  providerAttachmentId: string;
  emailId: string;
  contentType: string;
  fileName: string;
}): Promise<{ buffer: Buffer; contentType: string; fileName: string }> {
  const providerRow = await loadProviderRow(args.knex, args.tenantId, args.providerId);
  if (!providerRow) {
    throw new Error('Email provider not found');
  }

  if (providerRow.provider_type === 'microsoft') {
    const { MicrosoftGraphAdapter } = await import(
      '@alga-psa/shared/services/email/providers/MicrosoftGraphAdapter'
    );
    const providerConfig = await buildMicrosoftProviderConfig(args.knex, args.tenantId, providerRow);
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
    const { GmailAdapter } = await import('@alga-psa/shared/services/email/providers/GmailAdapter');
    const providerConfig = await buildGoogleProviderConfig(args.knex, args.tenantId, providerRow);
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
  tenantId: string;
  providerId: string;
  emailId: string;
  emailData: EmailMessageDetails;
}): Promise<Buffer> {
  const rawFromPayload = maybeExtractRawMimeFromEmailData(args.emailData);
  if (rawFromPayload) {
    return rawFromPayload;
  }

  const providerRow = await loadProviderRow(args.knex, args.tenantId, args.providerId);
  if (!providerRow) {
    return buildDeterministicRfc822Message(args.emailData || { id: args.emailId });
  }

  if (providerRow.provider_type === 'microsoft') {
    const { MicrosoftGraphAdapter } = await import(
      '@alga-psa/shared/services/email/providers/MicrosoftGraphAdapter'
    );
    const providerConfig = await buildMicrosoftProviderConfig(args.knex, args.tenantId, providerRow);
    const adapter = new MicrosoftGraphAdapter(providerConfig);
    await adapter.connect();
    return adapter.downloadMessageSource(args.emailId);
  }

  if (providerRow.provider_type === 'google') {
    const { GmailAdapter } = await import('@alga-psa/shared/services/email/providers/GmailAdapter');
    const providerConfig = await buildGoogleProviderConfig(args.knex, args.tenantId, providerRow);
    const adapter = new GmailAdapter(providerConfig);
    await adapter.connect();
    return adapter.downloadMessageSource(args.emailId);
  }

  return buildDeterministicRfc822Message(args.emailData || { id: args.emailId });
}

async function persistInboundEmailAttachment(input: PersistAttachmentInput): Promise<Record<string, any>> {
  const attachment = input.attachmentData;
  const requestedFileName = String(attachment.name || '');
  const requestedContentType = String(attachment.contentType || 'application/octet-stream').toLowerCase();
  const declaredSize: number | null = typeof attachment.size === 'number' ? attachment.size : null;
  const contentId: string | null = attachment.contentId ? String(attachment.contentId) : null;
  const isInline: boolean = Boolean(attachment.isInline);
  const allowInlineProcessing = Boolean(attachment.allowInlineProcessing);
  const providerAttachmentId: string = String(attachment.providerAttachmentId || input.attachmentId);
  const providedContentBase64: string | null =
    typeof attachment.content === 'string' && attachment.content.trim().length > 0
      ? attachment.content.trim()
      : null;

  const knex = await getAdminKnex();
  const claim = await claimAttachmentRow(knex, {
    tenantId: input.tenantId,
    providerId: input.providerId,
    emailId: input.emailId,
    attachmentId: input.attachmentId,
    fileName: requestedFileName,
    contentType: requestedContentType,
    fileSize: declaredSize,
    contentId,
  });
  if (!claim.claimed) {
    return (claim as { claimed: false; result: Record<string, any> }).result;
  }

  if ((contentId || isInline) && !allowInlineProcessing) {
    await markProcessedAttachment(knex, {
      tenantId: input.tenantId,
      providerId: input.providerId,
      emailId: input.emailId,
      attachmentId: input.attachmentId,
      status: 'skipped',
      errorMessage: 'Inline/CID attachments are skipped by default',
    });
    return { success: true, skipped: true, reason: 'inline' };
  }

  if (!requestedFileName) {
    await markProcessedAttachment(knex, {
      tenantId: input.tenantId,
      providerId: input.providerId,
      emailId: input.emailId,
      attachmentId: input.attachmentId,
      status: 'skipped',
      errorMessage: 'Attachment missing filename',
    });
    return { success: true, skipped: true, reason: 'missing_filename' };
  }

  if (declaredSize !== null && declaredSize > MAX_ATTACHMENT_BYTES) {
    await markProcessedAttachment(knex, {
      tenantId: input.tenantId,
      providerId: input.providerId,
      emailId: input.emailId,
      attachmentId: input.attachmentId,
      status: 'skipped',
      errorMessage: `Attachment exceeds max size (${MAX_ATTACHMENT_BYTES} bytes)`,
    });
    return { success: true, skipped: true, reason: 'too_large' };
  }

  if (allowInlineProcessing && !requestedContentType.startsWith('image/')) {
    await markProcessedAttachment(knex, {
      tenantId: input.tenantId,
      providerId: input.providerId,
      emailId: input.emailId,
      attachmentId: input.attachmentId,
      status: 'skipped',
      errorMessage: 'Embedded extraction only supports image MIME types',
    });
    return { success: true, skipped: true, reason: 'non_image_embedded' };
  }

  const systemUserId = await resolveSystemUserId(knex, input.tenantId);
  if (!systemUserId) {
    await markProcessedAttachment(knex, {
      tenantId: input.tenantId,
      providerId: input.providerId,
      emailId: input.emailId,
      attachmentId: input.attachmentId,
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
        tenantId: input.tenantId,
        providerId: input.providerId,
        providerAttachmentId,
        emailId: input.emailId,
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
      lower.includes('invalid base64') ||
      lower.includes('unsupported provider_type');

    await markProcessedAttachment(knex, {
      tenantId: input.tenantId,
      providerId: input.providerId,
      emailId: input.emailId,
      attachmentId: input.attachmentId,
      status: isUnsupported ? 'skipped' : 'failed',
      errorMessage: message,
    });

    return isUnsupported
      ? { success: true, skipped: true, reason: 'unsupported_attachment' }
      : { success: false, message };
  }

  if (buffer.length > MAX_ATTACHMENT_BYTES) {
    await markProcessedAttachment(knex, {
      tenantId: input.tenantId,
      providerId: input.providerId,
      emailId: input.emailId,
      attachmentId: input.attachmentId,
      status: 'skipped',
      errorMessage: `Attachment exceeds max size (${MAX_ATTACHMENT_BYTES} bytes)`,
    });
    return { success: true, skipped: true, reason: 'too_large_downloaded' };
  }

  if (allowInlineProcessing && !resolvedMimeType.startsWith('image/')) {
    await markProcessedAttachment(knex, {
      tenantId: input.tenantId,
      providerId: input.providerId,
      emailId: input.emailId,
      attachmentId: input.attachmentId,
      status: 'skipped',
      errorMessage: 'Embedded extraction only supports image MIME types',
    });
    return { success: true, skipped: true, reason: 'non_image_embedded' };
  }

  const persistResult = await persistDocumentForBuffer({
    knex,
    tenantId: input.tenantId,
    providerId: input.providerId,
    emailId: input.emailId,
    attachmentId: input.attachmentId,
    ticketId: input.ticketId,
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

async function persistInboundOriginalEmail(input: PersistOriginalEmailInput): Promise<Record<string, any>> {
  const attachmentId = ORIGINAL_EMAIL_ATTACHMENT_ID;
  const fileName = buildOriginalEmailFileName(input.emailId);
  const contentType = 'message/rfc822';
  const knex = await getAdminKnex();

  const claim = await claimAttachmentRow(knex, {
    tenantId: input.tenantId,
    providerId: input.providerId,
    emailId: input.emailId,
    attachmentId,
    fileName,
    contentType,
    fileSize: null,
    contentId: null,
  });

  if (!claim.claimed) {
    return (claim as { claimed: false; result: Record<string, any> }).result;
  }

  if (hasRawMimeOverCapSkipReason(input.emailData)) {
    await markProcessedAttachment(knex, {
      tenantId: input.tenantId,
      providerId: input.providerId,
      emailId: input.emailId,
      attachmentId,
      status: 'skipped',
      errorMessage: 'Raw MIME source exceeds ingress cap',
    });
    return { success: true, skipped: true, reason: 'raw_mime_over_max_bytes' };
  }

  const systemUserId = await resolveSystemUserId(knex, input.tenantId);
  if (!systemUserId) {
    await markProcessedAttachment(knex, {
      tenantId: input.tenantId,
      providerId: input.providerId,
      emailId: input.emailId,
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
      tenantId: input.tenantId,
      providerId: input.providerId,
      emailId: input.emailId,
      emailData: input.emailData,
    });
  } catch (error: any) {
    const message = error?.message || String(error);
    await markProcessedAttachment(knex, {
      tenantId: input.tenantId,
      providerId: input.providerId,
      emailId: input.emailId,
      attachmentId,
      status: 'failed',
      errorMessage: message,
    });
    return { success: false, message };
  }

  if (buffer.length > MAX_ATTACHMENT_BYTES) {
    await markProcessedAttachment(knex, {
      tenantId: input.tenantId,
      providerId: input.providerId,
      emailId: input.emailId,
      attachmentId,
      status: 'skipped',
      errorMessage: `Attachment exceeds max size (${MAX_ATTACHMENT_BYTES} bytes)`,
    });
    return { success: true, skipped: true, reason: 'too_large' };
  }

  const persistResult = await persistDocumentForBuffer({
    knex,
    tenantId: input.tenantId,
    providerId: input.providerId,
    emailId: input.emailId,
    attachmentId,
    ticketId: input.ticketId,
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

export async function processInboundEmailArtifactsBestEffort(
  input: ProcessInboundEmailArtifactsInput
): Promise<ProcessInboundEmailArtifactsResult> {
  const result: ProcessInboundEmailArtifactsResult = {
    embeddedImageUrlMappings: [],
  };

  const baseAttachments = Array.isArray(input.emailData.attachments) ? input.emailData.attachments : [];
  const ingressSkipReasons = Array.isArray(input.emailData.ingressSkipReasons)
    ? input.emailData.ingressSkipReasons
    : [];

  if (ingressSkipReasons.length > 0) {
    console.warn(`processInboundEmailInApp:[${input.scopeLabel}] ingress skipped artifacts`, {
      emailId: input.emailData.id,
      reasons: ingressSkipReasons,
    });
  }

  let embeddedAttachments: Array<{
    id: string;
    name: string;
    contentType: string;
    size: number;
    contentId?: string;
    content?: string;
    providerAttachmentId?: string;
    source?: 'data-url' | 'cid';
    allowInlineProcessing?: boolean;
  }> = [];

  if (input.emailData.body?.html) {
    try {
      const extraction = extractEmbeddedImageAttachments({
        emailId: input.emailData.id,
        html: input.emailData.body.html,
        attachments: baseAttachments as any[],
        maxBytes: MAX_ATTACHMENT_BYTES,
      });
      embeddedAttachments = extraction.attachments;

      if (extraction.warnings.length > 0) {
        console.warn(`processInboundEmailInApp:[${input.scopeLabel}] embedded image extraction warnings`, {
          emailId: input.emailData.id,
          warnings: extraction.warnings,
        });
      }
    } catch (error) {
      console.warn(
        `processInboundEmailInApp:[${input.scopeLabel}] embedded image extraction failed (continuing)`,
        {
          emailId: input.emailData.id,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }

  const allAttachments = [...baseAttachments, ...embeddedAttachments];
  const baseAttachmentById = new Map<string, any>();
  for (const attachment of baseAttachments) {
    if (attachment?.id) {
      baseAttachmentById.set(String(attachment.id), attachment);
    }
  }

  const attachmentConcurrency = resolveAttachmentConcurrency(input.maxAttachmentConcurrency);
  await runWithConcurrency(allAttachments, attachmentConcurrency, async (attachment) => {
    try {
      const persistResult = await persistInboundEmailAttachment({
        tenantId: input.tenantId,
        providerId: input.providerId,
        emailId: input.emailData.id,
        ticketId: input.ticketId,
        attachmentId: String(attachment.id),
        attachmentData: {
          id: String(attachment.id),
          name: String(attachment.name),
          contentType: String(attachment.contentType || 'application/octet-stream'),
          size: Number(attachment.size || 0),
          contentId: (attachment as any).contentId ? String((attachment as any).contentId) : undefined,
          isInline:
            typeof (attachment as any).isInline === 'boolean'
              ? (attachment as any).isInline
              : undefined,
          content: typeof (attachment as any).content === 'string' ? (attachment as any).content : undefined,
          providerAttachmentId:
            typeof (attachment as any).providerAttachmentId === 'string'
              ? (attachment as any).providerAttachmentId
              : undefined,
          allowInlineProcessing: (attachment as any).allowInlineProcessing ? true : undefined,
        },
      });

      const isEmbedded = Boolean((attachment as any).allowInlineProcessing);
      const source = (attachment as any).source as 'data-url' | 'cid' | undefined;
      const fileId =
        typeof persistResult?.fileId === 'string' && persistResult.fileId.trim().length > 0
          ? persistResult.fileId
          : '';
      const documentId =
        typeof persistResult?.documentId === 'string' && persistResult.documentId.trim().length > 0
          ? persistResult.documentId
          : '';
      if (!isEmbedded || !source || !fileId || !documentId) {
        return;
      }

      let reference = '';
      if (source === 'data-url') {
        const contentType = String((attachment as any).contentType || '').toLowerCase();
        const base64 = typeof (attachment as any).content === 'string' ? (attachment as any).content : '';
        if (contentType.startsWith('image/') && base64.trim().length > 0) {
          reference = `data:${contentType};base64,${base64.replace(/\s+/g, '')}`;
        }
      } else if (source === 'cid') {
        const directContentId = normalizeContentId((attachment as any).contentId);
        const providerAttachmentId = String((attachment as any).providerAttachmentId || '');
        const providerContentId = normalizeContentId(baseAttachmentById.get(providerAttachmentId)?.contentId);
        reference = directContentId || providerContentId;
      }

      if (!reference) {
        return;
      }

      result.embeddedImageUrlMappings.push({
        source,
        reference,
        fileId,
        documentId,
        url: `/api/documents/view/${fileId}`,
      });
    } catch (error) {
      console.warn(`processInboundEmailInApp:[${input.scopeLabel}] attachment processing failed (continuing)`, {
        emailId: input.emailData.id,
        attachmentId: attachment?.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  try {
    const originalResult = await persistInboundOriginalEmail({
      tenantId: input.tenantId,
      providerId: input.providerId,
      emailId: input.emailData.id,
      ticketId: input.ticketId,
      emailData: input.emailData,
    });
    if (!originalResult?.success) {
      console.warn(`processInboundEmailInApp:[${input.scopeLabel}] original-email persistence failed`, {
        emailId: input.emailData.id,
        reason: originalResult?.message || originalResult?.reason || 'unknown',
      });
    }
  } catch (error) {
    console.warn(
      `processInboundEmailInApp:[${input.scopeLabel}] original-email persistence errored (continuing)`,
      {
        emailId: input.emailData.id,
        error: error instanceof Error ? error.message : String(error),
      }
    );
  }

  return result;
}
