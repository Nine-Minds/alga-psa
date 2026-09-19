exports.up = async function up(knex) {
  await knex.raw('ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_status_check');
  await knex.raw(`
    ALTER TABLE quotes
    ADD CONSTRAINT quotes_status_check
    CHECK (
      status IS NULL OR status IN (
        'draft',
        'pending_approval',
        'approved',
        'sent',
        'accepted',
        'rejected',
        'expired',
        'converted',
        'cancelled',
        'superseded',
        'archived'
      )
    )
  `);
};

exports.down = async function down(knex) {
  await knex.raw('ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_status_check');
  await knex.raw(`
    ALTER TABLE quotes
    ADD CONSTRAINT quotes_status_check
    CHECK (
      status IS NULL OR status IN (
        'draft',
        'sent',
        'accepted',
        'rejected',
        'expired',
        'converted',
        'cancelled',
        'superseded',
        'archived'
      )
    )
  `);
};
