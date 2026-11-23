/**
 * ITIL SLA Policy Auto-Configuration Service
 *
 * Automatically creates and assigns "ITIL Standard" SLA policy when a board
 * is configured with priority_type = 'itil'.
 */

import { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { v4 as uuidv4 } from 'uuid';
import {
  ITIL_SLA_ESCALATION_PERCENTS,
  ITIL_SLA_NOTIFICATION_THRESHOLDS,
  ITIL_SLA_POLICY_DESCRIPTION,
  ITIL_SLA_POLICY_NAME,
  ITIL_SLA_TARGETS,
} from '@alga-psa/shared/lib/sla/itilSlaDefaults';
import { ISlaPolicy, ISlaPolicyTarget } from '../types';

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
  const scopedDb = tenantDb(trx, tenant);

  // F125: the policy this product created for ITIL priorities is the flagged one. Its *name* is
  // the tenant's to change, and a tenant's own policy may happen to carry the same name — matching
  // on it created a second policy after a rename and adopted a policy that was never ours.
  const existingPolicy = await scopedDb.table('sla_policies')
    .where({ is_itil_standard: true })
    .first();

  if (existingPolicy) {
    console.log(`[ItilSlaService] ITIL Standard policy already exists for tenant ${tenant}`);

    // F126: the policy stays as the tenant configured it; only a priority with no target of its
    // own gets one, so re-created ITIL priorities are covered and edited targets are left alone.
    const targets = await topUpItilSlaTargets(trx, tenant, existingPolicy.sla_policy_id);

    return {
      policy: existingPolicy as ISlaPolicy,
      targets,
      created: false
    };
  }

  console.log(`[ItilSlaService] Creating ITIL Standard SLA policy for tenant ${tenant}`);

  // Create the policy
  const policyId = uuidv4();
  const [newPolicy] = await scopedDb.table('sla_policies')
    .insert({
      tenant,
      sla_policy_id: policyId,
      policy_name: ITIL_SLA_POLICY_NAME,
      description: ITIL_SLA_POLICY_DESCRIPTION,
      is_itil_standard: true,
      is_default: false, // Don't override existing default
      business_hours_schedule_id: null, // Will use default or be configured later
      created_at: trx.fn.now(),
      updated_at: trx.fn.now()
    })
    .returning('*');

  // The thresholds and the targets below come from the one shared definition, which the product
  // upgrade's `ensureSlaParity` also uses (F127), so the two writers cannot disagree.
  const thresholdInserts = ITIL_SLA_NOTIFICATION_THRESHOLDS.map(threshold => ({
    tenant,
    threshold_id: uuidv4(),
    sla_policy_id: policyId,
    threshold_percent: threshold.threshold_percent,
    notification_type: threshold.notification_type,
    notify_assignee: threshold.notify_assignee,
    notify_board_manager: threshold.notify_board_manager,
    notify_escalation_manager: threshold.notify_escalation_manager,
    channels: [...threshold.channels],
    created_at: trx.fn.now()
  }));

  await scopedDb.table('sla_notification_thresholds').insert(thresholdInserts);

  const targets = await topUpItilSlaTargets(trx, tenant, policyId);

  console.log(`[ItilSlaService] Created ITIL Standard SLA policy with ${targets.length} targets`);

  return {
    policy: newPolicy as ISlaPolicy,
    targets,
    created: true
  };
}

/**
 * F126: give every ITIL priority of the tenant a target on this policy, and leave every target
 * that already exists exactly as it is.
 *
 * This is what makes a second ITIL board useful on a tenant whose ITIL priorities were re-created
 * (the old rows were deleted with the last ITIL board, so the policy's targets pointed at
 * priorities that no longer exist), without undoing an admin's edits to the times.
 */
export async function topUpItilSlaTargets(
  trx: Knex.Transaction,
  tenant: string,
  policyId: string
): Promise<ISlaPolicyTarget[]> {
  const scopedDb = tenantDb(trx, tenant);

  const itilPriorities = await scopedDb.table('priorities')
    .where({ is_from_itil_standard: true, item_type: 'ticket' })
    .select('priority_id', 'itil_priority_level', 'priority_name')
    .orderBy('itil_priority_level', 'asc');

  const existing = await scopedDb.table('sla_policy_targets')
    .where({ sla_policy_id: policyId })
    .select('*') as ISlaPolicyTarget[];
  const covered = new Set(existing.map(target => target.priority_id));

  for (const priority of itilPriorities) {
    if (covered.has(priority.priority_id)) continue;

    const slaTarget = ITIL_SLA_TARGETS[Number(priority.itil_priority_level)];
    if (!slaTarget) {
      console.warn(`[ItilSlaService] No SLA target defined for ITIL level ${priority.itil_priority_level}`);
      continue;
    }

    const [newTarget] = await scopedDb.table('sla_policy_targets')
      .insert({
        tenant,
        target_id: uuidv4(),
        sla_policy_id: policyId,
        priority_id: priority.priority_id,
        response_time_minutes: slaTarget.responseTimeMinutes,
        resolution_time_minutes: slaTarget.resolutionTimeMinutes,
        ...ITIL_SLA_ESCALATION_PERCENTS,
        is_24x7: slaTarget.is24x7,
        created_at: trx.fn.now(),
        updated_at: trx.fn.now()
      })
      .returning('*');

    existing.push(newTarget as ISlaPolicyTarget);
    console.log(`[ItilSlaService] Created target for ${priority.priority_name}: ${slaTarget.responseTimeMinutes}min response, ${slaTarget.resolutionTimeMinutes}min resolution`);
  }

  return existing;
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
  await tenantDb(trx, tenant).table('boards')
    .where({ board_id: boardId })
    .update({
      sla_policy_id: policyId,
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
  const scopedDb = tenantDb(trx, tenant);

  // Check if board already has an SLA policy assigned
  const board = await scopedDb.table('boards')
    .where({ board_id: boardId })
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
