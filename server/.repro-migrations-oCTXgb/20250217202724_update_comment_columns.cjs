exports.up = async function(knex) {
  await knex.transaction(async (trx) => {
    // Check if new column exists
    const newColumnExists = await trx.raw(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'comments' AND column_name = 'author_type_new'
      );
    `);

    if (!newColumnExists.rows[0].exists) {
      // Add new column
      await trx.raw('ALTER TABLE comments ADD COLUMN author_type_new comment_author_type_new');
      
      // Copy data to new column
      await trx.raw(`
        UPDATE comments
        SET author_type_new = subquery.new_author_type
        FROM (
          SELECT comment_id,
                CASE
                  WHEN author_type::text = 'user' THEN 'internal'::comment_author_type_new
                  WHEN author_type::text = 'contact' THEN 'client'::comment_author_type_new
                  ELSE 'unknown'::comment_author_type_new
                END AS new_author_type
          FROM comments
        ) AS subquery
        WHERE comments.comment_id = subquery.comment_id;
        `);
    }

    // Check if old column exists before dropping
    const oldColumnExists = await trx.raw(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'comments' AND column_name = 'author_type'
      );
    `);

    if (oldColumnExists.rows[0].exists) {
      // Drop old column and rename new one
      await trx.raw('ALTER TABLE comments DROP COLUMN author_type');
      await trx.raw('ALTER TABLE comments RENAME COLUMN author_type_new TO author_type');
      
      // Set default on new column
      await trx.raw("ALTER TABLE comments ALTER COLUMN author_type SET DEFAULT 'unknown'::comment_author_type_new");
    }
  });
};

exports.down = async function(knex) {
  await knex.transaction(async (trx) => {
    // Check if new column exists
    const newColumnExists = await trx.raw(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'comments' AND column_name = 'author_type_old'
      );
    `);

    if (!newColumnExists.rows[0].exists) {
      // Add new column with old type
      await trx.raw('ALTER TABLE comments ADD COLUMN author_type_old comment_author_type_old');
      
      // Copy data back
      await trx.raw(`
        UPDATE comments 
        SET author_type_old = CASE
          WHEN author_type::text = 'internal' THEN 'user'::comment_author_type_old
          WHEN author_type::text = 'client' THEN 'contact'::comment_author_type_old
          ELSE 'user'::comment_author_type_old
        END`);
    }

    // Check if old column exists before dropping
    const oldColumnExists = await trx.raw(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'comments' AND column_name = 'author_type'
      );
    `);

    if (oldColumnExists.rows[0].exists) {
      // Drop new column and rename old one
      await trx.raw('ALTER TABLE comments DROP COLUMN author_type');
      await trx.raw('ALTER TABLE comments RENAME COLUMN author_type_old TO author_type');
      
      // Set default on old column
      await trx.raw("ALTER TABLE comments ALTER COLUMN author_type SET DEFAULT 'user'::comment_author_type_old");
    }
  });
};
