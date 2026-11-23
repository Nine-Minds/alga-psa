// Setup overlays EE onto the shared migrations. The standalone EE Knex runner reads this directory directly.
const { resolve } = require('node:path');
const { ensureTenantDistribution } = require(require.resolve('./utils/citusDistribution.cjs', {
  paths: [__dirname, resolve(__dirname, '../../../server/migrations')],
}));

exports.up = async function (knex) {
  // Citus propagates function DDL on one connection per node, so run it before shard DDL.
  // The operational ticket journal records human mutations, with their actor and source. Keep
  // the qualifying scope at event time and merge concurrent contributions in either order.
  await knex.raw(`CREATE OR REPLACE FUNCTION record_hosted_co_managed_trial_ticket_work(uuid, uuid)
    RETURNS void LANGUAGE plpgsql AS $$
    DECLARE pilot uuid; technician uuid; shared boolean; activity record;
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM co_managed_seat_trials WHERE tenant = $1 AND state = 'active') THEN RETURN; END IF;
      SELECT actor_user_id, ticket_id, occurred_at INTO activity FROM ticket_audit_logs
        WHERE tenant = $1 AND audit_id = $2 AND actor_type = 'user' AND actor_user_id IS NOT NULL
          AND via_principal_user_id IS NULL AND source = 'ui' AND event_type IN
          ('TICKET_CREATED','TICKET_UPDATED','TICKET_STATUS_CHANGED','TICKET_CLOSED','TICKET_REOPENED','TICKET_PRIORITY_CHANGED',
           'TICKET_ASSIGNED','TICKET_UNASSIGNED','TICKET_BOARD_MOVED','TICKET_COMMENT_ADDED','TICKET_COMMENT_UPDATED',
           'TICKET_INTERNAL_NOTE_ADDED','TICKET_CHECKLIST_ITEM_COMPLETED','TICKET_CHECKLIST_ITEM_UNCOMPLETED');
      IF NOT FOUND THEN RETURN; END IF;
      SELECT p.trial_id, a.user_id INTO pilot, technician
        FROM co_managed_seat_trials p
        JOIN co_managed_trial_access g USING (tenant, allocation_id, assignment_id)
        JOIN co_managed_seat_assignments a USING (tenant, assignment_id)
        JOIN tickets t ON t.tenant = p.tenant AND t.client_id = p.client_id AND t.ticket_id = activity.ticket_id
        JOIN co_managed_seat_board_scopes b ON b.tenant = p.tenant AND b.arrangement_id = p.arrangement_id AND b.board_id = t.board_id
        WHERE p.tenant = $1 AND a.state = 'active' AND activity.occurred_at >= p.activated_at
          AND activity.occurred_at < p.deadline_at AND NOT EXISTS
          (SELECT 1 FROM co_managed_seat_trial_milestones m WHERE m.tenant = p.tenant AND m.trial_id = p.trial_id AND m.milestone = 'shared_ticket_work');
      IF pilot IS NULL THEN RETURN; END IF;
      IF activity.actor_user_id <> technician AND (
        NOT EXISTS (SELECT 1 FROM users u WHERE u.tenant = $1 AND u.user_id = activity.actor_user_id AND u.user_type = 'internal')
        OR EXISTS (SELECT 1 FROM co_managed_seat_assignments a WHERE a.tenant = $1 AND a.user_id = activity.actor_user_id)
      ) THEN RETURN; END IF;
      INSERT INTO co_managed_trial_ticket_activity AS work VALUES
        ($1, pilot, activity.ticket_id, activity.actor_user_id = technician, activity.actor_user_id <> technician)
        ON CONFLICT (tenant, trial_id, ticket_id) DO UPDATE SET
          technician_worked = work.technician_worked OR excluded.technician_worked,
          staff_worked = work.staff_worked OR excluded.staff_worked
        RETURNING technician_worked AND staff_worked INTO shared;
      IF shared THEN
        INSERT INTO co_managed_seat_trial_milestones (tenant, trial_id, milestone)
          VALUES ($1, pilot, 'shared_ticket_work') ON CONFLICT DO NOTHING;
      END IF;
      RETURN;
    END $$`);
  await knex.raw(`ALTER TABLE co_managed_seat_trial_milestones
    ADD COLUMN IF NOT EXISTS event_id uuid NOT NULL DEFAULT gen_random_uuid(),
    ADD COLUMN IF NOT EXISTS reported_at timestamptz`);
  if (!await knex.schema.hasTable('co_managed_trial_ticket_activity')) {
    await knex.schema.createTable('co_managed_trial_ticket_activity', table => {
      table.uuid('tenant').notNullable();
      table.uuid('trial_id').notNullable();
      table.uuid('ticket_id').notNullable();
      table.boolean('technician_worked').notNullable();
      table.boolean('staff_worked').notNullable();
      table.primary(['tenant', 'trial_id', 'ticket_id']);
    });
  }
  await ensureTenantDistribution(knex, 'co_managed_trial_ticket_activity');
};

exports.down = async function (knex) {
  await knex.raw('DROP FUNCTION IF EXISTS record_hosted_co_managed_trial_ticket_work(uuid, uuid)');
  await knex.schema.dropTable('co_managed_trial_ticket_activity');
  await knex.schema.alterTable('co_managed_seat_trial_milestones', table => table.dropColumns('reported_at', 'event_id'));
};
