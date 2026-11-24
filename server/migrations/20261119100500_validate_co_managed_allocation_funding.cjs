exports.config = { transaction: false };

exports.up = async function (knex) {
  await knex.raw('ALTER TABLE co_managed_allocations VALIDATE CONSTRAINT co_managed_allocations_funding_source_check');
};

// The funding column migration owns and removes this constraint.
exports.down = async function () {};
