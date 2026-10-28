// Rule 3 (green): policy/index/trigger drops are not matched, and a constraint
// dropped then re-added in the same file keeps its invariant.
exports.up = async function (knex) {
  await knex.raw('DROP POLICY IF EXISTS comments_tenant_policy ON comments');
  await knex.raw('DROP INDEX IF EXISTS comments_old_idx');
  await knex.raw('DROP TRIGGER IF EXISTS comments_audit ON comments');
  await knex.raw('ALTER TABLE comments ALTER COLUMN note SET DEFAULT \'\'');
  await knex.raw('ALTER TABLE comments DROP CONSTRAINT IF EXISTS comments_note_unique');
  await knex.raw('ALTER TABLE comments ADD CONSTRAINT comments_note_unique UNIQUE (tenant, note)');
};
