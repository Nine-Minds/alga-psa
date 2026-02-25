/**
 * SLA Policy Hierarchy Unit Tests
 *
 * Tests for SLA policy resolution hierarchy:
 * - Client policy takes precedence over board policy
 * - Board policy takes precedence over tenant default
 * - Tenant default used when no client or board policy
 * - Returns null when no policies configured at any level
 * - Policy with matching priority returns correct target
 * - Handles missing client/board inputs gracefully
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Knex } from 'knex';
import type {
  ISlaPolicy,
  ISlaPolicyTarget,
  ISlaPolicyWithTargets,
} from '@alga-psa/sla/types';

// ============================================================================
// Test Helpers - Mock Transaction Builder
// ============================================================================

interface MockDataStore {
  clients: Record<string, { sla_policy_id: string | null }>;
  boards: Record<string, { sla_policy_id: string | null }>;
  sla_policies: Record<string, ISlaPolicy>;
  sla_policy_targets: ISlaPolicyTarget[];
  default_policy: ISlaPolicy | null;
}

function createMockTrx(data: MockDataStore) {
  const createChain = (table: string) => {
    const chain: any = {
      _conditions: {} as Record<string, any>,
      where: vi.fn().mockImplementation((conditions) => {
        if (typeof conditions === 'object') {
          Object.assign(chain._conditions, conditions);
        }
        return chain;
      }),
      select: vi.fn().mockReturnThis(),
      first: vi.fn().mockImplementation(() => {
        if (table === 'clients') {
          const clientId = chain._conditions.client_id;
          return Promise.resolve(data.clients[clientId] || null);
        }
        if (table === 'boards') {
          const boardId = chain._conditions.board_id;
          return Promise.resolve(data.boards[boardId] || null);
        }
        if (table === 'sla_policies') {
          const policyId = chain._conditions.sla_policy_id;
          if (policyId) {
            return Promise.resolve(data.sla_policies[policyId] || null);
          }
          if (chain._conditions.is_default === true) {
            return Promise.resolve(data.default_policy);
          }
          return Promise.resolve(null);
        }
        return Promise.resolve(null);
      }),
      then: vi.fn().mockImplementation((callback) => {
        if (table === 'sla_policy_targets') {
          const policyId = chain._conditions.sla_policy_id;
          const targets = data.sla_policy_targets.filter(t => t.sla_policy_id === policyId);
          return Promise.resolve(targets).then(callback);
        }
        return Promise.resolve([]).then(callback);
      }),
    };

    // Make the chain thenable for array queries
    if (table === 'sla_policy_targets') {
      const originalFirst = chain.first;
      chain.first = undefined;
      (chain as any)[Symbol.toStringTag] = 'Promise';
    }

    return chain;
  };

  return ((table: string) => createChain(table)) as unknown as Knex.Transaction;
}

// ============================================================================
// Pure Logic Policy Resolver (mimics resolveSlaPolicy logic for unit testing)
// ============================================================================

interface PolicyResolutionInput {
  tenant: string;
  clientId: string | null;
  boardId: string | null;
  priorityId: string | null;
}

interface PolicyResolutionResult {
  policy: ISlaPolicyWithTargets | null;
  target: ISlaPolicyTarget | null;
  resolvedFrom: 'client' | 'board' | 'default' | null;
}

/**
 * Pure function that resolves SLA policy based on hierarchy:
 * 1. Client-specific policy
 * 2. Board-specific policy
 * 3. Tenant default policy
 */
function resolveSlaPolicy(
  clientPolicy: ISlaPolicyWithTargets | null,
  boardPolicy: ISlaPolicyWithTargets | null,
  defaultPolicy: ISlaPolicyWithTargets | null,
  priorityId: string | null
): PolicyResolutionResult {
  let policy: ISlaPolicyWithTargets | null = null;
  let resolvedFrom: 'client' | 'board' | 'default' | null = null;

  // 1. Check client-specific policy first
  if (clientPolicy) {
    policy = clientPolicy;
    resolvedFrom = 'client';
  }
  // 2. Fall back to board-specific policy
  else if (boardPolicy) {
    policy = boardPolicy;
    resolvedFrom = 'board';
  }
  // 3. Fall back to tenant default
  else if (defaultPolicy) {
    policy = defaultPolicy;
    resolvedFrom = 'default';
  }

  if (!policy) {
    return { policy: null, target: null, resolvedFrom: null };
  }

  // Find target for the priority
  const target = priorityId
    ? policy.targets.find(t => t.priority_id === priorityId) || null
    : null;

  return { policy, target, resolvedFrom };
}

/**
 * Create a mock policy with targets
 */
function createMockPolicy(
  policyId: string,
  name: string,
  isDefault: boolean,
  targets: Partial<ISlaPolicyTarget>[] = []
): ISlaPolicyWithTargets {
  return {
    sla_policy_id: policyId,
    policy_name: name,
    is_default: isDefault,
    targets: targets.map((t, i) => ({
      target_id: `target-${policyId}-${i}`,
      sla_policy_id: policyId,
      priority_id: t.priority_id || `priority-${i}`,
      response_time_minutes: t.response_time_minutes ?? 60,
      resolution_time_minutes: t.resolution_time_minutes ?? 480,
      escalation_1_percent: t.escalation_1_percent ?? 50,
      escalation_2_percent: t.escalation_2_percent ?? 75,
      escalation_3_percent: t.escalation_3_percent ?? 90,
      is_24x7: t.is_24x7 ?? false,
    })),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('SLA Policy Hierarchy', () => {
  const TENANT_ID = '00000000-0000-0000-0000-000000000001';
  const CLIENT_ID = '00000000-0000-0000-0000-000000000002';
  const BOARD_ID = '00000000-0000-0000-0000-000000000003';
  const PRIORITY_HIGH = '00000000-0000-0000-0000-000000000004';
  const PRIORITY_NORMAL = '00000000-0000-0000-0000-000000000005';
  const PRIORITY_LOW = '00000000-0000-0000-0000-000000000006';

  describe('Client policy takes precedence over board policy', () => {
    it('should use client policy when both client and board have policies', () => {
      const clientPolicy = createMockPolicy('client-policy', 'Client Premium SLA', false, [
        { priority_id: PRIORITY_HIGH, response_time_minutes: 15 },
      ]);
      const boardPolicy = createMockPolicy('board-policy', 'Board Standard SLA', false, [
        { priority_id: PRIORITY_HIGH, response_time_minutes: 60 },
      ]);
      const defaultPolicy = createMockPolicy('default-policy', 'Default SLA', true, [
        { priority_id: PRIORITY_HIGH, response_time_minutes: 120 },
      ]);

      const result = resolveSlaPolicy(clientPolicy, boardPolicy, defaultPolicy, PRIORITY_HIGH);

      expect(result.policy).not.toBeNull();
      expect(result.policy!.sla_policy_id).toBe('client-policy');
      expect(result.resolvedFrom).toBe('client');
      expect(result.target?.response_time_minutes).toBe(15);
    });

    it('should use client policy even when board and default exist', () => {
      const clientPolicy = createMockPolicy('client-policy', 'Enterprise SLA', false, [
        { priority_id: PRIORITY_NORMAL, response_time_minutes: 30 },
      ]);
      const boardPolicy = createMockPolicy('board-policy', 'IT Board SLA', false, [
        { priority_id: PRIORITY_NORMAL, response_time_minutes: 90 },
      ]);
      const defaultPolicy = createMockPolicy('default-policy', 'Default SLA', true, [
        { priority_id: PRIORITY_NORMAL, response_time_minutes: 180 },
      ]);

      const result = resolveSlaPolicy(clientPolicy, boardPolicy, defaultPolicy, PRIORITY_NORMAL);

      expect(result.resolvedFrom).toBe('client');
      expect(result.target?.response_time_minutes).toBe(30);
    });

    it('should use client policy when client has policy but board does not', () => {
      const clientPolicy = createMockPolicy('client-policy', 'VIP Client SLA', false, [
        { priority_id: PRIORITY_HIGH, response_time_minutes: 10 },
      ]);

      const result = resolveSlaPolicy(clientPolicy, null, null, PRIORITY_HIGH);

      expect(result.policy).not.toBeNull();
      expect(result.resolvedFrom).toBe('client');
    });
  });

  describe('Board policy takes precedence over tenant default', () => {
    it('should use board policy when no client policy exists', () => {
      const boardPolicy = createMockPolicy('board-policy', 'Support Board SLA', false, [
        { priority_id: PRIORITY_HIGH, response_time_minutes: 45 },
      ]);
      const defaultPolicy = createMockPolicy('default-policy', 'Default SLA', true, [
        { priority_id: PRIORITY_HIGH, response_time_minutes: 120 },
      ]);

      const result = resolveSlaPolicy(null, boardPolicy, defaultPolicy, PRIORITY_HIGH);

      expect(result.policy).not.toBeNull();
      expect(result.policy!.sla_policy_id).toBe('board-policy');
      expect(result.resolvedFrom).toBe('board');
      expect(result.target?.response_time_minutes).toBe(45);
    });

    it('should use board policy when client exists but has no policy', () => {
      const boardPolicy = createMockPolicy('board-policy', 'Engineering Board SLA', false, [
        { priority_id: PRIORITY_NORMAL, response_time_minutes: 60 },
      ]);
      const defaultPolicy = createMockPolicy('default-policy', 'Default SLA', true, [
        { priority_id: PRIORITY_NORMAL, response_time_minutes: 240 },
      ]);

      const result = resolveSlaPolicy(null, boardPolicy, defaultPolicy, PRIORITY_NORMAL);

      expect(result.resolvedFrom).toBe('board');
      expect(result.target?.response_time_minutes).toBe(60);
    });
  });

  describe('Tenant default used when no client or board policy', () => {
    it('should use tenant default when no client or board policy exists', () => {
      const defaultPolicy = createMockPolicy('default-policy', 'Tenant Default SLA', true, [
        { priority_id: PRIORITY_HIGH, response_time_minutes: 90 },
      ]);

      const result = resolveSlaPolicy(null, null, defaultPolicy, PRIORITY_HIGH);

      expect(result.policy).not.toBeNull();
      expect(result.policy!.sla_policy_id).toBe('default-policy');
      expect(result.resolvedFrom).toBe('default');
      expect(result.target?.response_time_minutes).toBe(90);
    });

    it('should use tenant default when client and board exist but have no policies', () => {
      const defaultPolicy = createMockPolicy('default-policy', 'Company Wide SLA', true, [
        { priority_id: PRIORITY_LOW, response_time_minutes: 240 },
      ]);

      const result = resolveSlaPolicy(null, null, defaultPolicy, PRIORITY_LOW);

      expect(result.resolvedFrom).toBe('default');
    });
  });

  describe('Returns null when no policies configured at any level', () => {
    it('should return null policy when no policies exist', () => {
      const result = resolveSlaPolicy(null, null, null, PRIORITY_HIGH);

      expect(result.policy).toBeNull();
      expect(result.target).toBeNull();
      expect(result.resolvedFrom).toBeNull();
    });

    it('should return null policy and target when nothing is configured', () => {
      const result = resolveSlaPolicy(null, null, null, null);

      expect(result.policy).toBeNull();
      expect(result.target).toBeNull();
      expect(result.resolvedFrom).toBeNull();
    });
  });

  describe('Policy with matching priority returns correct target', () => {
    it('should return correct target for high priority', () => {
      const policy = createMockPolicy('policy', 'Multi-Priority SLA', true, [
        { priority_id: PRIORITY_HIGH, response_time_minutes: 15, resolution_time_minutes: 120 },
        { priority_id: PRIORITY_NORMAL, response_time_minutes: 60, resolution_time_minutes: 480 },
        { priority_id: PRIORITY_LOW, response_time_minutes: 240, resolution_time_minutes: 1440 },
      ]);

      const result = resolveSlaPolicy(null, null, policy, PRIORITY_HIGH);

      expect(result.target).not.toBeNull();
      expect(result.target!.priority_id).toBe(PRIORITY_HIGH);
      expect(result.target!.response_time_minutes).toBe(15);
      expect(result.target!.resolution_time_minutes).toBe(120);
    });

    it('should return correct target for normal priority', () => {
      const policy = createMockPolicy('policy', 'Multi-Priority SLA', true, [
        { priority_id: PRIORITY_HIGH, response_time_minutes: 15 },
        { priority_id: PRIORITY_NORMAL, response_time_minutes: 60 },
        { priority_id: PRIORITY_LOW, response_time_minutes: 240 },
      ]);

      const result = resolveSlaPolicy(null, null, policy, PRIORITY_NORMAL);

      expect(result.target!.priority_id).toBe(PRIORITY_NORMAL);
      expect(result.target!.response_time_minutes).toBe(60);
    });

    it('should return correct target for low priority', () => {
      const policy = createMockPolicy('policy', 'Multi-Priority SLA', true, [
        { priority_id: PRIORITY_HIGH, response_time_minutes: 15 },
        { priority_id: PRIORITY_NORMAL, response_time_minutes: 60 },
        { priority_id: PRIORITY_LOW, response_time_minutes: 240 },
      ]);

      const result = resolveSlaPolicy(null, null, policy, PRIORITY_LOW);

      expect(result.target!.priority_id).toBe(PRIORITY_LOW);
      expect(result.target!.response_time_minutes).toBe(240);
    });

    it('should return null target when priority not found in policy', () => {
      const policy = createMockPolicy('policy', 'Limited Priority SLA', true, [
        { priority_id: PRIORITY_HIGH, response_time_minutes: 15 },
        // PRIORITY_NORMAL and PRIORITY_LOW not configured
      ]);
      const UNKNOWN_PRIORITY = '00000000-0000-0000-0000-000000000099';

      const result = resolveSlaPolicy(null, null, policy, UNKNOWN_PRIORITY);

      expect(result.policy).not.toBeNull();
      expect(result.target).toBeNull();
    });

    it('should return null target when priorityId is null', () => {
      const policy = createMockPolicy('policy', 'SLA Policy', true, [
        { priority_id: PRIORITY_HIGH, response_time_minutes: 15 },
      ]);

      const result = resolveSlaPolicy(null, null, policy, null);

      expect(result.policy).not.toBeNull();
      expect(result.target).toBeNull();
    });

    it('should return policy but null target when policy has no targets', () => {
      const policy = createMockPolicy('policy', 'Empty Targets SLA', true, []);

      const result = resolveSlaPolicy(null, null, policy, PRIORITY_HIGH);

      expect(result.policy).not.toBeNull();
      expect(result.target).toBeNull();
    });
  });

  describe('Handles missing client/board inputs gracefully', () => {
    it('should handle null clientId gracefully', () => {
      const boardPolicy = createMockPolicy('board-policy', 'Board SLA', false, [
        { priority_id: PRIORITY_HIGH, response_time_minutes: 30 },
      ]);
      const defaultPolicy = createMockPolicy('default-policy', 'Default SLA', true, [
        { priority_id: PRIORITY_HIGH, response_time_minutes: 60 },
      ]);

      // When clientId is null, clientPolicy would be null
      const result = resolveSlaPolicy(null, boardPolicy, defaultPolicy, PRIORITY_HIGH);

      expect(result.policy).not.toBeNull();
      expect(result.resolvedFrom).toBe('board');
    });

    it('should handle null boardId gracefully', () => {
      const clientPolicy = createMockPolicy('client-policy', 'Client SLA', false, [
        { priority_id: PRIORITY_HIGH, response_time_minutes: 20 },
      ]);
      const defaultPolicy = createMockPolicy('default-policy', 'Default SLA', true, [
        { priority_id: PRIORITY_HIGH, response_time_minutes: 60 },
      ]);

      // When boardId is null, boardPolicy would be null
      const result = resolveSlaPolicy(clientPolicy, null, defaultPolicy, PRIORITY_HIGH);

      expect(result.policy).not.toBeNull();
      expect(result.resolvedFrom).toBe('client');
    });

    it('should handle both null client and board gracefully', () => {
      const defaultPolicy = createMockPolicy('default-policy', 'Default SLA', true, [
        { priority_id: PRIORITY_NORMAL, response_time_minutes: 60 },
      ]);

      const result = resolveSlaPolicy(null, null, defaultPolicy, PRIORITY_NORMAL);

      expect(result.resolvedFrom).toBe('default');
    });

    it('should handle all inputs null gracefully', () => {
      const result = resolveSlaPolicy(null, null, null, null);

      expect(result.policy).toBeNull();
      expect(result.target).toBeNull();
      expect(result.resolvedFrom).toBeNull();
    });
  });

  describe('Target properties', () => {
    it('should return target with all properties', () => {
      const policy = createMockPolicy('policy', 'Full SLA', true, [
        {
          priority_id: PRIORITY_HIGH,
          response_time_minutes: 15,
          resolution_time_minutes: 120,
          escalation_1_percent: 50,
          escalation_2_percent: 75,
          escalation_3_percent: 90,
          is_24x7: true,
        },
      ]);

      const result = resolveSlaPolicy(null, null, policy, PRIORITY_HIGH);

      expect(result.target).not.toBeNull();
      expect(result.target!.response_time_minutes).toBe(15);
      expect(result.target!.resolution_time_minutes).toBe(120);
      expect(result.target!.escalation_1_percent).toBe(50);
      expect(result.target!.escalation_2_percent).toBe(75);
      expect(result.target!.escalation_3_percent).toBe(90);
      expect(result.target!.is_24x7).toBe(true);
    });

    it('should return target with 24x7 false for business hours target', () => {
      const policy = createMockPolicy('policy', 'Business Hours SLA', true, [
        {
          priority_id: PRIORITY_HIGH,
          response_time_minutes: 60,
          is_24x7: false,
        },
      ]);

      const result = resolveSlaPolicy(null, null, policy, PRIORITY_HIGH);

      expect(result.target!.is_24x7).toBe(false);
    });

    it('should handle target with null optional fields', () => {
      const policy: ISlaPolicyWithTargets = {
        sla_policy_id: 'policy',
        policy_name: 'Minimal SLA',
        is_default: true,
        targets: [
          {
            target_id: 'target-1',
            sla_policy_id: 'policy',
            priority_id: PRIORITY_HIGH,
            response_time_minutes: null,
            resolution_time_minutes: 120,
            escalation_1_percent: 50,
            escalation_2_percent: 75,
            escalation_3_percent: 90,
            is_24x7: false,
          },
        ],
      };

      const result = resolveSlaPolicy(null, null, policy, PRIORITY_HIGH);

      expect(result.target).not.toBeNull();
      expect(result.target!.response_time_minutes).toBeNull();
      expect(result.target!.resolution_time_minutes).toBe(120);
    });
  });

  describe('Complex hierarchy scenarios', () => {
    it('should correctly resolve when client has different targets than board', () => {
      const clientPolicy = createMockPolicy('client-policy', 'Client Custom SLA', false, [
        { priority_id: PRIORITY_HIGH, response_time_minutes: 10 },
        // No normal or low priority defined for client
      ]);
      const boardPolicy = createMockPolicy('board-policy', 'Board Full SLA', false, [
        { priority_id: PRIORITY_HIGH, response_time_minutes: 30 },
        { priority_id: PRIORITY_NORMAL, response_time_minutes: 60 },
        { priority_id: PRIORITY_LOW, response_time_minutes: 120 },
      ]);

      // High priority - client has target
      const resultHigh = resolveSlaPolicy(clientPolicy, boardPolicy, null, PRIORITY_HIGH);
      expect(resultHigh.resolvedFrom).toBe('client');
      expect(resultHigh.target?.response_time_minutes).toBe(10);

      // Normal priority - client policy wins but no target for this priority
      const resultNormal = resolveSlaPolicy(clientPolicy, boardPolicy, null, PRIORITY_NORMAL);
      expect(resultNormal.resolvedFrom).toBe('client');
      expect(resultNormal.target).toBeNull(); // Client policy has no target for normal
    });

    it('should use board policy when client exists but has no SLA policy configured', () => {
      // This simulates a client record existing but with sla_policy_id = null
      const boardPolicy = createMockPolicy('board-policy', 'Board SLA', false, [
        { priority_id: PRIORITY_HIGH, response_time_minutes: 45 },
      ]);
      const defaultPolicy = createMockPolicy('default-policy', 'Default SLA', true, [
        { priority_id: PRIORITY_HIGH, response_time_minutes: 90 },
      ]);

      // clientPolicy is null because client.sla_policy_id was null
      const result = resolveSlaPolicy(null, boardPolicy, defaultPolicy, PRIORITY_HIGH);

      expect(result.resolvedFrom).toBe('board');
      expect(result.target?.response_time_minutes).toBe(45);
    });

    it('should handle policy with mixed 24x7 and business hours targets', () => {
      const policy = createMockPolicy('policy', 'Mixed SLA', true, [
        { priority_id: PRIORITY_HIGH, response_time_minutes: 15, is_24x7: true },
        { priority_id: PRIORITY_NORMAL, response_time_minutes: 60, is_24x7: false },
      ]);

      const resultHigh = resolveSlaPolicy(null, null, policy, PRIORITY_HIGH);
      expect(resultHigh.target!.is_24x7).toBe(true);

      const resultNormal = resolveSlaPolicy(null, null, policy, PRIORITY_NORMAL);
      expect(resultNormal.target!.is_24x7).toBe(false);
    });
  });
});
