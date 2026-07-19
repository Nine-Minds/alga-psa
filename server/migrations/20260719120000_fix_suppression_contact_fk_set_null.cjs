/**
 * The suppressions -> contacts FK was declared with a bare ON DELETE SET NULL
 * on the composite (tenant, contact_id) key, which nulls BOTH columns on
 * contact deletion — including NOT NULL tenant, so every delete of a
 * once-suppressed contact failed. Postgres 15's column-targeted form keeps
 * tenant and nulls only contact_id, which is what "suppression survives
 * contact deletion" (T007) always meant.
 *
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.up = async function up(knex) {
  await knex.raw(`
    ALTER TABLE marketing_suppressions
    DROP CONSTRAINT marketing_suppressions_tenant_contact_id_foreign
  `);
  await knex.raw(`
    ALTER TABLE marketing_suppressions
    ADD CONSTRAINT marketing_suppressions_tenant_contact_id_foreign
    FOREIGN KEY (tenant, contact_id)
    REFERENCES contacts (tenant, contact_name_id)
    ON DELETE SET NULL (contact_id)
  `);
};

/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.down = async function down(knex) {
  await knex.raw(`
    ALTER TABLE marketing_suppressions
    DROP CONSTRAINT marketing_suppressions_tenant_contact_id_foreign
  `);
  await knex.raw(`
    ALTER TABLE marketing_suppressions
    ADD CONSTRAINT marketing_suppressions_tenant_contact_id_foreign
    FOREIGN KEY (tenant, contact_id)
    REFERENCES contacts (tenant, contact_name_id)
    ON DELETE SET NULL
  `);
};
