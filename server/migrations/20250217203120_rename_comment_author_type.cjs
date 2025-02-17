exports.up = async function(knex) {
  await knex.transaction(async (trx) => {
    // Check if source type exists and target doesn't
    const typeCheck = await trx.raw(`
      SELECT 
        EXISTS (
          SELECT 1 FROM pg_type t
          JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = 'comment_author_type_new'
        ) as source_exists,
        EXISTS (
          SELECT 1 FROM pg_type t
          JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = 'comment_author_type'
        ) as target_exists;
    `);
    
    const { source_exists, target_exists } = typeCheck.rows[0];
    
    if (source_exists && !target_exists) {
      await trx.raw('ALTER TYPE comment_author_type_new RENAME TO comment_author_type');
    }
  });
};

exports.down = async function(knex) {
  await knex.transaction(async (trx) => {
    // Check if source type exists and target doesn't
    const typeCheck = await trx.raw(`
      SELECT 
        EXISTS (
          SELECT 1 FROM pg_type t
          JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = 'comment_author_type'
        ) as source_exists,
        EXISTS (
          SELECT 1 FROM pg_type t
          JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = 'comment_author_type_new'
        ) as target_exists;
    `);
    
    const { source_exists, target_exists } = typeCheck.rows[0];
    
    if (source_exists && !target_exists) {
      await trx.raw('ALTER TYPE comment_author_type RENAME TO comment_author_type_new');
    }
  });
};
