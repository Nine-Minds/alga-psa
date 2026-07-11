import { z } from 'zod';
import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { withWorkflowJsonSchemaMetadata } from '../../jsonSchemaMetadata';
import { withTenantTransaction, requirePermission, throwActionError, uuidSchema, type TenantTxContext } from './shared';
import {
  getUserActivityGroupsForApi,
  moveActivityToGroupForApi,
  removeActivityFromGroupsForApi,
  type ActivityGroup,
} from '@alga-psa/user-activities/server/activity-actions';
import type { ActionContext } from '../../registries/actionRegistry';

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

/**
 * The activity-group cores are identity-explicit (`hasPermission` needs
 * tenant + user_type and loads roles by user id), so build a real identity
 * for the workflow run's actor instead of casting a bare `{ user_id }`.
 */
const loadActorIdentity = async (tx: TenantTxContext) => {
  const actor = await tx.trx('users')
    .where({ tenant: tx.tenantId, user_id: tx.actorUserId })
    .first();
  if (!actor) {
    return null;
  }
  return {
    ...actor,
    roles: actor.roles ?? [],
  };
};

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
): Promise<{ group: ActivityGroup; identity: NonNullable<Awaited<ReturnType<typeof loadActorIdentity>>> }> => {
  const identity = await loadActorIdentity(tx);
  if (!identity) {
    throwActionError(ctx, { category: 'ActionError', code: 'ACTOR_NOT_FOUND', message: 'Workflow actor user not found' });
  }
  const groups = await getUserActivityGroupsForApi(identity, tx.tenantId, input.ownerUserId);
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
  return { group: group as ActivityGroup, identity };
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
        const { group, identity } = await resolveGroupOrThrow(ctx, tx, input);
        // Insert at the top; the core removes any existing membership first,
        // so repeated adds converge on the same state.
        await moveActivityToGroupForApi(
          identity,
          tx.tenantId,
          input.activityId,
          input.activityType,
          group.groupId,
          0,
          input.ownerUserId
        );
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
        const identity = await loadActorIdentity(tx);
        if (!identity) {
          throwActionError(ctx, { category: 'ActionError', code: 'ACTOR_NOT_FOUND', message: 'Workflow actor user not found' });
        }
        await removeActivityFromGroupsForApi(
          identity!,
          tx.tenantId,
          input.activityId,
          input.activityType,
          input.ownerUserId
        );
        return { removed: true };
      });
    },
  });
}
