import { z } from 'zod';
import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { getWorkflowEmailProvider } from '../../registries/workflowEmailRegistry';
import { EmailProviderError } from '@alga-psa/types';
import {
  uuidSchema,
  isoDateTimeSchema,
  actionProvidedKey,
  withTenantTransaction,
  requirePermission,
  writeRunAudit,
  throwActionError,
  MAX_ATTACHMENT_BYTES,
  isAllowedAttachmentMimeType
} from './shared';

export function registerEmailActions(): void {
  const registry = getActionRegistryV2();

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

      const { TenantEmailService, StaticTemplateProcessor, EmailProviderManager } = getWorkflowEmailProvider();
      const { StorageProviderFactory } = await import('@alga-psa/documents');

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
}
