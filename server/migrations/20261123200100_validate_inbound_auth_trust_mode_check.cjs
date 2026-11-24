exports.config = { transaction: false };

exports.up = async function (knex) {
  await knex.raw('ALTER TABLE email_providers VALIDATE CONSTRAINT email_providers_inbound_auth_trust_mode_check');
};

// 20261123200000_add_inbound_auth_trust_to_email_providers.cjs owns and removes this constraint.
exports.down = async function () {};
