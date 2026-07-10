import { z } from 'zod';
import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { withTenantTransaction, requirePermission, throwActionError } from './shared';
import { getUserActivityGroupsForApi, moveActivityToGroupForApi, removeActivityFromGroupsForApi } from '@alga-psa/user-activities/server/activity-actions';

const uuidOrString = z.string().min(1);
type ActivityActor = { user_id: string };

const groupLookupInputSchema = z.object({
  groupId: uuidOrString.optional(),
  groupName: z.string().min(1).optional(),
  ownerUserId: z.string().min(1).optional()
}).superRefine((value, ctx) => {
  if (!value.groupId && !value.groupName) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['groupId'], message: 'groupId or groupName is required' });
  }
});

const activityTargetSchema = z.object({
  activityId: uuidOrString,
  activityType: z.string().min(1),
  groupId: uuidOrString.optional(),
  groupName: z.string().min(1).optional(),
  ownerUserId: z.string().min(1).optional()
});

export function registerActivityActions(): void {
  const registry = getActionRegistryV2();

  registry.register({
    id: 'activities.find_group',
    version: 1,
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    inputSchema: groupLookupInputSchema,
    outputSchema: z.object({
      groupId: z.string(),
      groupName: z.string(),
      sortOrder: z.number(),
      isCollapsed: z.boolean()
    }),
    ui: { label: 'Find group', description: 'Resolve a user activity group by name or id.' },
    handler: async (input, ctx) => {
      return withTenantTransaction(ctx, async (tx) => {
        await requirePermission(ctx, tx, { resource: 'user_schedule', action: 'read' });
        const groups = await getUserActivityGroupsForApi({ user_id: tx.actorUserId } as ActivityActor, tx.tenantId, input.ownerUserId);
        const found = input.groupId
          ? groups.flatMap((group) => [group]).find((group) => group.groupId === input.groupId)
          : groups.find((group) => group.groupName.toLowerCase() === input.groupName?.toLowerCase());
        if (!found) {
          throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Activity group not found' });
        }
        return found;
      });
    }
  });

  registry.register({
    id: 'activities.add_to_group',
    version: 1,
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    inputSchema: activityTargetSchema,
    outputSchema: z.object({ added: z.boolean() }),
    ui: { label: 'Add to group', description: 'Add an activity to a user activity group.' },
    handler: async (input, ctx) => {
      return withTenantTransaction(ctx, async (tx) => {
        await requirePermission(ctx, tx, { resource: 'user_schedule', action: 'read' });
        const groups = await getUserActivityGroupsForApi({ user_id: tx.actorUserId } as ActivityActor, tx.tenantId, input.ownerUserId);
        const group = input.groupId
          ? groups.find((entry) => entry.groupId === input.groupId)
          : groups.find((entry) => entry.groupName.toLowerCase() === input.groupName?.toLowerCase());
        if (!group) {
          throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Activity group not found' });
        }
        await moveActivityToGroupForApi({ user_id: tx.actorUserId } as ActivityActor, tx.tenantId, input.activityId, input.activityType, group.groupId, 0);
        return { added: true };
      });
    }
  });

  registry.register({
    id: 'activities.remove_from_group',
    version: 1,
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    inputSchema: activityTargetSchema,
    outputSchema: z.object({ removed: z.boolean() }),
    ui: { label: 'Remove from group', description: 'Remove an activity from user activity groups.' },
    handler: async (input, ctx) => {
      return withTenantTransaction(ctx, async (tx) => {
        await requirePermission(ctx, tx, { resource: 'user_schedule', action: 'read' });
        await removeActivityFromGroupsForApi({ user_id: tx.actorUserId } as ActivityActor, tx.tenantId, input.activityId, input.activityType);
        return { removed: true };
      });
    }
  });
}
