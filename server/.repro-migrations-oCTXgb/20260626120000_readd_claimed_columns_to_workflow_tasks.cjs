'use strict';

/**
 * Re-add claimed_at / claimed_by to workflow_tasks.
 *
 * These columns existed in 20250307201232_create_workflow_task_inbox but were dropped
 * when 20250514151155 (20250511215231_consolidate_qbo_workflow_schema) recreated the
 * table without them. WorkflowTaskModel.updateTaskStatus still writes both on CLAIM
 * (claimed_at = now, claimed_by = userId), so claim/unclaim has failed at runtime
 * ("column \"claimed_at\" does not exist") since that consolidation — affecting the EE
 * task-inbox web UI and the v1 /workflows/tasks/{id}/claim route.
 *
 * Restores the original definition: nullable, no FK (claimed_by stores a user_id as a
 * string, matching the original column). ALTER TABLE ADD COLUMN propagates to shards on
 * Citus. Idempotent so it is safe on environments where the columns were never dropped.
 *
 * @type {import('knex').Knex.Migration}
 */
exports.up = async function (knex) {
  const hasClaimedAt = await knex.schema.hasColumn('workflow_tasks', 'claimed_at');
  const hasClaimedBy = await knex.schema.hasColumn('workflow_tasks', 'claimed_by');
  if (hasClaimedAt && hasClaimedBy) return;

  await knex.schema.alterTable('workflow_tasks', (table) => {
    if (!hasClaimedAt) table.timestamp('claimed_at').nullable();
    if (!hasClaimedBy) table.string('claimed_by').nullable();
  });
};

/** @type {import('knex').Knex.Migration} */
exports.down = async function (knex) {
  const hasClaimedAt = await knex.schema.hasColumn('workflow_tasks', 'claimed_at');
  const hasClaimedBy = await knex.schema.hasColumn('workflow_tasks', 'claimed_by');
  if (!hasClaimedAt && !hasClaimedBy) return;

  await knex.schema.alterTable('workflow_tasks', (table) => {
    if (hasClaimedAt) table.dropColumn('claimed_at');
    if (hasClaimedBy) table.dropColumn('claimed_by');
  });
};
