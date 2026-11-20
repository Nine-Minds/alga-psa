const { withCitusCoordinatorDdl } = require('./utils/citusDistribution.cjs');

// Only trial-funded bindings add a time limit to an otherwise scoped reader.
exports.up = async function (knex) {
  await withCitusCoordinatorDdl(knex, (db) => db.raw(`CREATE OR REPLACE VIEW co_managed_unavailable_trial_assignments AS
    SELECT a.tenant, a.assignment_id FROM co_managed_seat_assignments a
    JOIN co_managed_seat_arrangements r ON r.tenant = a.tenant AND r.arrangement_id = a.arrangement_id
    JOIN co_managed_trial_funding f ON f.tenant = r.tenant AND f.allocation_id = r.allocation_id
    WHERE NOT EXISTS (SELECT 1 FROM co_managed_trial_access g WHERE g.tenant = a.tenant
      AND g.assignment_id = a.assignment_id AND g.allocation_id = r.allocation_id)`));
};
exports.down = async function (knex) {
  await withCitusCoordinatorDdl(knex, (db) => db.raw('DROP VIEW IF EXISTS co_managed_unavailable_trial_assignments'));
};
