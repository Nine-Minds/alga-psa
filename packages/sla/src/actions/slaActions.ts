'use server';

import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { Knex } from 'knex';
import {
  ISlaPolicy,
  ISlaPolicyTarget,
  ISlaPolicyInput,
  ISlaPolicyTargetInput,
  ISlaPolicyWithTargets,
  ISlaNotificationThreshold,
  ISlaNotificationThresholdInput
} from '../types';

// ============================================================================
// SLA Policies
// ============================================================================

/**
 * Get all SLA policies for the current tenant.
 */
export const getSlaPolicies = withAuth(async (_user, { tenant }): Promise<ISlaPolicy[]> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      const policies = await trx('sla_policies')
        .where({ tenant })
        .orderBy('policy_name', 'asc');

      return policies as ISlaPolicy[];
    } catch (error) {
      console.error(`Error fetching SLA policies for tenant ${tenant}:`, error);
      throw new Error(`Failed to fetch SLA policies for tenant ${tenant}`);
    }
  });
});

/**
 * Get an SLA policy by ID with its targets and notification thresholds.
 */
export const getSlaPolicyById = withAuth(async (_user, { tenant }, policyId: string): Promise<ISlaPolicyWithTargets | null> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      const policy = await trx('sla_policies')
        .where({ tenant, sla_policy_id: policyId })
        .first();

      if (!policy) {
        return null;
      }

      // Fetch targets and notification thresholds in parallel
      const [targets, notificationThresholds] = await Promise.all([
        trx('sla_policy_targets')
          .where({ tenant, sla_policy_id: policyId })
          .orderBy('created_at', 'asc'),
        trx('sla_notification_thresholds')
          .where({ tenant, sla_policy_id: policyId })
          .orderBy('threshold_percent', 'asc')
      ]);

      return {
        ...policy,
        targets: targets as ISlaPolicyTarget[],
        notification_thresholds: notificationThresholds as ISlaNotificationThreshold[]
      } as ISlaPolicyWithTargets;
    } catch (error) {
      console.error(`Error fetching SLA policy ${policyId} for tenant ${tenant}:`, error);
      throw new Error(`Failed to fetch SLA policy for tenant ${tenant}`);
    }
  });
});

/**
 * Get the default SLA policy for the current tenant.
 */
export const getDefaultSlaPolicy = withAuth(async (_user, { tenant }): Promise<ISlaPolicy | null> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      const policy = await trx('sla_policies')
        .where({ tenant, is_default: true })
        .first();

      return policy || null;
    } catch (error) {
      console.error(`Error fetching default SLA policy for tenant ${tenant}:`, error);
      throw new Error(`Failed to fetch default SLA policy for tenant ${tenant}`);
    }
  });
});

/**
 * Create a new SLA policy.
 * Optionally seeds default notification thresholds (50%, 75%, 90%, 100%).
 */
export const createSlaPolicy = withAuth(async (
  _user,
  { tenant },
  input: ISlaPolicyInput,
  seedDefaultThresholds: boolean = true
): Promise<ISlaPolicy> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      const policyId = crypto.randomUUID();

      // If setting as default, clear any existing default first
      if (input.is_default) {
        await trx('sla_policies')
          .where({ tenant, is_default: true })
          .update({ is_default: false, updated_at: trx.fn.now() });
      }

      const [newPolicy] = await trx('sla_policies')
        .insert({
          tenant,
          sla_policy_id: policyId,
          policy_name: input.policy_name,
          description: input.description || null,
          is_default: input.is_default || false,
          business_hours_schedule_id: input.business_hours_schedule_id || null,
          created_at: trx.fn.now(),
          updated_at: trx.fn.now()
        })
        .returning('*');

      // Seed default notification thresholds if requested
      if (seedDefaultThresholds) {
        const defaultThresholds: ISlaNotificationThresholdInput[] = [
          { threshold_percent: 50, notification_type: 'warning', notify_assignee: true, notify_board_manager: false, notify_escalation_manager: false, channels: ['in_app'] },
          { threshold_percent: 75, notification_type: 'warning', notify_assignee: true, notify_board_manager: true, notify_escalation_manager: false, channels: ['in_app'] },
          { threshold_percent: 90, notification_type: 'warning', notify_assignee: true, notify_board_manager: true, notify_escalation_manager: true, channels: ['in_app', 'email'] },
          { threshold_percent: 100, notification_type: 'breach', notify_assignee: true, notify_board_manager: true, notify_escalation_manager: true, channels: ['in_app', 'email'] }
        ];

        const thresholdInserts = defaultThresholds.map(threshold => ({
          tenant,
          threshold_id: crypto.randomUUID(),
          sla_policy_id: policyId,
          threshold_percent: threshold.threshold_percent,
          notification_type: threshold.notification_type,
          notify_assignee: threshold.notify_assignee ?? true,
          notify_board_manager: threshold.notify_board_manager ?? false,
          notify_escalation_manager: threshold.notify_escalation_manager ?? false,
          channels: threshold.channels || ['in_app'],
          created_at: trx.fn.now()
        }));

        await trx('sla_notification_thresholds').insert(thresholdInserts);
      }

      return newPolicy as ISlaPolicy;
    } catch (error) {
      console.error(`Error creating SLA policy for tenant ${tenant}:`, error);
      throw new Error(`Failed to create SLA policy for tenant ${tenant}`);
    }
  });
});

/**
 * Update an existing SLA policy.
 */
export const updateSlaPolicy = withAuth(async (
  _user,
  { tenant },
  policyId: string,
  input: Partial<ISlaPolicyInput>
): Promise<ISlaPolicy> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      // Verify policy exists
      const existingPolicy = await trx('sla_policies')
        .where({ tenant, sla_policy_id: policyId })
        .first();

      if (!existingPolicy) {
        throw new Error(`SLA policy ${policyId} not found`);
      }

      // If setting as default, clear any existing default first
      if (input.is_default && !existingPolicy.is_default) {
        await trx('sla_policies')
          .where({ tenant, is_default: true })
          .whereNot({ sla_policy_id: policyId })
          .update({ is_default: false, updated_at: trx.fn.now() });
      }

      const updateData: Record<string, any> = {
        updated_at: trx.fn.now()
      };

      if (input.policy_name !== undefined) {
        updateData.policy_name = input.policy_name;
      }
      if (input.description !== undefined) {
        updateData.description = input.description || null;
      }
      if (input.is_default !== undefined) {
        updateData.is_default = input.is_default;
      }
      if (input.business_hours_schedule_id !== undefined) {
        updateData.business_hours_schedule_id = input.business_hours_schedule_id || null;
      }

      const [updatedPolicy] = await trx('sla_policies')
        .where({ tenant, sla_policy_id: policyId })
        .update(updateData)
        .returning('*');

      return updatedPolicy as ISlaPolicy;
    } catch (error) {
      console.error(`Error updating SLA policy ${policyId} for tenant ${tenant}:`, error);
      throw new Error(error instanceof Error ? error.message : `Failed to update SLA policy for tenant ${tenant}`);
    }
  });
});

/**
 * Delete an SLA policy and its associated targets and notification thresholds.
 */
export const deleteSlaPolicy = withAuth(async (_user, { tenant }, policyId: string): Promise<void> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      // Verify policy exists
      const existingPolicy = await trx('sla_policies')
        .where({ tenant, sla_policy_id: policyId })
        .first();

      if (!existingPolicy) {
        throw new Error(`SLA policy ${policyId} not found`);
      }

      // Check if policy is assigned to any clients or boards
      const [assignedClients, assignedBoards] = await Promise.all([
        trx('clients')
          .where({ tenant, sla_policy_id: policyId })
          .count('* as count')
          .first(),
        trx('boards')
          .where({ tenant, sla_policy_id: policyId })
          .count('* as count')
          .first()
      ]);

      if (assignedClients && Number(assignedClients.count) > 0) {
        throw new Error('Cannot delete SLA policy that is assigned to clients. Please remove the policy from all clients first.');
      }

      if (assignedBoards && Number(assignedBoards.count) > 0) {
        throw new Error('Cannot delete SLA policy that is assigned to boards. Please remove the policy from all boards first.');
      }

      // Delete notification thresholds (CitusDB doesn't support ON DELETE CASCADE)
      await trx('sla_notification_thresholds')
        .where({ tenant, sla_policy_id: policyId })
        .delete();

      // Delete targets
      await trx('sla_policy_targets')
        .where({ tenant, sla_policy_id: policyId })
        .delete();

      // Delete the policy
      await trx('sla_policies')
        .where({ tenant, sla_policy_id: policyId })
        .delete();
    } catch (error) {
      console.error(`Error deleting SLA policy ${policyId} for tenant ${tenant}:`, error);
      throw new Error(error instanceof Error ? error.message : `Failed to delete SLA policy for tenant ${tenant}`);
    }
  });
});

/**
 * Set a policy as the default for the tenant.
 * Ensures only one policy is default at a time.
 */
export const setDefaultSlaPolicy = withAuth(async (_user, { tenant }, policyId: string): Promise<void> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      // Verify policy exists
      const existingPolicy = await trx('sla_policies')
        .where({ tenant, sla_policy_id: policyId })
        .first();

      if (!existingPolicy) {
        throw new Error(`SLA policy ${policyId} not found`);
      }

      // Clear existing default
      await trx('sla_policies')
        .where({ tenant, is_default: true })
        .update({ is_default: false, updated_at: trx.fn.now() });

      // Set new default
      await trx('sla_policies')
        .where({ tenant, sla_policy_id: policyId })
        .update({ is_default: true, updated_at: trx.fn.now() });
    } catch (error) {
      console.error(`Error setting default SLA policy ${policyId} for tenant ${tenant}:`, error);
      throw new Error(error instanceof Error ? error.message : `Failed to set default SLA policy for tenant ${tenant}`);
    }
  });
});

// ============================================================================
// SLA Policy Targets
// ============================================================================

/**
 * Get all targets for a specific SLA policy.
 */
export const getSlaPolicyTargets = withAuth(async (_user, { tenant }, policyId: string): Promise<ISlaPolicyTarget[]> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      const targets = await trx('sla_policy_targets')
        .where({ tenant, sla_policy_id: policyId })
        .orderBy('created_at', 'asc');

      return targets as ISlaPolicyTarget[];
    } catch (error) {
      console.error(`Error fetching SLA policy targets for policy ${policyId}, tenant ${tenant}:`, error);
      throw new Error(`Failed to fetch SLA policy targets for tenant ${tenant}`);
    }
  });
});

/**
 * Create a new target for an SLA policy.
 */
export const createSlaPolicyTarget = withAuth(async (
  _user,
  { tenant },
  policyId: string,
  input: ISlaPolicyTargetInput
): Promise<ISlaPolicyTarget> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      // Verify policy exists
      const policy = await trx('sla_policies')
        .where({ tenant, sla_policy_id: policyId })
        .first();

      if (!policy) {
        throw new Error(`SLA policy ${policyId} not found`);
      }

      // Verify priority exists
      const priority = await trx('priorities')
        .where({ tenant, priority_id: input.priority_id })
        .first();

      if (!priority) {
        throw new Error(`Priority ${input.priority_id} not found`);
      }

      // Check if target already exists for this policy/priority combination
      const existingTarget = await trx('sla_policy_targets')
        .where({ tenant, sla_policy_id: policyId, priority_id: input.priority_id })
        .first();

      if (existingTarget) {
        throw new Error(`A target for this priority already exists in this policy`);
      }

      const [newTarget] = await trx('sla_policy_targets')
        .insert({
          tenant,
          target_id: crypto.randomUUID(),
          sla_policy_id: policyId,
          priority_id: input.priority_id,
          response_time_minutes: input.response_time_minutes ?? null,
          resolution_time_minutes: input.resolution_time_minutes ?? null,
          escalation_1_percent: input.escalation_1_percent ?? 70,
          escalation_2_percent: input.escalation_2_percent ?? 90,
          escalation_3_percent: input.escalation_3_percent ?? 110,
          is_24x7: input.is_24x7 ?? false,
          created_at: trx.fn.now(),
          updated_at: trx.fn.now()
        })
        .returning('*');

      return newTarget as ISlaPolicyTarget;
    } catch (error) {
      console.error(`Error creating SLA policy target for policy ${policyId}, tenant ${tenant}:`, error);
      throw new Error(error instanceof Error ? error.message : `Failed to create SLA policy target for tenant ${tenant}`);
    }
  });
});

/**
 * Update an existing SLA policy target.
 */
export const updateSlaPolicyTarget = withAuth(async (
  _user,
  { tenant },
  targetId: string,
  input: Partial<ISlaPolicyTargetInput>
): Promise<ISlaPolicyTarget> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      // Verify target exists
      const existingTarget = await trx('sla_policy_targets')
        .where({ tenant, target_id: targetId })
        .first();

      if (!existingTarget) {
        throw new Error(`SLA policy target ${targetId} not found`);
      }

      // If changing priority, verify the new priority exists and isn't already used
      if (input.priority_id && input.priority_id !== existingTarget.priority_id) {
        const priority = await trx('priorities')
          .where({ tenant, priority_id: input.priority_id })
          .first();

        if (!priority) {
          throw new Error(`Priority ${input.priority_id} not found`);
        }

        const duplicateTarget = await trx('sla_policy_targets')
          .where({ tenant, sla_policy_id: existingTarget.sla_policy_id, priority_id: input.priority_id })
          .whereNot({ target_id: targetId })
          .first();

        if (duplicateTarget) {
          throw new Error(`A target for this priority already exists in this policy`);
        }
      }

      const updateData: Record<string, any> = {
        updated_at: trx.fn.now()
      };

      if (input.priority_id !== undefined) {
        updateData.priority_id = input.priority_id;
      }
      if (input.response_time_minutes !== undefined) {
        updateData.response_time_minutes = input.response_time_minutes ?? null;
      }
      if (input.resolution_time_minutes !== undefined) {
        updateData.resolution_time_minutes = input.resolution_time_minutes ?? null;
      }
      if (input.escalation_1_percent !== undefined) {
        updateData.escalation_1_percent = input.escalation_1_percent;
      }
      if (input.escalation_2_percent !== undefined) {
        updateData.escalation_2_percent = input.escalation_2_percent;
      }
      if (input.escalation_3_percent !== undefined) {
        updateData.escalation_3_percent = input.escalation_3_percent;
      }
      if (input.is_24x7 !== undefined) {
        updateData.is_24x7 = input.is_24x7;
      }

      const [updatedTarget] = await trx('sla_policy_targets')
        .where({ tenant, target_id: targetId })
        .update(updateData)
        .returning('*');

      return updatedTarget as ISlaPolicyTarget;
    } catch (error) {
      console.error(`Error updating SLA policy target ${targetId} for tenant ${tenant}:`, error);
      throw new Error(error instanceof Error ? error.message : `Failed to update SLA policy target for tenant ${tenant}`);
    }
  });
});

/**
 * Delete an SLA policy target.
 */
export const deleteSlaPolicyTarget = withAuth(async (_user, { tenant }, targetId: string): Promise<void> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      const deleted = await trx('sla_policy_targets')
        .where({ tenant, target_id: targetId })
        .delete();

      if (!deleted) {
        throw new Error(`SLA policy target ${targetId} not found`);
      }
    } catch (error) {
      console.error(`Error deleting SLA policy target ${targetId} for tenant ${tenant}:`, error);
      throw new Error(error instanceof Error ? error.message : `Failed to delete SLA policy target for tenant ${tenant}`);
    }
  });
});

/**
 * Upsert multiple SLA policy targets at once.
 * Useful for bulk updates from the UI.
 */
export const upsertSlaPolicyTargets = withAuth(async (
  _user,
  { tenant },
  policyId: string,
  targets: ISlaPolicyTargetInput[]
): Promise<ISlaPolicyTarget[]> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      // Verify policy exists
      const policy = await trx('sla_policies')
        .where({ tenant, sla_policy_id: policyId })
        .first();

      if (!policy) {
        throw new Error(`SLA policy ${policyId} not found`);
      }

      // Get existing targets for this policy
      const existingTargets = await trx('sla_policy_targets')
        .where({ tenant, sla_policy_id: policyId });

      const existingByPriority = new Map(
        existingTargets.map(t => [t.priority_id, t])
      );

      const results: ISlaPolicyTarget[] = [];
      const processedPriorityIds = new Set<string>();

      for (const target of targets) {
        // Verify priority exists
        const priority = await trx('priorities')
          .where({ tenant, priority_id: target.priority_id })
          .first();

        if (!priority) {
          throw new Error(`Priority ${target.priority_id} not found`);
        }

        const existing = existingByPriority.get(target.priority_id);

        if (existing) {
          // Update existing target
          const [updated] = await trx('sla_policy_targets')
            .where({ tenant, target_id: existing.target_id })
            .update({
              response_time_minutes: target.response_time_minutes ?? null,
              resolution_time_minutes: target.resolution_time_minutes ?? null,
              escalation_1_percent: target.escalation_1_percent ?? 70,
              escalation_2_percent: target.escalation_2_percent ?? 90,
              escalation_3_percent: target.escalation_3_percent ?? 110,
              is_24x7: target.is_24x7 ?? false,
              updated_at: trx.fn.now()
            })
            .returning('*');

          results.push(updated as ISlaPolicyTarget);
        } else {
          // Insert new target
          const [inserted] = await trx('sla_policy_targets')
            .insert({
              tenant,
              target_id: crypto.randomUUID(),
              sla_policy_id: policyId,
              priority_id: target.priority_id,
              response_time_minutes: target.response_time_minutes ?? null,
              resolution_time_minutes: target.resolution_time_minutes ?? null,
              escalation_1_percent: target.escalation_1_percent ?? 70,
              escalation_2_percent: target.escalation_2_percent ?? 90,
              escalation_3_percent: target.escalation_3_percent ?? 110,
              is_24x7: target.is_24x7 ?? false,
              created_at: trx.fn.now(),
              updated_at: trx.fn.now()
            })
            .returning('*');

          results.push(inserted as ISlaPolicyTarget);
        }

        processedPriorityIds.add(target.priority_id);
      }

      return results;
    } catch (error) {
      console.error(`Error upserting SLA policy targets for policy ${policyId}, tenant ${tenant}:`, error);
      throw new Error(error instanceof Error ? error.message : `Failed to upsert SLA policy targets for tenant ${tenant}`);
    }
  });
});

// ============================================================================
// SLA Notification Thresholds
// ============================================================================

/**
 * Get all notification thresholds for a specific SLA policy.
 */
export const getSlaNotificationThresholds = withAuth(async (_user, { tenant }, policyId: string): Promise<ISlaNotificationThreshold[]> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      const thresholds = await trx('sla_notification_thresholds')
        .where({ tenant, sla_policy_id: policyId })
        .orderBy('threshold_percent', 'asc');

      return thresholds as ISlaNotificationThreshold[];
    } catch (error) {
      console.error(`Error fetching SLA notification thresholds for policy ${policyId}, tenant ${tenant}:`, error);
      throw new Error(`Failed to fetch SLA notification thresholds for tenant ${tenant}`);
    }
  });
});

/**
 * Upsert notification thresholds for an SLA policy.
 * Replaces all existing thresholds with the provided ones.
 */
export const upsertSlaNotificationThresholds = withAuth(async (
  _user,
  { tenant },
  policyId: string,
  thresholds: ISlaNotificationThresholdInput[]
): Promise<ISlaNotificationThreshold[]> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      // Verify policy exists
      const policy = await trx('sla_policies')
        .where({ tenant, sla_policy_id: policyId })
        .first();

      if (!policy) {
        throw new Error(`SLA policy ${policyId} not found`);
      }

      // Delete existing thresholds
      await trx('sla_notification_thresholds')
        .where({ tenant, sla_policy_id: policyId })
        .delete();

      if (thresholds.length === 0) {
        return [];
      }

      // Insert new thresholds
      const inserts = thresholds.map(threshold => ({
        tenant,
        threshold_id: crypto.randomUUID(),
        sla_policy_id: policyId,
        threshold_percent: threshold.threshold_percent,
        notification_type: threshold.notification_type,
        notify_assignee: threshold.notify_assignee ?? true,
        notify_board_manager: threshold.notify_board_manager ?? false,
        notify_escalation_manager: threshold.notify_escalation_manager ?? false,
        channels: threshold.channels || ['in_app'],
        created_at: trx.fn.now()
      }));

      const inserted = await trx('sla_notification_thresholds')
        .insert(inserts)
        .returning('*');

      return inserted as ISlaNotificationThreshold[];
    } catch (error) {
      console.error(`Error upserting SLA notification thresholds for policy ${policyId}, tenant ${tenant}:`, error);
      throw new Error(error instanceof Error ? error.message : `Failed to upsert SLA notification thresholds for tenant ${tenant}`);
    }
  });
});

// ============================================================================
// Client SLA Assignment
// ============================================================================

/**
 * Get the SLA policy assigned to a specific client.
 */
export const getClientSlaPolicy = withAuth(async (_user, { tenant }, clientId: string): Promise<ISlaPolicy | null> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      const client = await trx('clients')
        .where({ tenant, client_id: clientId })
        .first();

      if (!client || !client.sla_policy_id) {
        return null;
      }

      const policy = await trx('sla_policies')
        .where({ tenant, sla_policy_id: client.sla_policy_id })
        .first();

      return policy || null;
    } catch (error) {
      console.error(`Error fetching SLA policy for client ${clientId}, tenant ${tenant}:`, error);
      throw new Error(`Failed to fetch SLA policy for client ${tenant}`);
    }
  });
});

/**
 * Assign an SLA policy to a client, or remove the assignment.
 */
export const setClientSlaPolicy = withAuth(async (
  _user,
  { tenant },
  clientId: string,
  policyId: string | null
): Promise<void> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      // Verify client exists
      const client = await trx('clients')
        .where({ tenant, client_id: clientId })
        .first();

      if (!client) {
        throw new Error(`Client ${clientId} not found`);
      }

      // Verify policy exists if provided
      if (policyId) {
        const policy = await trx('sla_policies')
          .where({ tenant, sla_policy_id: policyId })
          .first();

        if (!policy) {
          throw new Error(`SLA policy ${policyId} not found`);
        }
      }

      await trx('clients')
        .where({ tenant, client_id: clientId })
        .update({
          sla_policy_id: policyId || null,
          updated_at: trx.fn.now()
        });
    } catch (error) {
      console.error(`Error setting SLA policy for client ${clientId}, tenant ${tenant}:`, error);
      throw new Error(error instanceof Error ? error.message : `Failed to set SLA policy for client ${tenant}`);
    }
  });
});

// ============================================================================
// Board SLA Assignment
// ============================================================================

/**
 * Get the SLA policy assigned to a specific board.
 */
export const getBoardSlaPolicy = withAuth(async (_user, { tenant }, boardId: string): Promise<ISlaPolicy | null> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      const board = await trx('boards')
        .where({ tenant, board_id: boardId })
        .first();

      if (!board || !board.sla_policy_id) {
        return null;
      }

      const policy = await trx('sla_policies')
        .where({ tenant, sla_policy_id: board.sla_policy_id })
        .first();

      return policy || null;
    } catch (error) {
      console.error(`Error fetching SLA policy for board ${boardId}, tenant ${tenant}:`, error);
      throw new Error(`Failed to fetch SLA policy for board ${tenant}`);
    }
  });
});

/**
 * Assign an SLA policy to a board, or remove the assignment.
 */
export const setBoardSlaPolicy = withAuth(async (
  _user,
  { tenant },
  boardId: string,
  policyId: string | null
): Promise<void> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      // Verify board exists
      const board = await trx('boards')
        .where({ tenant, board_id: boardId })
        .first();

      if (!board) {
        throw new Error(`Board ${boardId} not found`);
      }

      // Verify policy exists if provided
      if (policyId) {
        const policy = await trx('sla_policies')
          .where({ tenant, sla_policy_id: policyId })
          .first();

        if (!policy) {
          throw new Error(`SLA policy ${policyId} not found`);
        }
      }

      await trx('boards')
        .where({ tenant, board_id: boardId })
        .update({
          sla_policy_id: policyId || null,
          updated_at: trx.fn.now()
        });
    } catch (error) {
      console.error(`Error setting SLA policy for board ${boardId}, tenant ${tenant}:`, error);
      throw new Error(error instanceof Error ? error.message : `Failed to set SLA policy for board ${tenant}`);
    }
  });
});

// ============================================================================
// SLA Policy Resolution (Hierarchy: Client → Board → Tenant Default)
// ============================================================================

/**
 * Resolve the effective SLA policy for a ticket based on the hierarchy:
 * 1. Client's SLA policy (if set)
 * 2. Board's SLA policy (if set)
 * 3. Tenant's default SLA policy
 */
export const resolveTicketSlaPolicy = withAuth(async (
  _user,
  { tenant },
  clientId: string,
  boardId: string
): Promise<ISlaPolicy | null> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      // 1. Check client's SLA policy
      const client = await trx('clients')
        .where({ tenant, client_id: clientId })
        .first();

      if (client?.sla_policy_id) {
        const policy = await trx('sla_policies')
          .where({ tenant, sla_policy_id: client.sla_policy_id })
          .first();
        if (policy) return policy as ISlaPolicy;
      }

      // 2. Check board's SLA policy
      const board = await trx('boards')
        .where({ tenant, board_id: boardId })
        .first();

      if (board?.sla_policy_id) {
        const policy = await trx('sla_policies')
          .where({ tenant, sla_policy_id: board.sla_policy_id })
          .first();
        if (policy) return policy as ISlaPolicy;
      }

      // 3. Check tenant's default SLA policy
      const defaultPolicy = await trx('sla_policies')
        .where({ tenant, is_default: true })
        .first();

      return defaultPolicy || null;
    } catch (error) {
      console.error(`Error resolving SLA policy for client ${clientId}, board ${boardId}, tenant ${tenant}:`, error);
      throw new Error(`Failed to resolve SLA policy for tenant ${tenant}`);
    }
  });
});

/**
 * Resolves the SLA policy for a ticket following the hierarchy:
 * 1. Client (clients.sla_policy_id) - if set, use client's policy
 * 2. Board (boards.sla_policy_id) - if set, use board's policy
 * 3. Tenant default (sla_policies.is_default = true)
 *
 * @param ticketId - The ticket ID to resolve SLA policy for
 * @returns The resolved SLA policy with targets, or null if none found
 */
export const resolveSlaPolicy = withAuth(async (_user, { tenant }, ticketId: string): Promise<ISlaPolicyWithTargets | null> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      // Step 1: Fetch the ticket to get client_id and board_id
      const ticket = await trx('tickets')
        .where({ tenant, ticket_id: ticketId })
        .select('client_id', 'board_id')
        .first();

      if (!ticket) {
        console.warn(`Ticket ${ticketId} not found for tenant ${tenant}`);
        return null;
      }

      // Delegate to context-based resolution
      return resolveSlaPolicyForContextInternal(
        ticket.client_id,
        ticket.board_id,
        tenant,
        trx
      );
    } catch (error) {
      console.error(`Error resolving SLA policy for ticket ${ticketId}, tenant ${tenant}:`, error);
      throw new Error(`Failed to resolve SLA policy for ticket ${ticketId}`);
    }
  });
});

/**
 * Resolves the SLA policy without a ticket - useful when creating a ticket.
 * Follows the hierarchy:
 * 1. Client (clients.sla_policy_id) - if set, use client's policy
 * 2. Board (boards.sla_policy_id) - if set, use board's policy
 * 3. Tenant default (sla_policies.is_default = true)
 *
 * @param companyId - The company/client ID (can be null)
 * @param boardId - The board ID (can be null)
 * @returns The resolved SLA policy with targets, or null if none found
 */
export const resolveSlaPolicyForContext = withAuth(async (
  _user,
  { tenant },
  companyId: string | null,
  boardId: string | null
): Promise<ISlaPolicyWithTargets | null> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      return resolveSlaPolicyForContextInternal(companyId, boardId, tenant, trx);
    } catch (error) {
      console.error(`Error resolving SLA policy for context (company: ${companyId}, board: ${boardId}), tenant ${tenant}:`, error);
      throw new Error(`Failed to resolve SLA policy for context`);
    }
  });
});

/**
 * Internal helper function that resolves SLA policy within an existing transaction.
 * Used by both resolveSlaPolicy and resolveSlaPolicyForContext.
 */
async function resolveSlaPolicyForContextInternal(
  companyId: string | null,
  boardId: string | null,
  tenant: string,
  trx: Knex.Transaction
): Promise<ISlaPolicyWithTargets | null> {
  let policyId: string | null = null;

  // Step 1: Check client's SLA policy (if companyId provided)
  if (companyId) {
    const client = await trx('clients')
      .where({ tenant, client_id: companyId })
      .select('sla_policy_id')
      .first();

    if (client?.sla_policy_id) {
      policyId = client.sla_policy_id;
    }
  }

  // Step 2: Check board's SLA policy (if no client policy and boardId provided)
  if (!policyId && boardId) {
    const board = await trx('boards')
      .where({ tenant, board_id: boardId })
      .select('sla_policy_id')
      .first();

    if (board?.sla_policy_id) {
      policyId = board.sla_policy_id;
    }
  }

  // Step 3: Check tenant's default SLA policy
  if (!policyId) {
    const defaultPolicy = await trx('sla_policies')
      .where({ tenant, is_default: true })
      .select('sla_policy_id')
      .first();

    if (defaultPolicy?.sla_policy_id) {
      policyId = defaultPolicy.sla_policy_id;
    }
  }

  // If no policy found at any level, return null
  if (!policyId) {
    return null;
  }

  // Fetch the full policy with targets and notification thresholds
  const policy = await trx('sla_policies')
    .where({ tenant, sla_policy_id: policyId })
    .first();

  if (!policy) {
    return null;
  }

  // Fetch targets and notification thresholds in parallel
  const [targets, notificationThresholds] = await Promise.all([
    trx('sla_policy_targets')
      .where({ tenant, sla_policy_id: policyId })
      .orderBy('created_at', 'asc'),
    trx('sla_notification_thresholds')
      .where({ tenant, sla_policy_id: policyId })
      .orderBy('threshold_percent', 'asc')
  ]);

  return {
    ...policy,
    targets: targets as ISlaPolicyTarget[],
    notification_thresholds: notificationThresholds as ISlaNotificationThreshold[]
  } as ISlaPolicyWithTargets;
}
