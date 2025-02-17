exports.up = async function(knex) {
  await knex.transaction(async (trx) => {
    // Check if columns exist
    const columnsExist = await trx.raw(`
      SELECT 
        EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'comments' AND column_name = 'contact_id'
        ) as contact_id_exists,
        EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'comments' AND column_name = 'contact_name_id'
        ) as contact_name_id_exists;
    `);

    const { contact_id_exists, contact_name_id_exists } = columnsExist.rows[0];

    if (contact_id_exists || contact_name_id_exists) {
      await trx.schema.alterTable('comments', function(table) {
        if (contact_id_exists) {
          table.dropColumn('contact_id');
        }
        if (contact_name_id_exists) {
          table.dropColumn('contact_name_id');
        }
      });
    }
  });
};

exports.down = async function(knex) {
  await knex.transaction(async (trx) => {
    // Check if columns don't exist
    const columnsExist = await trx.raw(`
      SELECT 
        EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'comments' AND column_name = 'contact_id'
        ) as contact_id_exists,
        EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'comments' AND column_name = 'contact_name_id'
        ) as contact_name_id_exists;
    `);

    const { contact_id_exists, contact_name_id_exists } = columnsExist.rows[0];

    if (!contact_id_exists || !contact_name_id_exists) {
      await trx.schema.alterTable('comments', function(table) {
        if (!contact_id_exists) {
          table.uuid('contact_id');
        }
        if (!contact_name_id_exists) {
          table.uuid('contact_name_id');
        }
      });
    }
  });
};
