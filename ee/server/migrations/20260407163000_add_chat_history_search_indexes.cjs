exports.up = async function up(knex) {
  await knex.raw(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'chats'
          AND column_name = 'title_index'
      ) THEN
        ALTER TABLE chats
        ADD COLUMN title_index tsvector
        GENERATED ALWAYS AS (
          to_tsvector('english'::regconfig, coalesce(title_text, ''))
        ) STORED;
      END IF;
    END $$;
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS chats_title_index_idx
    ON chats USING GIN (title_index);
  `);

  await knex.raw(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'messages'
          AND column_name = 'content_index'
      ) THEN
        ALTER TABLE messages
        ADD COLUMN content_index tsvector
        GENERATED ALWAYS AS (
          process_large_lexemes(coalesce(content, ''))
        ) STORED;
      END IF;
    END $$;
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS messages_content_index_idx
    ON messages USING GIN (content_index);
  `);
};

exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS messages_content_index_idx');
  await knex.raw('DROP INDEX IF EXISTS chats_title_index_idx');

  await knex.raw(`
    DO $$ BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'messages'
          AND column_name = 'content_index'
      ) THEN
        ALTER TABLE messages DROP COLUMN content_index;
      END IF;
    END $$;
  `);

  await knex.raw(`
    DO $$ BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'chats'
          AND column_name = 'title_index'
      ) THEN
        ALTER TABLE chats DROP COLUMN title_index;
      END IF;
    END $$;
  `);
};
