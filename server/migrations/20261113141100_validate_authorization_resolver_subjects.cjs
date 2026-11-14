// Validate after the adding migration commits: the scan must not retain its DDL locks.
exports.config = { transaction: false };

const TABLE = 'co_managed_seat_assignments';
const CONSTRAINTS = [
  'co_managed_seat_assignment_resolver_id_check',
  'co_managed_seat_assignment_resolver_subject_fk',
];

exports.up = async function up(knex) {
  for (const constraint of CONSTRAINTS) {
    await knex.raw(`ALTER TABLE ${TABLE} VALIDATE CONSTRAINT ${constraint}`);
  }
};

exports.down = async function down() {
  // Validation is not reversed; 20261113140000's down removes the constraints.
};
