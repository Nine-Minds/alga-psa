exports.up = async function(knex) {
  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'citus'
      ) THEN
        EXECUTE 'SET citus.multi_shard_modify_mode TO ''sequential''';
      END IF;
    END $$;
  `);
  // Use a single transaction for the entire operation
  return knex.raw(`
    DO $$ 
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'comment_author_type'
      ) THEN
        DROP TYPE comment_author_type;
      END IF;
    END $$;
  `);
};

exports.down = async function(knex) {
  // Use a single transaction for the entire operation
  return knex.raw(`
    DO $$ 
    BEGIN 
      IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'comment_author_type'
      ) THEN
        CREATE TYPE comment_author_type AS ENUM ('user', 'contact');
      END IF;
    END $$;
  `);
};

exports.config = { transaction: false };
