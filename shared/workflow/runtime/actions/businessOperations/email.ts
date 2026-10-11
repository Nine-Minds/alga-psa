import { z } from 'zod';
import { tenantDb } from '@alga-psa/db';
import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { getWorkflowEmailProvider } from '../../registries/workflowEmailRegistry';
import {
  withWorkflowJsonSchemaMetadata,
  withWorkflowPicker,
  withWorkflowRequireOneOf,
  type WorkflowJsonSchemaMetadata
} from '../../jsonSchemaMetadata';
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
import {
  workflowUserRecipientsSchema,
  resolveWorkflowUserRecipients,
  selectEmailableUsers,
  mergeEmailRecipients,
  type EmailRecipient,
  type EmailSkipReason
} from './userRecipients';

export function resolveDeprecatedWorkflowFrom(input: {
  from?: { email?: string };
  senderId?: string;
  senders: Array<{ sender_id: string; email_address: string }>;
  effectiveDefaultEmail: string;
}): string | undefined {
  if (!input.from) return input.senderId;
  if (!input.from.email) throw new Error('The saved From address is missing an email address. Choose a sender identity.');
  const address = input.from.email.trim().toLowerCase();
  if (input.senderId) {
    const selected = input.senders.find((sender) => sender.sender_id === input.senderId);
    if (!selected || selected.email_address.toLowerCase() !== address) {
      throw new Error('The saved From address conflicts with the selected sender identity. Choose a matching sender identity.');
    }
    return input.senderId;
  }
  const matchingSender = input.senders.find((sender) => sender.email_address.toLowerCase() === address);
  if (matchingSender) return matchingSender.sender_id;
  if (input.effectiveDefaultEmail.toLowerCase() === address) return undefined;
  throw new Error('The saved From address is not a configured sender or the effective default. Choose a sender identity.');
}

const emailRecipientListSchema = z.array(z.object({ email: z.string().email(), name: z.string().optional() }));

// The designer edits recipient lists as one list of addresses rather than rows of email/name fields.
const withEmailRecipientsEditor = <T extends z.ZodTypeAny>(schema: T, description: string): T =>
  withWorkflowJsonSchemaMetadata(schema, description, {
    'x-workflow-editor': { kind: 'custom', custom: { component: 'email-recipients' } },
  });

// Email bodies are paragraphs, so they get a multi-line editor.
const emailBodyEditorMetadata: WorkflowJsonSchemaMetadata = {
  'x-workflow-editor': {
    kind: 'text',
    inline: { mode: 'textarea' },
    dialog: { mode: 'large-text' },
  },
};

export function registerEmailActions(): void {
  const registry = getActionRegistryV2();

  // ---------------------------------------------------------------------------
  // A13 — email.send
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'email.send',
    version: 1,
    inputSchema: withWorkflowRequireOneOf(
      z.object({
        to: withEmailRecipientsEditor(emailRecipientListSchema.optional(), 'Email addresses'),
        users: withWorkflowJsonSchemaMetadata(workflowUserRecipientsSchema.optional(), 'Users and roles to email', {
          'x-workflow-editor': { kind: 'custom', custom: { component: 'email-user-recipients' } },
        }),
        ticket_id: withWorkflowPicker(uuidSchema.optional(), "Email this ticket's technicians", 'ticket'),
        ticket_assignees: withWorkflowJsonSchemaMetadata(
          z.enum(['assigned', 'assigned_and_additional']).default('assigned_and_additional'),
          'Which of the ticket\'s technicians to email (used when a ticket is chosen)',
          {
            'x-workflow-option-labels': {
              assigned: 'Assigned technician only',
              assigned_and_additional: 'Assigned technician and additional resources',
            },
          }
        ),
        users_as: withWorkflowJsonSchemaMetadata(
          z.enum(['to', 'cc', 'bcc']).default('to'),
          'Send users and ticket technicians as',
          { 'x-workflow-option-labels': { to: 'To', cc: 'Cc', bcc: 'Bcc' } }
        ),
        cc: withEmailRecipientsEditor(emailRecipientListSchema.optional(), 'Cc recipients'),
        bcc: withEmailRecipientsEditor(emailRecipientListSchema.optional(), 'Bcc recipients'),
        from: z.object({ email: z.string().email(), name: z.string().optional() }).optional().describe('Optional from override'),
        sender_id: withWorkflowPicker(uuidSchema.optional(), 'Configured outbound sender identity', 'email-sender'),
        mail_class: z.enum(['ticket', 'project', 'billing', 'sales', 'scheduling', 'survey', 'account', 'general']).optional().default('general'),
        subject: z.string().min(1).describe('Subject. Insert workflow fields directly; any other {{name}} is filled from template_data'),
        html: withWorkflowJsonSchemaMetadata(
          z.string().optional(),
          'HTML body. Insert workflow fields directly; any other {{name}} is filled from template_data',
          emailBodyEditorMetadata
        ),
        text: withWorkflowJsonSchemaMetadata(
          z.string().optional(),
          'Plain-text body. Insert workflow fields directly; any other {{name}} is filled from template_data',
          emailBodyEditorMetadata
        ),
        template_data: z.record(z.unknown()).optional().describe('Values for {{name}} placeholders in the subject and body (only needed for names that are not workflow fields)'),
        attachment_file_ids: z.array(uuidSchema).optional().describe('Attachment file ids (external_files.file_id)'),
        provider_id: z.string().optional().describe('Optional provider override (providerId from tenant email settings)'),
        on_no_recipients: withWorkflowJsonSchemaMetadata(
          z.enum(['error', 'skip']).default('error'),
          'What to do when there is no one to email (for example an unassigned ticket)',
          {
            'x-workflow-option-labels': {
              error: 'Fail the step (a surrounding Try/Catch handles it)',
              skip: 'Continue without sending',
            },
            'x-workflow-failure-policy': { failValue: 'error' },
          }
        ),
        idempotency_key: z.string().optional().describe('Optional external idempotency key')
      }).superRefine((val, refineCtx) => {
        const users = val.users;
        const hasUsers = Boolean(users && (users.user_ids?.length || users.role_ids?.length || users.role_names?.length));
        if (!(val.to?.length) && !hasUsers && !val.ticket_id) {
          refineCtx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['to'],
            message: 'to, users, or ticket_id required'
          });
        }
      }),
      ['to', 'users', 'ticket_id']
    ),
    outputSchema: z.object({
      success: z.boolean(),
      message_id: z.string().nullable(),
      provider_id: z.string().nullable(),
      provider_type: z.string().nullable(),
      status: z.enum(['sent', 'skipped']).describe('Delivery status ("skipped" when there was no one to email and on_no_recipients is "skip")'),
      sent_at: isoDateTimeSchema.nullable(),
      internal_recipients: z.array(z.object({ user_id: uuidSchema, email: z.string() })).describe('Users and ticket technicians the email was addressed to'),
      skipped_users: z.array(z.object({
        user_id: uuidSchema,
        reason: z.enum(['inactive', 'not_internal', 'no_email'])
      })).describe('Users left out, with the reason')
    }),
    sideEffectful: true,
    retryHint: { maxAttempts: 3, backoffMs: 1000, retryOn: ['TransientError'] },
    idempotency: { mode: 'actionProvided', key: actionProvidedKey },
    ui: { label: 'Send Email', category: 'Business Operations', description: "Send an email to addresses, users, roles, or a ticket's assigned technicians" },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      // Use the existing email permission taxonomy (email:process).
      await requirePermission(ctx, tx, { resource: 'email', action: 'process' });
      // Reading a ticket's technicians needs the same permission as tickets.find.
      if (input.ticket_id) {
        await requirePermission(ctx, tx, { resource: 'ticket', action: 'read' });
      }

      const { TenantEmailService, StaticTemplateProcessor, EmailProviderManager } = getWorkflowEmailProvider();

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
      await manager.initialize({ ...settings, providerConfigs });
      const providers = await manager.getAvailableProviders(tx.tenantId);
      const provider = providers[0] ?? null;
      if (!provider) {
        throwActionError(ctx, { category: 'ActionError', code: 'VALIDATION_ERROR', message: 'No enabled email provider configured' });
      }

      // Resolve internal recipients and apply the cap before any templating or attachment download.
      const hasUsers = Boolean(
        input.users && (input.users.user_ids?.length || input.users.role_ids?.length || input.users.role_names?.length)
      );
      let internalRecipients: Array<{ user_id: string; email: string; name: string }> = [];
      let skippedUsers: Array<{ user_id: string; reason: EmailSkipReason }> = [];
      if (hasUsers || input.ticket_id) {
        const resolvedUsers = await resolveWorkflowUserRecipients(tx, ctx, {
          user_ids: input.users?.user_ids,
          role_ids: input.users?.role_ids,
          role_names: input.users?.role_names,
          ticket: input.ticket_id
            ? { ticket_id: input.ticket_id, assignees: input.ticket_assignees ?? 'assigned_and_additional' }
            : undefined,
        });
        ({ recipients: internalRecipients, skipped: skippedUsers } = selectEmailableUsers(resolvedUsers));
      }
      const merged = mergeEmailRecipients(
        {
          to: input.to as EmailRecipient[] | undefined,
          cc: input.cc as EmailRecipient[] | undefined,
          bcc: input.bcc as EmailRecipient[] | undefined
        },
        internalRecipients,
        input.users_as ?? 'to'
      );

      const maxRecipients = provider.capabilities.maxRecipientsPerMessage ?? 100;
      if (merged.total > maxRecipients) {
        throwActionError(ctx, {
          category: 'ValidationError',
          code: 'VALIDATION_ERROR',
          message: 'Too many recipients for email provider',
          details: { count: merged.total, max: maxRecipients }
        });
      }

      const internalRecipientsOutput = internalRecipients.map(({ user_id, email }) => ({ user_id, email }));
      if (merged.total === 0) {
        if ((input.on_no_recipients ?? 'error') === 'skip') {
          await writeRunAudit(ctx, tx, {
            operation: 'workflow_action:email.send',
            changedData: { to_count: 0, cc_count: 0, bcc_count: 0, internal_user_count: 0, skipped_user_count: skippedUsers.length },
            details: { action_id: 'email.send', action_version: 1, message_id: null, skipped: true }
          });
          return {
            success: true,
            message_id: null,
            provider_id: null,
            provider_type: null,
            status: 'skipped' as const,
            sent_at: null,
            internal_recipients: [],
            skipped_users: skippedUsers
          };
        }
        const emptySources = [
          input.to !== undefined && 'addresses',
          hasUsers && 'users and roles',
          input.ticket_id && 'ticket technicians'
        ].filter(Boolean).join(', ');
        throwActionError(ctx, {
          category: 'ActionError',
          code: 'NO_RECIPIENTS',
          message: `No one to email: ${emptySources || 'no recipient source'} resolved to no deliverable recipients`,
          details: { skipped_users: skippedUsers }
        });
      }

      // Build content via static templating.
      const templateProcessor = new StaticTemplateProcessor(input.subject, input.html ?? '', input.text);
      const content = await templateProcessor.process({ templateData: input.template_data ?? {} });

      // `from` remains for saved workflows for one release. Accept it only if
      // it matches a configured sender; delivery still uses the central resolver.
      let senderId = input.sender_id;
      if (input.from) {
        const effectiveDefault = await TenantEmailService.resolveOutboundSenderForTenant({ tenantId: tx.tenantId, mailClass: input.mail_class ?? 'general' }, settings, tx.trx);
        try {
          senderId = resolveDeprecatedWorkflowFrom({
            from: input.from,
            senderId,
            senders: Array.isArray(settings.outboundSenders) ? settings.outboundSenders : [],
            effectiveDefaultEmail: effectiveDefault.from.email,
          });
        } catch (error) {
          throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: error instanceof Error ? error.message : String(error) });
        }
      }

      // Attachments via storage file refs.
      const attachmentFileIds = Array.isArray(input.attachment_file_ids) ? input.attachment_file_ids : [];
      const attachments: Array<{ filename: string; content: Buffer; contentType?: string }> = [];
      if (attachmentFileIds.length) {
        const { StorageProviderFactory } = await import('@alga-psa/storage/StorageProviderFactory');
        if (!provider.capabilities.supportsAttachments) {
          throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: 'Email provider does not support attachments' });
        }
        const maxPerAttachment = provider.capabilities.maxAttachmentSize ?? MAX_ATTACHMENT_BYTES;
        const storage = await StorageProviderFactory.createProvider();
        const db = tenantDb(tx.trx, tx.tenantId);
        for (const fileId of attachmentFileIds) {
          const file = await db.table('external_files').where({ file_id: fileId, is_deleted: false }).first();
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

      try {
        const result = await TenantEmailService.getInstance(tx.tenantId).sendEmail({
            mailClass: input.mail_class,
            senderId,
            to: merged.to,
            cc: merged.cc,
            bcc: merged.bcc,
            subject: content.subject,
            html: content.html,
            text: content.text,
            attachments: attachments.length ? attachments : undefined
          });

        if (!result.success) {
          throwActionError(ctx, { category: 'TransientError', code: 'TRANSIENT_FAILURE', message: result.error ?? 'Email send failed' });
        }

        await writeRunAudit(ctx, tx, {
          operation: 'workflow_action:email.send',
          changedData: {
            to_count: merged.to.length,
            cc_count: merged.cc.length,
            bcc_count: merged.bcc.length,
            internal_user_count: internalRecipients.length,
            skipped_user_count: skippedUsers.length
          },
          details: { action_id: 'email.send', action_version: 1, message_id: result.messageId ?? null }
        });

        return {
          success: true,
          message_id: result.messageId ?? null,
          provider_id: result.providerId ?? null,
          provider_type: result.providerType ?? null,
          status: 'sent' as const,
          sent_at: result.sentAt ? new Date(result.sentAt).toISOString() : null,
          internal_recipients: internalRecipientsOutput,
          skipped_users: skippedUsers
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
