exports.up = async function up(knex) {
  await knex.raw("ALTER TABLE contacts ADD COLUMN IF NOT EXISTS contact_kind text NOT NULL DEFAULT 'person'");
  await knex.raw("ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_contact_kind_check");
  await knex.raw("ALTER TABLE contacts ADD CONSTRAINT contacts_contact_kind_check CHECK (contact_kind IN ('person', 'shared_mailbox'))");
};

exports.down = async function down(knex) {
  await knex.raw('ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_contact_kind_check');
  await knex.raw('ALTER TABLE contacts DROP COLUMN IF EXISTS contact_kind');
};
