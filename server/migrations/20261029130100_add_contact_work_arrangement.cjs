'use strict';

/**
 * contacts.work_arrangement: where a person normally works, independent of which locations they
 * are linked to. NULL means unset (the overwhelming majority of rows — there is no backfill).
 *
 * Text plus CHECK rather than an enum type so a later value can be added without ALTER TYPE on a
 * distributed table.
 *
 * Step 1 of 2: the CHECK lands NOT VALID so adding it is catalog-only on a hot table (it already
 * rejects every new write); 20261029130200 validates it in its own untransacted migration.
 */

exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn('contacts', 'work_arrangement'))) {
    await knex.schema.alterTable('contacts', (table) => {
      table.text('work_arrangement').nullable();
    });
  }

  await knex.raw(`
    ALTER TABLE contacts
    DROP CONSTRAINT IF EXISTS contacts_work_arrangement_check
  `);

  await knex.raw(`
    ALTER TABLE contacts
    ADD CONSTRAINT contacts_work_arrangement_check
    CHECK (work_arrangement IS NULL OR work_arrangement IN ('on_site', 'hybrid', 'remote'))
    NOT VALID
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`
    ALTER TABLE contacts
    DROP CONSTRAINT IF EXISTS contacts_work_arrangement_check
  `);

  if (await knex.schema.hasColumn('contacts', 'work_arrangement')) {
    await knex.schema.alterTable('contacts', (table) => {
      table.dropColumn('work_arrangement');
    });
  }
};
