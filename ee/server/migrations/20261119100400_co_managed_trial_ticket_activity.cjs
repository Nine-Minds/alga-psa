const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

exports.up = async function (knex) {
  await knex.schema.alterTable('co_managed_seat_trial_milestones', table => {
    table.uuid('event_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    table.timestamp('reported_at', { useTz: true });
  });
  await knex.schema.createTable('co_managed_trial_ticket_activity', table => {
    table.uuid('tenant').notNullable();
    table.uuid('trial_id').notNullable();
    table.uuid('ticket_id').notNullable();
    table.boolean('technician_worked').notNullable();
    table.boolean('staff_worked').notNullable();
    table.primary(['tenant', 'trial_id', 'ticket_id']);
  });
  await ensureTenantDistribution(knex, 'co_managed_trial_ticket_activity');
  // The operational ticket journal records human mutations, with their actor and source. Keep
  // the qualifying scope at event time and merge concurrent contributions in either order.
  await knex.raw(`CREATE FUNCTION record_co_managed_trial_ticket_work() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE pilot uuid; technician uuid; shared boolean;
    BEGIN
      SELECT p.trial_id, a.user_id INTO pilot, technician
        FROM co_managed_seat_trials p
        JOIN co_managed_trial_access g USING (tenant, allocation_id, assignment_id)
        JOIN co_managed_seat_assignments a USING (tenant, assignment_id)
        JOIN tickets t ON t.tenant = p.tenant AND t.client_id = p.client_id AND t.ticket_id = NEW.ticket_id
        JOIN co_managed_seat_board_scopes b ON b.tenant = p.tenant AND b.arrangement_id = p.arrangement_id AND b.board_id = t.board_id
        WHERE p.tenant = NEW.tenant AND a.state = 'active' AND NEW.occurred_at >= p.activated_at
          AND NEW.occurred_at < p.deadline_at AND NOT EXISTS
          (SELECT 1 FROM co_managed_seat_trial_milestones m WHERE m.tenant = p.tenant AND m.trial_id = p.trial_id AND m.milestone = 'shared_ticket_work');
      IF pilot IS NULL THEN RETURN NEW; END IF;
      IF NEW.actor_user_id <> technician AND (
        NOT EXISTS (SELECT 1 FROM users u WHERE u.tenant = NEW.tenant AND u.user_id = NEW.actor_user_id AND u.user_type = 'internal')
        OR EXISTS (SELECT 1 FROM co_managed_seat_assignments a WHERE a.tenant = NEW.tenant AND a.user_id = NEW.actor_user_id)
      ) THEN RETURN NEW; END IF;
      INSERT INTO co_managed_trial_ticket_activity AS work VALUES
        (NEW.tenant, pilot, NEW.ticket_id, NEW.actor_user_id = technician, NEW.actor_user_id <> technician)
        ON CONFLICT (tenant, trial_id, ticket_id) DO UPDATE SET
          technician_worked = work.technician_worked OR excluded.technician_worked,
          staff_worked = work.staff_worked OR excluded.staff_worked
        RETURNING technician_worked AND staff_worked INTO shared;
      IF shared THEN
        INSERT INTO co_managed_seat_trial_milestones (tenant, trial_id, milestone)
          VALUES (NEW.tenant, pilot, 'shared_ticket_work') ON CONFLICT DO NOTHING;
      END IF;
      RETURN NEW;
    END $$`);
  await knex.raw(`CREATE TRIGGER co_managed_trial_ticket_work AFTER INSERT ON ticket_audit_logs
    FOR EACH ROW WHEN (NEW.actor_type = 'user' AND NEW.actor_user_id IS NOT NULL AND NEW.source = 'ui'
      AND NEW.via_principal_user_id IS NULL AND NEW.event_type IN
        ('TICKET_CREATED','TICKET_UPDATED','TICKET_STATUS_CHANGED','TICKET_CLOSED','TICKET_REOPENED','TICKET_PRIORITY_CHANGED',
         'TICKET_ASSIGNED','TICKET_UNASSIGNED','TICKET_BOARD_MOVED','TICKET_COMMENT_ADDED','TICKET_COMMENT_UPDATED',
         'TICKET_INTERNAL_NOTE_ADDED','TICKET_CHECKLIST_ITEM_COMPLETED','TICKET_CHECKLIST_ITEM_UNCOMPLETED'))
    EXECUTE FUNCTION record_co_managed_trial_ticket_work()`);
  await knex.raw(`CREATE FUNCTION end_revoked_seat_trial() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      UPDATE co_managed_seat_trials SET state = 'ended', updated_at = statement_timestamp(), revision = revision + 1
        WHERE tenant = NEW.tenant AND assignment_id = NEW.assignment_id AND state = 'active';
      RETURN NEW;
    END $$`);
  await knex.raw(`CREATE TRIGGER end_revoked_seat_trial AFTER UPDATE OF state ON co_managed_seat_assignments
    FOR EACH ROW WHEN (NEW.state = 'revoked' AND OLD.state <> 'revoked')
    EXECUTE FUNCTION end_revoked_seat_trial()`);
  await knex.raw(`CREATE FUNCTION end_co_managed_allocation_trial() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      UPDATE co_managed_seat_trials SET state = 'ended', updated_at = statement_timestamp(), revision = revision + 1
        WHERE tenant = NEW.tenant AND allocation_id = NEW.allocation_id AND state <> 'paid';
      RETURN NEW;
    END $$`);
  await knex.raw(`CREATE TRIGGER co_managed_end_allocation_trial AFTER UPDATE OF state ON co_managed_allocations
    FOR EACH ROW WHEN (NEW.state = 'released' AND OLD.funding_source = 'seat_trial')
    EXECUTE FUNCTION end_co_managed_allocation_trial()`);
};

exports.down = async function (knex) {
  await knex.raw('DROP TRIGGER end_revoked_seat_trial ON co_managed_seat_assignments');
  await knex.raw('DROP FUNCTION end_revoked_seat_trial()');
  await knex.raw('DROP TRIGGER co_managed_end_allocation_trial ON co_managed_allocations');
  await knex.raw('DROP FUNCTION end_co_managed_allocation_trial()');
  await knex.raw('DROP TRIGGER co_managed_trial_ticket_work ON ticket_audit_logs');
  await knex.raw('DROP FUNCTION record_co_managed_trial_ticket_work()');
  await knex.schema.dropTable('co_managed_trial_ticket_activity');
  await knex.schema.alterTable('co_managed_seat_trial_milestones', table => table.dropColumns('reported_at', 'event_id'));
};
