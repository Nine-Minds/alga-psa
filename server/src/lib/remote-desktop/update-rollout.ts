/**
 * Remote Desktop Agent Update Rollout Management
 *
 * Handles staged rollout of agent updates, including cohort assignment,
 * rollout percentage control, and pause/resume functionality.
 */

import { Knex } from 'knex';
import crypto from 'crypto';

/**
 * Rollout status
 */
export type RolloutStatus = 'pending' | 'rolling_out' | 'paused' | 'completed' | 'cancelled';

/**
 * Agent update cohort record
 */
export interface AgentUpdateCohort {
  tenant: string;
  agent_id: string;
  cohort_percentage: number;
  assigned_at: Date;
}

/**
 * Rollout configuration
 */
export interface RolloutConfig {
  /** Rollout ID */
  rollout_id: string;
  /** Tenant ID */
  tenant: string;
  /** Target version */
  target_version: string;
  /** Platform (win32 or darwin) */
  platform: 'win32' | 'darwin';
  /** Current rollout percentage */
  current_percentage: number;
  /** Target rollout percentage */
  target_percentage: number;
  /** Rollout status */
  status: RolloutStatus;
  /** Increment percentage per step */
  step_percentage: number;
  /** Delay between steps in hours */
  step_delay_hours: number;
  /** Number of agents successfully updated */
  success_count: number;
  /** Number of agents that failed to update */
  failure_count: number;
  /** Maximum failure rate before auto-pause (0-1) */
  max_failure_rate: number;
  /** Created timestamp */
  created_at: Date;
  /** Last updated timestamp */
  updated_at: Date;
  /** Started timestamp */
  started_at?: Date;
  /** Completed timestamp */
  completed_at?: Date;
}

/**
 * Create rollout request
 */
export interface CreateRolloutRequest {
  tenant: string;
  target_version: string;
  platform: 'win32' | 'darwin';
  target_percentage?: number;
  step_percentage?: number;
  step_delay_hours?: number;
  max_failure_rate?: number;
}

/**
 * Calculate deterministic cohort value for an agent
 * Returns a value between 0 and 100
 */
export function calculateCohortValue(agentId: string): number {
  const hash = crypto.createHash('sha256').update(agentId).digest('hex');
  // Use first 8 hex chars for good distribution
  const hashNum = parseInt(hash.substring(0, 8), 16);
  // Normalize to 0-100 range
  return (hashNum / 0xffffffff) * 100;
}

/**
 * Check if an agent is included in the current rollout percentage
 */
export function isAgentInRollout(agentId: string, rolloutPercentage: number): boolean {
  if (rolloutPercentage >= 100) return true;
  if (rolloutPercentage <= 0) return false;

  const cohortValue = calculateCohortValue(agentId);
  return cohortValue < rolloutPercentage;
}

/**
 * Rollout manager for controlling staged updates
 */
export class UpdateRolloutManager {
  constructor(private db: Knex) {}

  /**
   * Create a new rollout
   */
  async createRollout(request: CreateRolloutRequest): Promise<RolloutConfig> {
    const rolloutId = crypto.randomUUID();

    const [rollout] = await this.db('rd_update_rollouts')
      .insert({
        rollout_id: rolloutId,
        tenant: request.tenant,
        target_version: request.target_version,
        platform: request.platform,
        current_percentage: 0,
        target_percentage: request.target_percentage ?? 100,
        status: 'pending',
        step_percentage: request.step_percentage ?? 10,
        step_delay_hours: request.step_delay_hours ?? 1,
        success_count: 0,
        failure_count: 0,
        max_failure_rate: request.max_failure_rate ?? 0.05, // 5% default
      })
      .returning('*');

    return rollout;
  }

  /**
   * Start a rollout
   */
  async startRollout(rolloutId: string): Promise<RolloutConfig> {
    const [rollout] = await this.db('rd_update_rollouts')
      .where({ rollout_id: rolloutId })
      .update({
        status: 'rolling_out',
        current_percentage: this.db.raw('step_percentage'),
        started_at: this.db.fn.now(),
        updated_at: this.db.fn.now(),
      })
      .returning('*');

    return rollout;
  }

  /**
   * Advance rollout to next step
   */
  async advanceRollout(rolloutId: string): Promise<RolloutConfig> {
    const rollout = await this.getRollout(rolloutId);
    if (!rollout) throw new Error('Rollout not found');
    if (rollout.status !== 'rolling_out') throw new Error('Rollout not active');

    const newPercentage = Math.min(
      rollout.current_percentage + rollout.step_percentage,
      rollout.target_percentage
    );

    const status = newPercentage >= rollout.target_percentage ? 'completed' : 'rolling_out';

    const [updated] = await this.db('rd_update_rollouts')
      .where({ rollout_id: rolloutId })
      .update({
        current_percentage: newPercentage,
        status,
        completed_at: status === 'completed' ? this.db.fn.now() : null,
        updated_at: this.db.fn.now(),
      })
      .returning('*');

    return updated;
  }

  /**
   * Pause a rollout
   */
  async pauseRollout(rolloutId: string, reason?: string): Promise<RolloutConfig> {
    const [rollout] = await this.db('rd_update_rollouts')
      .where({ rollout_id: rolloutId })
      .update({
        status: 'paused',
        updated_at: this.db.fn.now(),
      })
      .returning('*');

    return rollout;
  }

  /**
   * Resume a paused rollout
   */
  async resumeRollout(rolloutId: string): Promise<RolloutConfig> {
    const [rollout] = await this.db('rd_update_rollouts')
      .where({ rollout_id: rolloutId, status: 'paused' })
      .update({
        status: 'rolling_out',
        updated_at: this.db.fn.now(),
      })
      .returning('*');

    return rollout;
  }

  /**
   * Cancel a rollout
   */
  async cancelRollout(rolloutId: string): Promise<RolloutConfig> {
    const [rollout] = await this.db('rd_update_rollouts')
      .where({ rollout_id: rolloutId })
      .update({
        status: 'cancelled',
        updated_at: this.db.fn.now(),
      })
      .returning('*');

    return rollout;
  }

  /**
   * Get rollout by ID
   */
  async getRollout(rolloutId: string): Promise<RolloutConfig | null> {
    const rollout = await this.db('rd_update_rollouts')
      .where({ rollout_id: rolloutId })
      .first();

    return rollout || null;
  }

  /**
   * Get active rollout for a platform
   */
  async getActiveRollout(
    tenant: string,
    platform: 'win32' | 'darwin'
  ): Promise<RolloutConfig | null> {
    const rollout = await this.db('rd_update_rollouts')
      .where({ tenant, platform })
      .whereIn('status', ['pending', 'rolling_out', 'paused'])
      .orderBy('created_at', 'desc')
      .first();

    return rollout || null;
  }

  /**
   * Record a successful update
   */
  async recordUpdateSuccess(rolloutId: string): Promise<void> {
    await this.db('rd_update_rollouts')
      .where({ rollout_id: rolloutId })
      .increment('success_count', 1);
  }

  /**
   * Record a failed update and check if rollout should be paused
   */
  async recordUpdateFailure(rolloutId: string): Promise<{ paused: boolean }> {
    await this.db('rd_update_rollouts')
      .where({ rollout_id: rolloutId })
      .increment('failure_count', 1);

    // Check failure rate
    const rollout = await this.getRollout(rolloutId);
    if (!rollout) return { paused: false };

    const totalAttempts = rollout.success_count + rollout.failure_count;
    if (totalAttempts < 10) return { paused: false }; // Need minimum sample size

    const failureRate = rollout.failure_count / totalAttempts;

    if (failureRate > rollout.max_failure_rate) {
      await this.pauseRollout(rolloutId, `Failure rate ${(failureRate * 100).toFixed(1)}% exceeded threshold`);
      return { paused: true };
    }

    return { paused: false };
  }

  /**
   * Check if an agent should receive an update based on active rollout
   */
  async shouldAgentUpdate(
    tenant: string,
    agentId: string,
    platform: 'win32' | 'darwin',
    currentVersion: string
  ): Promise<{ shouldUpdate: boolean; targetVersion?: string; rolloutId?: string }> {
    const rollout = await this.getActiveRollout(tenant, platform);

    if (!rollout || rollout.status !== 'rolling_out') {
      return { shouldUpdate: false };
    }

    // Check if agent is in current rollout percentage
    if (!isAgentInRollout(agentId, rollout.current_percentage)) {
      return { shouldUpdate: false };
    }

    // Check if agent already has target version
    if (currentVersion === rollout.target_version) {
      return { shouldUpdate: false };
    }

    return {
      shouldUpdate: true,
      targetVersion: rollout.target_version,
      rolloutId: rollout.rollout_id,
    };
  }

  /**
   * List rollouts for a tenant
   */
  async listRollouts(
    tenant: string,
    options: { platform?: 'win32' | 'darwin'; status?: RolloutStatus; limit?: number } = {}
  ): Promise<RolloutConfig[]> {
    let query = this.db('rd_update_rollouts')
      .where({ tenant })
      .orderBy('created_at', 'desc');

    if (options.platform) {
      query = query.where({ platform: options.platform });
    }

    if (options.status) {
      query = query.where({ status: options.status });
    }

    if (options.limit) {
      query = query.limit(options.limit);
    }

    return query;
  }

  /**
   * Get rollout statistics
   */
  async getRolloutStats(rolloutId: string): Promise<{
    rollout: RolloutConfig;
    agentsEligible: number;
    agentsUpdated: number;
    agentsPending: number;
  } | null> {
    const rollout = await this.getRollout(rolloutId);
    if (!rollout) return null;

    // Count agents that would be in current cohort
    const [eligibleResult] = await this.db('rd_agents')
      .where({ tenant: rollout.tenant })
      .where('os_type', rollout.platform === 'win32' ? 'windows' : 'macos')
      .count('* as count');

    const agentsEligible = parseInt((eligibleResult as any).count || '0', 10);

    // Count agents already at target version
    const [updatedResult] = await this.db('rd_agents')
      .where({ tenant: rollout.tenant })
      .where('os_type', rollout.platform === 'win32' ? 'windows' : 'macos')
      .where('agent_version', rollout.target_version)
      .count('* as count');

    const agentsUpdated = parseInt((updatedResult as any).count || '0', 10);

    return {
      rollout,
      agentsEligible,
      agentsUpdated,
      agentsPending: agentsEligible - agentsUpdated,
    };
  }
}
