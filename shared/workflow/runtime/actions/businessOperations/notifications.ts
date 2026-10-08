import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import type { ActionContext } from '../../registries/actionRegistry';
import { getActionRegistryV2 } from '../../registries/actionRegistry';
import {
  uuidSchema,
  actionProvidedKey,
  withTenantTransaction,
  requirePermission,
  writeRunAudit,
  throwActionError
} from './shared';
import { withWorkflowJsonSchemaMetadata, withWorkflowPicker } from '../../jsonSchemaMetadata';
import { workflowUserRecipientsSchema, resolveWorkflowUserRecipients } from './userRecipients';

const UUID_ONLY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DANGLING_PREPOSITION = /\s+(?:from|for|by)\s*[:\-–]?\s*$/i;
export const FALLBACK_IN_APP_TITLE = 'Workflow notification';

/**
 * Last-resort guard for titles authored in a workflow. The real fix is that the
 * event payloads carry names; this only keeps a title that interpolated an
 * empty value ("New ticket from ") or an id from reaching the notification bell.
 */
export function sanitizeInAppNotificationTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed || UUID_ONLY.test(trimmed)) return FALLBACK_IN_APP_TITLE;
  const withoutDangling = trimmed.replace(DANGLING_PREPOSITION, '').trim();
  return withoutDangling || FALLBACK_IN_APP_TITLE;
}

export function registerNotificationActions(): void {
  const registry = getActionRegistryV2();

  // ---------------------------------------------------------------------------
  // A14 — notifications.send_in_app
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'notifications.send_in_app',
    version: 1,
    inputSchema: z.object({
      // The designer edits recipients with one "Notify users / roles" editor instead of nested fields.
      recipients: withWorkflowJsonSchemaMetadata(
        workflowUserRecipientsSchema.extend({
          user_ids: withWorkflowPicker(z.array(uuidSchema).optional(), 'Users to notify', 'user'),
          role_ids: withWorkflowPicker(z.array(uuidSchema).optional(), 'Roles to notify (every user with one of these roles)', 'role'),
        }),
        'Recipients',
        { 'x-workflow-editor': { kind: 'custom', custom: { component: 'notification-recipients' } } }
      ),
      title: z.string().min(1).describe('Title'),
      body: z.string().min(1).describe('Body'),
      severity: z.enum(['info', 'success', 'warning', 'error']).default('info'),
      link: z.string().optional().describe('Opening the notification takes the user here, e.g. /msp/tickets/<ticket id>. Leave empty for a notification without a link.'),
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
      const db = tenantDb(tx.trx, tx.tenantId);
      // In-app notifications go to every resolved user, including inactive and client users.
      const users = await resolveWorkflowUserRecipients(tx, ctx, {
        user_ids: input.recipients?.user_ids,
        role_ids: input.recipients?.role_ids,
        role_names: input.recipients?.role_names,
      });
      const userIds = users.map((user) => user.user_id);
      if (!userIds.length) {
        throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: 'At least one recipient user_id is required' });
      }

      const nowIso = new Date().toISOString();
      const ids: string[] = [];
      for (const userId of userIds) {
        const notificationId = uuidv4();
        ids.push(notificationId);
        await db.table('internal_notifications').insert({
          internal_notification_id: notificationId,
          tenant: tx.tenantId,
          user_id: userId,
          template_name: 'workflow-custom',
          language_code: 'en',
          title: sanitizeInAppNotificationTitle(input.title),
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
}
