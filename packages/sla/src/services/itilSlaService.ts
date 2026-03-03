/**
 * ITIL SLA Policy Auto-Configuration Service
 *
 * Automatically creates and assigns "ITIL Standard" SLA policy when a board
 * is configured with priority_type = 'itil'.
 */

import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { ISlaPolicy, ISlaPolicyTarget } from '../types';

/**
 * ITIL Priority levels and their standard SLA targets.
 * These match the values in server/src/lib/utils/itilUtils.ts
 */
const ITIL_SLA_TARGETS: Record<number, { response: number; resolution: number; is_24x7: boolean }> = {
  1: { response: 15, resolution: 60, is_24x7: true },      // Critical: 15min response, 1hr resolution, 24/7
  2: { response: 30, resolution: 240, is_24x7: false },    // High: 30min response, 4hr resolution
  3: { response: 60, resolution: 1440, is_24x7: false },   // Medium: 1hr response, 24hr resolution
  4: { response: 240, resolution: 4320, is_24x7: false },  // Low: 4hr response, 72hr resolution
  5: { response: 480, resolution: 10080, is_24x7: false }  // Planning: 8hr response, 1 week resolution
};

const ITIL_POLICY_NAME = 'ITIL Standard';
const ITIL_POLICY_DESCRIPTION = 'Industry-standard SLA targets for ITIL priority levels. Auto-created when using ITIL priority mode.';

export interface CreateItilSlaPolicyResult {
  policy: ISlaPolicy;
  targets: ISlaPolicyTarget[];
  created: boolean; // true if newly created, false if existing
}

/**
 * Creates or retrieves the "ITIL Standard" SLA policy for a tenant.
 * If the policy already exists, returns it without modification.
 * If creating new, sets up targets for all ITIL priority levels.
 *
 * @param trx - Knex transaction
 * @param tenant - Tenant ID
 * @returns The ITIL Standard SLA policy and its targets
 */
export async function createItilStandardSlaPolicy(
  trx: Knex.Transaction,
  tenant: string
): Promise<CreateItilSlaPolicyResult> {
  // Check if ITIL Standard policy already exists
  const existingPolicy = await trx('sla_policies')
    .where({ tenant, policy_name: ITIL_POLICY_NAME })
    .first();

  if (existingPolicy) {
    console.log(`[ItilSlaService] ITIL Standard policy already exists for tenant ${tenant}`);

    // Get existing targets
    const targets = await trx('sla_policy_targets')
      .where({ tenant, sla_policy_id: existingPolicy.sla_policy_id })
      .select('*') as ISlaPolicyTarget[];

    return {
      policy: existingPolicy as ISlaPolicy,
      targets,
      created: false
    };
  }

  console.log(`[ItilSlaService] Creating ITIL Standard SLA policy for tenant ${tenant}`);

  // Create the policy
  const policyId = uuidv4();
  const [newPolicy] = await trx('sla_policies')
    .insert({
      tenant,
      sla_policy_id: policyId,
      policy_name: ITIL_POLICY_NAME,
      description: ITIL_POLICY_DESCRIPTION,
      is_default: false, // Don't override existing default
      business_hours_schedule_id: null, // Will use default or be configured later
      created_at: trx.fn.now(),
      updated_at: trx.fn.now()
    })
    .returning('*');

  // Create default notification thresholds
  const defaultThresholds = [
    { threshold_percent: 50, notification_type: 'warning', notify_assignee: true, notify_board_manager: false, notify_escalation_manager: false, channels: ['in_app'] },
    { threshold_percent: 75, notification_type: 'warning', notify_assignee: true, notify_board_manager: true, notify_escalation_manager: false, channels: ['in_app'] },
    { threshold_percent: 90, notification_type: 'warning', notify_assignee: true, notify_board_manager: true, notify_escalation_manager: true, channels: ['in_app', 'email'] },
    { threshold_percent: 100, notification_type: 'breach', notify_assignee: true, notify_board_manager: true, notify_escalation_manager: true, channels: ['in_app', 'email'] }
  ];

  const thresholdInserts = defaultThresholds.map(threshold => ({
    tenant,
    threshold_id: uuidv4(),
    sla_policy_id: policyId,
    threshold_percent: threshold.threshold_percent,
    notification_type: threshold.notification_type,
    notify_assignee: threshold.notify_assignee,
    notify_board_manager: threshold.notify_board_manager,
    notify_escalation_manager: threshold.notify_escalation_manager,
    channels: threshold.channels,
    created_at: trx.fn.now()
  }));

  await trx('sla_notification_thresholds').insert(thresholdInserts);

  // Get ITIL priorities from tenant's priorities table
  const itilPriorities = await trx('priorities')
    .where({ tenant, is_from_itil_standard: true, item_type: 'ticket' })
    .select('priority_id', 'itil_priority_level', 'priority_name')
    .orderBy('itil_priority_level', 'asc');

  console.log(`[ItilSlaService] Found ${itilPriorities.length} ITIL priorities for tenant ${tenant}`);

  // Create SLA targets for each ITIL priority
  const targets: ISlaPolicyTarget[] = [];

  for (const priority of itilPriorities) {
    const level = priority.itil_priority_level;
    const slaTarget = ITIL_SLA_TARGETS[level];

    if (!slaTarget) {
      console.warn(`[ItilSlaService] No SLA target defined for ITIL level ${level}`);
      continue;
    }

    const targetId = uuidv4();
    const [newTarget] = await trx('sla_policy_targets')
      .insert({
        tenant,
        target_id: targetId,
        sla_policy_id: policyId,
        priority_id: priority.priority_id,
        response_time_minutes: slaTarget.response,
        resolution_time_minutes: slaTarget.resolution,
        escalation_1_percent: 70,
        escalation_2_percent: 90,
        escalation_3_percent: 110,
        is_24x7: slaTarget.is_24x7,
        created_at: trx.fn.now(),
        updated_at: trx.fn.now()
      })
      .returning('*');

    targets.push(newTarget as ISlaPolicyTarget);
    console.log(`[ItilSlaService] Created target for ${priority.priority_name}: ${slaTarget.response}min response, ${slaTarget.resolution}min resolution`);
  }

  console.log(`[ItilSlaService] Created ITIL Standard SLA policy with ${targets.length} targets`);

  return {
    policy: newPolicy as ISlaPolicy,
    targets,
    created: true
  };
}

/**
 * Assigns an SLA policy to a board.
 *
 * @param trx - Knex transaction
 * @param tenant - Tenant ID
 * @param boardId - Board ID to assign policy to
 * @param policyId - SLA Policy ID to assign
 */
export async function assignSlaPolicyToBoard(
  trx: Knex.Transaction,
  tenant: string,
  boardId: string,
  policyId: string
): Promise<void> {
  await trx('boards')
    .where({ tenant, board_id: boardId })
    .update({
      sla_policy_id: policyId,
      updated_at: trx.fn.now()
    });

  console.log(`[ItilSlaService] Assigned SLA policy ${policyId} to board ${boardId}`);
}

/**
 * Creates ITIL Standard SLA policy and assigns it to a board.
 * This is the main entry point called from ItilStandardsService.
 *
 * @param trx - Knex transaction
 * @param tenant - Tenant ID
 * @param boardId - Board ID to configure
 * @returns The created/existing policy
 */
export async function configureItilSlaForBoard(
  trx: Knex.Transaction,
  tenant: string,
  boardId: string
): Promise<CreateItilSlaPolicyResult> {
  // Create or get the ITIL Standard policy
  const result = await createItilStandardSlaPolicy(trx, tenant);

  // Check if board already has an SLA policy assigned
  const board = await trx('boards')
    .where({ tenant, board_id: boardId })
    .select('sla_policy_id')
    .first();

  if (!board?.sla_policy_id) {
    // Only auto-assign if no policy is already set
    await assignSlaPolicyToBoard(trx, tenant, boardId, result.policy.sla_policy_id);
  } else {
    console.log(`[ItilSlaService] Board ${boardId} already has SLA policy assigned, skipping auto-assignment`);
  }

  return result;
}
