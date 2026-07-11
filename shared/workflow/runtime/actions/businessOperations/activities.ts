import { z } from 'zod';
import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { withWorkflowJsonSchemaMetadata } from '../../jsonSchemaMetadata';
import { withTenantTransaction, requirePermission, throwActionError, uuidSchema, type TenantTxContext } from './shared';
import type { ActionContext } from '../../registries/actionRegistry';

interface ActivityGroup {
  groupId: string;
  groupName: string;
  sortOrder: number;
  isCollapsed: boolean;
  items: Array<{ activityId: string; activityType: string }>;
}

// LEVERAGE: pattern workflow-picker-metadata — same helper is private to tickets.ts
const withWorkflowPicker = <T extends z.ZodTypeAny>(schema: T, description: string, kind: 'user'): T =>
  withWorkflowJsonSchemaMetadata(schema, description, {
    'x-workflow-picker-kind': kind,
    'x-workflow-picker-dependencies': undefined,
    'x-workflow-picker-fixed-value-hint': 'Search users',
    'x-workflow-picker-allow-dynamic-reference': true,
  });

const groupSelectorFields = {
  groupId: uuidSchema.optional().describe('Activity group id'),
  groupName: z.string().min(1).optional().describe('Activity group name (case-insensitive)'),
  ownerUserId: withWorkflowPicker(
    uuidSchema.optional(),
    'Group owner user id (defaults to the workflow actor)',
    'user'
  ),
};

const groupLookupInputSchema = z.object(groupSelectorFields).superRefine((value, ctx) => {
  if (!value.groupId && !value.groupName) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['groupId'], message: 'groupId or groupName is required' });
  }
});

const activityTargetSchema = z.object({
  activityId: uuidSchema.describe('Activity id (e.g. a ticket id)'),
  activityType: z
    .string()
    .min(1)
    .describe('Activity type as used by the activities feature, e.g. "ticket", "project_task", "ad_hoc"'),
  ...groupSelectorFields,
}).superRefine((value, ctx) => {
  if (!value.groupId && !value.groupName) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['groupId'], message: 'groupId or groupName is required' });
  }
});

const removeFromGroupInputSchema = z.object({
  activityId: uuidSchema.describe('Activity id (e.g. a ticket id)'),
  activityType: z.string().min(1).describe('Activity type, e.g. "ticket"'),
  ownerUserId: withWorkflowPicker(
    uuidSchema.optional(),
    'Group owner user id (defaults to the workflow actor)',
    'user'
  ),
});

const groupSummarySchema = z.object({
  groupId: z.string(),
  groupName: z.string(),
  sortOrder: z.number(),
  isCollapsed: z.boolean(),
  itemCount: z.number(),
});

const findGroup = (groups: ActivityGroup[], input: { groupId?: string; groupName?: string }): ActivityGroup | null => {
  if (input.groupId) {
    return groups.find((group) => group.groupId === input.groupId) ?? null;
  }
  const wanted = input.groupName?.trim().toLowerCase();
  if (!wanted) return null;
  return groups.find((group) => group.groupName.trim().toLowerCase() === wanted) ?? null;
};

const resolveGroupOrThrow = async (
  ctx: ActionContext,
  tx: TenantTxContext,
  input: { groupId?: string; groupName?: string; ownerUserId?: string }
): Promise<{ group: ActivityGroup; ownerUserId: string }> => {
  const ownerUserId = input.ownerUserId ?? tx.actorUserId;
  if (ownerUserId !== tx.actorUserId) {
    await requirePermission(ctx, tx, { resource: 'user_schedule', action: 'update' });
    const owner = await tx.trx('users')
      .where({ tenant: tx.tenantId, user_id: ownerUserId, user_type: 'internal' })
      .first();
    if (!owner) {
      throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Activity group owner not found' });
    }
  }
  const groupRows = await tx.trx('user_activity_groups')
    .where({ tenant: tx.tenantId, user_id: ownerUserId })
    .orderBy('sort_order');
  const groupIds = groupRows.map((group) => group.group_id);
  const itemRows = groupIds.length === 0
    ? []
    : await tx.trx('user_activity_group_items')
      .where({ tenant: tx.tenantId })
      .whereIn('group_id', groupIds)
      .orderBy('sort_order');
  const groups: ActivityGroup[] = groupRows.map((group) => ({
    groupId: group.group_id,
    groupName: group.group_name,
    sortOrder: group.sort_order,
    isCollapsed: group.is_collapsed,
    items: itemRows
      .filter((item) => item.group_id === group.group_id)
      .map((item) => ({ activityId: item.activity_id, activityType: item.activity_type })),
  }));
  const group = findGroup(groups, input);
  if (!group) {
    const known = groups.map((entry) => entry.groupName).join(', ');
    throwActionError(ctx, {
      category: 'ActionError',
      code: 'NOT_FOUND',
      message: input.groupId
        ? `Activity group ${input.groupId} not found`
        : `Activity group "${input.groupName}" not found${known ? `. Known groups: ${known}` : ''}`,
    });
  }
  return { group, ownerUserId };
};

const removeExistingMembership = async (
  tx: TenantTxContext,
  ownerUserId: string,
  activityId: string,
  activityType: string
): Promise<void> => {
  const groupIds = await tx.trx('user_activity_groups')
    .where({ tenant: tx.tenantId, user_id: ownerUserId })
    .pluck('group_id');
  if (groupIds.length > 0) {
    await tx.trx('user_activity_group_items')
      .where({ tenant: tx.tenantId, activity_id: activityId, activity_type: activityType })
      .whereIn('group_id', groupIds)
      .del();
  }
};

export function registerActivityActions(): void {
  const registry = getActionRegistryV2();

  registry.register({
    id: 'activities.find_group',
    version: 1,
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    inputSchema: groupLookupInputSchema,
    outputSchema: groupSummarySchema,
    ui: {
      label: 'Find Activity Group',
      category: 'Business Operations',
      description: 'Resolve a user activity group by name or id, optionally for another user.',
    },
    handler: async (input, ctx) => {
      return withTenantTransaction(ctx, async (tx) => {
        await requirePermission(ctx, tx, { resource: 'user_schedule', action: 'read' });
        const { group } = await resolveGroupOrThrow(ctx, tx, input);
        return {
          groupId: group.groupId,
          groupName: group.groupName,
          sortOrder: group.sortOrder,
          isCollapsed: group.isCollapsed,
          itemCount: group.items.length,
        };
      });
    },
  });

  registry.register({
    id: 'activities.add_to_group',
    version: 1,
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    inputSchema: activityTargetSchema,
    outputSchema: z.object({ added: z.boolean(), groupId: z.string() }),
    ui: {
      label: 'Add to Activity Group',
      category: 'Business Operations',
      description: 'File an activity (e.g. a ticket) into a user activity group. Idempotent on repeat adds.',
    },
    handler: async (input, ctx) => {
      return withTenantTransaction(ctx, async (tx) => {
        await requirePermission(ctx, tx, { resource: 'user_schedule', action: 'read' });
        const { group, ownerUserId } = await resolveGroupOrThrow(ctx, tx, input);
        // Insert at the top; the core removes any existing membership first,
        // so repeated adds converge on the same state.
        await removeExistingMembership(tx, ownerUserId, input.activityId, input.activityType);
        await tx.trx('user_activity_group_items')
          .where({ tenant: tx.tenantId, group_id: group.groupId })
          .andWhere('sort_order', '>=', 0)
          .increment('sort_order', 1);
        await tx.trx('user_activity_group_items').insert({
          tenant: tx.tenantId,
          group_id: group.groupId,
          activity_id: input.activityId,
          activity_type: input.activityType,
          sort_order: 0,
        });
        return { added: true, groupId: group.groupId };
      });
    },
  });

  registry.register({
    id: 'activities.remove_from_group',
    version: 1,
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    inputSchema: removeFromGroupInputSchema,
    outputSchema: z.object({ removed: z.boolean() }),
    ui: {
      label: 'Remove from Activity Groups',
      category: 'Business Operations',
      description: 'Remove an activity from all of a user\'s activity groups. No-op when it is not grouped.',
    },
    handler: async (input, ctx) => {
      return withTenantTransaction(ctx, async (tx) => {
        await requirePermission(ctx, tx, { resource: 'user_schedule', action: 'read' });
        const ownerUserId = input.ownerUserId ?? tx.actorUserId;
        if (ownerUserId !== tx.actorUserId) {
          await requirePermission(ctx, tx, { resource: 'user_schedule', action: 'update' });
        }
        await removeExistingMembership(tx, ownerUserId, input.activityId, input.activityType);
        return { removed: true };
      });
    },
  });
}
