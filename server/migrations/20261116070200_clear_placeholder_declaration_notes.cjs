// alga-2026-0002932: the engine no longer writes "Stage manually set to <stage>" as a
// declaration's note, because the edit dialog would show it as something the user wrote. Existing
// exact matches become NULL (no note); readers supply their own fallback.
//
// Idempotent: a second run finds nothing to change. Only the exact placeholder is touched, so a
// real note that happens to start with the same words is left alone.

exports.up = async function up(knex) {
  // migration-lint: allow 5 - UPDATE limited to user_declared rows whose detail is exactly the engine's old placeholder for their checkpoint; only that placeholder text is cleared
  await knex.raw(`
    UPDATE opportunity_evidence
       SET detail = NULL
     WHERE source = 'user_declared'
       AND detail = 'Stage manually set to ' || checkpoint
  `);
};

exports.down = async function down() {
  // Forward-only: the cleared text was a generated placeholder, not user content.
};
