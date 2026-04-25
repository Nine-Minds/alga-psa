/**
 * Re-upsert appointment email templates so approved-client and assigned-technician
 * variants render a Teams join action when `onlineMeetingUrl` is present.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
const ensureSequentialMode = async (knex) => {
  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'citus'
      ) THEN
        EXECUTE 'SET citus.multi_shard_modify_mode TO ''sequential''';
      END IF;
    END $$;
  `);
};

exports.up = async function (knex) {
  await ensureSequentialMode(knex);

  const { upsertEmailTemplate } = require('./utils/templates/_shared/upsertEmailTemplates.cjs');
  const { getTemplate: getAppointmentRequestApproved } = require('./utils/templates/email/appointments/appointmentRequestApproved.cjs');
  const { getTemplate: getAppointmentAssignedTechnician } = require('./utils/templates/email/appointments/appointmentAssignedTechnician.cjs');

  await upsertEmailTemplate(knex, getAppointmentRequestApproved());
  await upsertEmailTemplate(knex, getAppointmentAssignedTechnician());

  console.log('  ✓ appointment approval templates updated with Teams join links');
};

/**
 * This migration re-upserts existing templates in place.
 * Rolling back would require restoring the previous HTML/text bodies.
 *
 * @param { import("knex").Knex } _knex
 * @returns { Promise<void> }
 */
exports.down = async function (_knex) {};
