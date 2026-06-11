exports.up = async function(knex) {
    // The vectors table needs the pgvector extension. Environments without it
    // (e.g. the Citus migration smoke job) skip the vector pieces; chats,
    // messages, and the full-text columns below are independent and always run.
    const vectorCheck = await knex.raw(
        "SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') AS available"
    );
    const vectorAvailable = Boolean(vectorCheck.rows?.[0]?.available);
    if (vectorAvailable) {
        await knex.raw('CREATE EXTENSION IF NOT EXISTS vector');
    } else {
        console.log('[ai-schema] pgvector not available; skipping vectors table');
    }

    // Create process_large_lexemes function for text processing 
    await knex.raw(`CREATE OR REPLACE FUNCTION process_large_lexemes(text_input TEXT) RETURNS tsvector AS $$
        BEGIN
            RETURN to_tsvector('english', regexp_replace(text_input, '\\m\\w{200,}\\M', '', 'g'));
        END;
        $$ LANGUAGE plpgsql IMMUTABLE;`);

    // Create vectors table
    if (vectorAvailable) await knex.schema.createTableIfNotExists('vectors', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('vector_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.text('item_type');
        table.uuid('document_id');
        table.uuid('comment_id');
        table.uuid('ticket_id');
        table.text('vectorizer');
        table.text('source_type');
        table.specificType('vector', 'vector');
        table.primary(['tenant', 'vector_id']);
    });

    // Add foreign keys if they don't exist
    if (vectorAvailable) await knex.raw(`
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints 
                WHERE constraint_name = 'vectors_tenant_foreign'
            ) THEN
                ALTER TABLE vectors ADD CONSTRAINT vectors_tenant_foreign 
                FOREIGN KEY (tenant) REFERENCES tenants(tenant);
            END IF;

            IF NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints
                WHERE constraint_name = 'vectors_tenant_ticket_id_foreign'
            ) THEN
                ALTER TABLE vectors ADD CONSTRAINT vectors_tenant_ticket_id_foreign
                FOREIGN KEY (tenant, ticket_id) REFERENCES tickets(tenant, ticket_id);
            END IF;

            IF NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints
                WHERE constraint_name = 'vectors_tenant_document_id_foreign'
            ) THEN
                ALTER TABLE vectors ADD CONSTRAINT vectors_tenant_document_id_foreign
                FOREIGN KEY (tenant, document_id) REFERENCES documents(tenant, document_id);
            END IF;

            IF NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints
                WHERE constraint_name = 'vectors_tenant_comment_id_foreign'
            ) THEN
                ALTER TABLE vectors ADD CONSTRAINT vectors_tenant_comment_id_foreign
                FOREIGN KEY (tenant, comment_id) REFERENCES comments(tenant, comment_id);
            END IF;
        END $$;
    `);

    // Create chats table
    await knex.schema.createTableIfNotExists('chats', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.uuid('user_id');
        table.text('title_text');
        table.boolean('title_is_locked');
        table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
        table.primary(['tenant', 'id']);
    });

    // Add chats foreign key if it doesn't exist
    await knex.raw(`
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints
                WHERE constraint_name = 'chats_tenant_user_id_foreign'
            ) THEN
                ALTER TABLE chats ADD CONSTRAINT chats_tenant_user_id_foreign
                FOREIGN KEY (tenant, user_id) REFERENCES users(tenant, user_id);
            END IF;
        END $$;
    `);

    // Create messages table
    await knex.schema.createTableIfNotExists('messages', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.uuid('chat_id');
        table.text('chat_role');
        table.text('content');
        table.text('thumb');
        table.text('feedback');
        table.increments('message_order');
        table.primary(['tenant', 'id']);
    });

    // Add messages foreign key if it doesn't exist
    await knex.raw(`
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints
                WHERE constraint_name = 'messages_tenant_chat_id_foreign'
            ) THEN
                ALTER TABLE messages ADD CONSTRAINT messages_tenant_chat_id_foreign
                FOREIGN KEY (tenant, chat_id) REFERENCES chats(tenant, id);
            END IF;
        END $$;
    `);

    // Add tsvector columns and GIN indexes if they don't exist
    await knex.raw(`
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'tickets' AND column_name = 'title_index'
            ) THEN
                ALTER TABLE tickets ADD COLUMN title_index tsvector 
                GENERATED ALWAYS AS (to_tsvector('english'::regconfig, title)) STORED;
            END IF;
        END $$;
    `);
    await knex.raw(`
        CREATE INDEX IF NOT EXISTS title_index_idx ON tickets USING GIN (title_index);
        
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'comments' AND column_name = 'note_index'
            ) THEN
                ALTER TABLE comments ADD COLUMN note_index tsvector
                GENERATED ALWAYS AS (process_large_lexemes(note)) STORED;
            END IF;
        END $$;
    `);
    await knex.raw('CREATE INDEX IF NOT EXISTS comment_index_idx ON comments USING GIN (note_index)');

    await knex.raw(`
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'documents' AND column_name = 'content_index'
            ) THEN
                ALTER TABLE documents ADD COLUMN content_index tsvector
                GENERATED ALWAYS AS (process_large_lexemes(content)) STORED;
            END IF;
        END $$;
    `);
    await knex.raw('CREATE INDEX IF NOT EXISTS documents_index_idx ON documents USING GIN (content_index)');

    // Enable RLS and create policies for AI-related tables
    if (vectorAvailable) await knex.raw(`
        ALTER TABLE vectors ENABLE ROW LEVEL SECURITY;

        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_policies 
                WHERE tablename = 'vectors' AND policyname = 'tenant_isolation_policy'
            ) THEN
                CREATE POLICY tenant_isolation_policy ON vectors
                USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);
            END IF;
        END $$;
    `);
    await knex.raw(`
        ALTER TABLE chats ENABLE ROW LEVEL SECURITY;
        ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_policies
                WHERE tablename = 'chats' AND policyname = 'tenant_isolation_policy'
            ) THEN
                CREATE POLICY tenant_isolation_policy ON chats
                USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);
            END IF;

            IF NOT EXISTS (
                SELECT 1 FROM pg_policies
                WHERE tablename = 'messages' AND policyname = 'tenant_isolation_policy'
            ) THEN
                CREATE POLICY tenant_isolation_policy ON messages
                USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);
            END IF;
        END $$;
    `);
};

exports.down = async function(knex) {
    // Drop RLS policies (vectors may not exist when pgvector was unavailable)
    if (await knex.schema.hasTable('vectors')) {
        await knex.raw('DROP POLICY IF EXISTS tenant_isolation_policy ON vectors');
    }
    await knex.raw(`
        DROP POLICY IF EXISTS tenant_isolation_policy ON chats;
        DROP POLICY IF EXISTS tenant_isolation_policy ON messages;
    `);

    // Drop indexes
    await knex.raw('DROP INDEX IF EXISTS documents_index_idx');
    await knex.raw('DROP INDEX IF EXISTS comment_index_idx');
    await knex.raw('DROP INDEX IF EXISTS title_index_idx');

    // Remove tsvector columns
    await knex.schema.alterTable('documents', (table) => {
        table.dropColumn('content_index');
    });
    await knex.schema.alterTable('comments', (table) => {
        table.dropColumn('note_index');
    });
    await knex.schema.alterTable('tickets', (table) => {
        table.dropColumn('title_index');
    });

    // Drop tables
    await knex.schema.dropTableIfExists('messages');
    await knex.schema.dropTableIfExists('chats');
    await knex.schema.dropTableIfExists('vectors');

    // Drop function
    await knex.raw('DROP FUNCTION IF EXISTS process_large_lexemes');
};
