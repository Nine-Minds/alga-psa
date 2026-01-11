import { v4 as uuidv4 } from 'uuid';
import type { ActionRegistry, ActionExecutionContext } from '@shared/workflow/core/actionRegistry';
import type { EmailProviderConfig } from '@alga-psa/shared/interfaces/inbound-email.interfaces';

const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

function isUniqueViolation(error: any): boolean {
  return error?.code === '23505' || String(error?.message || '').toLowerCase().includes('duplicate');
}

async function resolveSystemUserId(knex: any, tenant: string): Promise<string | null> {
  // Prefer inbound_ticket_defaults.entered_by (configured “system” actor for inbound email workflows)
  const inboundDefaults = await knex('inbound_ticket_defaults')
    .select('entered_by')
    .where({ tenant, is_active: true })
    .whereNotNull('entered_by')
    .orderBy('updated_at', 'desc')
    .first();
  if (inboundDefaults?.entered_by) return inboundDefaults.entered_by;

  // Fallback: pick any user in tenant (last resort; better than failing hard)
  const user = await knex('users')
    .select('user_id')
    .where({ tenant })
    .orderBy('created_at', 'asc')
    .first();
  return user?.user_id || null;
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

export function registerEmailAttachmentActions(actionRegistry: ActionRegistry): void {
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

      const fileName: string = String(attachment.name || '');
      const contentType: string = String(attachment.contentType || 'application/octet-stream');
      const declaredSize: number | null = typeof attachment.size === 'number' ? attachment.size : null;
      const contentId: string | null = attachment.contentId ? String(attachment.contentId) : null;
      const isInline: boolean = Boolean(attachment.isInline);

      const { getAdminConnection } = await import('@alga-psa/shared/db/admin');
      const knex = (context.knex as any) || (await getAdminConnection());

      // Claim attachment (strict idempotency)
      try {
        await knex('email_processed_attachments').insert({
          tenant,
          provider_id: providerId,
          email_id: emailId,
          attachment_id: attachmentId,
          processing_status: 'processing',
          file_name: fileName || null,
          content_type: contentType || null,
          file_size: declaredSize,
          content_id: contentId,
          created_at: new Date(),
          updated_at: new Date(),
        });
      } catch (e: any) {
        if (!isUniqueViolation(e)) throw e;

        const existing = await knex('email_processed_attachments')
          .where({
            tenant,
            provider_id: providerId,
            email_id: emailId,
            attachment_id: attachmentId,
          })
          .first();

        return {
          success: true,
          duplicate: true,
          processing_status: existing?.processing_status,
          documentId: existing?.document_id ?? null,
          fileId: existing?.file_id ?? null,
        };
      }

      // Policy: skip inline/CID attachments
      if (contentId || isInline) {
        await knex('email_processed_attachments')
          .where({ tenant, provider_id: providerId, email_id: emailId, attachment_id: attachmentId })
          .update({
            processing_status: 'skipped',
            error_message: 'Inline/CID attachments are skipped by default',
            updated_at: new Date(),
          });
        return { success: true, skipped: true, reason: 'inline' };
      }

      // Policy: require a filename
      if (!fileName) {
        await knex('email_processed_attachments')
          .where({ tenant, provider_id: providerId, email_id: emailId, attachment_id: attachmentId })
          .update({
            processing_status: 'skipped',
            error_message: 'Attachment missing filename',
            updated_at: new Date(),
          });
        return { success: true, skipped: true, reason: 'missing_filename' };
      }

      // Policy: 100MB max
      if (declaredSize !== null && declaredSize > MAX_ATTACHMENT_BYTES) {
        await knex('email_processed_attachments')
          .where({ tenant, provider_id: providerId, email_id: emailId, attachment_id: attachmentId })
          .update({
            processing_status: 'skipped',
            error_message: `Attachment exceeds max size (${MAX_ATTACHMENT_BYTES} bytes)`,
            updated_at: new Date(),
          });
        return { success: true, skipped: true, reason: 'too_large' };
      }

      const providerRow = await loadProviderRow(knex, tenant, providerId);
      if (!providerRow) {
        await knex('email_processed_attachments')
          .where({ tenant, provider_id: providerId, email_id: emailId, attachment_id: attachmentId })
          .update({
            processing_status: 'failed',
            error_message: 'Email provider not found',
            updated_at: new Date(),
          });
        return { success: false, message: 'Email provider not found' };
      }

      const systemUserId = await resolveSystemUserId(knex, tenant);
      if (!systemUserId) {
        await knex('email_processed_attachments')
          .where({ tenant, provider_id: providerId, email_id: emailId, attachment_id: attachmentId })
          .update({
            processing_status: 'failed',
            error_message: 'No system user id available for attachment attribution',
            updated_at: new Date(),
          });
        return { success: false, message: 'No system user id available for attachment attribution' };
      }

      let buffer: Buffer;
      let resolvedMimeType = contentType;
      let resolvedFileName = fileName;

      try {
        if (providerRow.provider_type === 'microsoft') {
          const { MicrosoftGraphAdapter } = await import(
            '@alga-psa/shared/services/email/providers/MicrosoftGraphAdapter'
          );
          const providerConfig = await buildMicrosoftProviderConfig(knex, tenant, providerRow);
          const adapter = new MicrosoftGraphAdapter(providerConfig);
          await adapter.connect();
          const downloaded = await adapter.downloadAttachmentBytes(emailId, attachmentId);
          buffer = downloaded.buffer;
          resolvedMimeType = downloaded.contentType || resolvedMimeType;
          resolvedFileName = downloaded.fileName || resolvedFileName;
        } else if (providerRow.provider_type === 'google') {
          const { GmailAdapter } = await import('@/services/email/providers/GmailAdapter');
          const providerConfig = await buildGoogleProviderConfig(knex, tenant, providerRow);
          const adapter = new GmailAdapter(providerConfig);
          await adapter.connect();
          buffer = await adapter.downloadAttachmentBytes(emailId, attachmentId);
        } else {
          throw new Error(`Unsupported provider_type: ${providerRow.provider_type}`);
        }
      } catch (downloadErr: any) {
        await knex('email_processed_attachments')
          .where({ tenant, provider_id: providerId, email_id: emailId, attachment_id: attachmentId })
          .update({
            processing_status: 'failed',
            error_message: downloadErr?.message || String(downloadErr),
            updated_at: new Date(),
          });
        return { success: false, message: downloadErr?.message || String(downloadErr) };
      }

      if (buffer.length > MAX_ATTACHMENT_BYTES) {
        await knex('email_processed_attachments')
          .where({ tenant, provider_id: providerId, email_id: emailId, attachment_id: attachmentId })
          .update({
            processing_status: 'skipped',
            error_message: `Attachment exceeds max size (${MAX_ATTACHMENT_BYTES} bytes)`,
            updated_at: new Date(),
          });
        return { success: true, skipped: true, reason: 'too_large_downloaded' };
      }

      const { StorageProviderFactory, generateStoragePath } = await import(
        '@/lib/storage/StorageProviderFactory'
      );
      const storageProvider = await StorageProviderFactory.createProvider();
      const storagePath = generateStoragePath(tenant, '', resolvedFileName);

      let uploadResult: any;
      try {
        uploadResult = await storageProvider.upload(buffer, storagePath, {
          mime_type: resolvedMimeType,
        });
      } catch (uploadErr: any) {
        await knex('email_processed_attachments')
          .where({ tenant, provider_id: providerId, email_id: emailId, attachment_id: attachmentId })
          .update({
            processing_status: 'failed',
            error_message: uploadErr?.message || String(uploadErr),
            updated_at: new Date(),
          });
        return { success: false, message: uploadErr?.message || String(uploadErr) };
      }

      const now = new Date();
      const fileId = uuidv4();
      const documentId = uuidv4();

      try {
        await knex.transaction(async (trx: any) => {
          await trx('external_files').insert({
            tenant,
            file_id: fileId,
            file_name: String(storagePath).split('/').pop(),
            original_name: resolvedFileName,
            mime_type: resolvedMimeType,
            file_size: buffer.length,
            storage_path: uploadResult.path,
            uploaded_by_id: systemUserId,
            created_at: now,
            updated_at: now,
          });

          await trx('documents').insert({
            tenant,
            document_id: documentId,
            document_name: resolvedFileName,
            type_id: null,
            shared_type_id: null,
            user_id: systemUserId,
            created_by: systemUserId,
            entered_at: now,
            updated_at: now,
            file_id: fileId,
            storage_path: uploadResult.path,
            mime_type: resolvedMimeType,
            file_size: buffer.length,
          });

          await trx('document_associations').insert({
            tenant,
            association_id: uuidv4(),
            document_id: documentId,
            entity_id: ticketId,
            entity_type: 'ticket',
            created_at: now,
          });

          await trx('email_processed_attachments')
            .where({ tenant, provider_id: providerId, email_id: emailId, attachment_id: attachmentId })
            .update({
              processing_status: 'success',
              file_id: fileId,
              document_id: documentId,
              file_name: resolvedFileName,
              content_type: resolvedMimeType,
              file_size: buffer.length,
              updated_at: now,
            });
        });
      } catch (dbErr: any) {
        await knex('email_processed_attachments')
          .where({ tenant, provider_id: providerId, email_id: emailId, attachment_id: attachmentId })
          .update({
            processing_status: 'failed',
            error_message: dbErr?.message || String(dbErr),
            updated_at: new Date(),
          });
        return { success: false, message: dbErr?.message || String(dbErr) };
      }

      return {
        success: true,
        documentId,
        fileId,
        fileName: resolvedFileName,
        fileSize: buffer.length,
        contentType: resolvedMimeType,
      };
    }
  );
}
