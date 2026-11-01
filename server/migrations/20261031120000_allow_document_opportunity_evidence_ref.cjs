/**
 * Lets opportunity evidence cite a document (card 94df4215). Replaces the
 * ref_type CHECK with one that also admits 'document'.
 *
 * Citus rejects ADD CONSTRAINT combined with other subcommands, and the
 * migration lint requires ADD CONSTRAINT on an existing table to be NOT VALID,
 * so each step is its own statement: DROP IF EXISTS (idempotent), then ADD ...
 * NOT VALID. Migration lint rule R2 requires VALIDATE CONSTRAINT to live in a
 * different transaction-free file; see 20261031120100_validate_*. Transaction-free,
 * like the prepaid block migrations.
 */
exports.config = { transaction: false };

const TABLE = 'opportunity_evidence';
const CONSTRAINT = 'opportunity_evidence_ref_type_check';

async function replaceCheck(knex, refTypes) {
  const list = refTypes.map((t) => `'${t}'`).join(', ');
  await knex.raw(`ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS ${CONSTRAINT}`);
  await knex.raw(
    `ALTER TABLE ${TABLE} ADD CONSTRAINT ${CONSTRAINT} CHECK (ref_type IS NULL OR ref_type IN (${list})) NOT VALID`,
  );
}

const BASE = ['quote', 'contract', 'project', 'schedule_entry', 'interaction'];

exports.up = async function up(knex) {
  await replaceCheck(knex, [...BASE, 'document']);
};

exports.down = async function down(knex) {
  // Rows citing a document cannot satisfy the narrower list; drop the citation
  // (the declaration itself stays) before restoring it.
  await knex(TABLE).where({ ref_type: 'document' }).update({ ref_type: null, ref_id: null });
  await replaceCheck(knex, BASE);
};
