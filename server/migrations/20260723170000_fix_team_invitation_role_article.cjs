const {
  upsertEmailTemplate,
} = require("./utils/templates/_shared/upsertEmailTemplates.cjs");
const {
  getTemplate: getTeamInvitation,
} = require("./utils/templates/email/auth/teamInvitation.cjs");

/**
 * Re-seed team-invitation after dropping the English indefinite article
 * ("as a {{roleName}}" → "as {{roleName}}"): role names are tenant-defined,
 * so no a/an heuristic is reliable ("a User", "an SLA Manager"). Every other
 * language already phrases the role article-free.
 */
exports.up = async function up(knex) {
  await upsertEmailTemplate(knex, getTeamInvitation());
};

exports.down = async function down() {
  // No-op: email template migrations are forward-only content corrections.
};
