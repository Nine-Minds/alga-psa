import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
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

export function registerNotificationActions(): void {
  const registry = getActionRegistryV2();

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
}
