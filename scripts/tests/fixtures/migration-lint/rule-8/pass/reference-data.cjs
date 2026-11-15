// Rule 8 (green): the rule is annotation-only; this is the one way through, and
// the reason is visible in the diff. An unrelated brand-new table is untouched.
exports.up = async function (knex) {
  // migration-lint: allow 8 - one-off catalog entry reviewed by the permissions owner, tracked in the PR body
  await knex.raw(`INSERT INTO permissions (resource, action) VALUES ('ticket_template', 'read')`);
  await knex.raw(`INSERT INTO brand_new_table (id) VALUES (1)`);
};
