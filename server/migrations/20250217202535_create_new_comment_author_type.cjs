exports.up = async function(knex) {
  await knex.transaction(async (trx) => {
    // Check if type exists first
    const typeExists = await trx.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'comment_author_type_new'
      );
    `);
    
    if (!typeExists.rows[0].exists) {
      await trx.raw("CREATE TYPE comment_author_type_new AS ENUM ('internal', 'client', 'unknown')");
    }
  });
};

exports.down = async function(knex) {
  await knex.transaction(async (trx) => {
    await trx.raw('DROP TYPE IF EXISTS comment_author_type_new');
  });
};
