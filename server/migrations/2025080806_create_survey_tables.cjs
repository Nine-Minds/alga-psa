const TABLES = {
  templates: 'survey_templates',
  triggers: 'survey_triggers',
  invitations: 'survey_invitations',
  responses: 'survey_responses',
};

function jsonbDefault(knex, fallback) {
  return knex.raw(`${fallback}::jsonb`);
}

async function ensureTable(knex, tableName, builder) {
  const exists = await knex.schema.hasTable(tableName);
  if (!exists) {
    await knex.schema.createTable(tableName, builder);
    return true;
  }
  return false;
}

async function ensureIndex(knex, table, sql) {
  const exists = await knex.schema.hasTable(table);
  if (!exists) {
    return;
  }
  await knex.raw(sql);
}

exports.up = async function up(knex) {
  const clientReference = await resolveClientReference(knex);

  await ensureTable(knex, TABLES.templates, (table) => {
    table.uuid('template_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant').notNullable();
    table.string('template_name', 255).notNullable();
    table.boolean('is_default').notNullable().defaultTo(false);
    table.string('rating_type', 50).notNullable().defaultTo('stars');
    table.integer('rating_scale').notNullable().defaultTo(5);
    table.jsonb('rating_labels').notNullable().defaultTo(jsonbDefault(knex, "'{}'"));
    table.text('prompt_text').notNullable().defaultTo('How would you rate your support experience?');
    table.text('comment_prompt').notNullable().defaultTo('Additional comments (optional)');
    table.text('thank_you_text').notNullable().defaultTo('Thank you for your feedback!');
    table.boolean('enabled').notNullable().defaultTo(true);
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.primary(['template_id', 'tenant']);
    table.unique(['tenant', 'template_name']);
    table
      .foreign('tenant')
      .references('tenant')
      .inTable('tenants');
  });

  await ensureTable(knex, TABLES.triggers, (table) => {
    table.uuid('trigger_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant').notNullable();
    table.uuid('template_id').notNullable();
    table.string('trigger_type', 50).notNullable();
    table.jsonb('trigger_conditions').notNullable().defaultTo(jsonbDefault(knex, "'{}'"));
    table.boolean('enabled').notNullable().defaultTo(true);
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.primary(['trigger_id', 'tenant']);
    table
      .foreign(['template_id', 'tenant'])
      .references(['template_id', 'tenant'])
      .inTable(TABLES.templates)
      .onDelete('CASCADE');
    table
      .foreign('tenant')
      .references('tenant')
      .inTable('tenants');
  });

  await ensureTable(knex, TABLES.invitations, (table) => {
    table.uuid('invitation_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant').notNullable();
    table.uuid('ticket_id').notNullable();
    table.uuid('client_id');
    table.uuid('contact_id');
    table.uuid('template_id').notNullable();
    table.string('survey_token_hash', 255).notNullable();
    table.timestamp('token_expires_at', { useTz: true }).notNullable();
    table.timestamp('sent_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('opened_at', { useTz: true });
    table.boolean('responded').notNullable().defaultTo(false);
    table.timestamp('responded_at', { useTz: true });
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.primary(['invitation_id', 'tenant']);
    table.unique(['tenant', 'survey_token_hash']);
    table
      .foreign(['template_id', 'tenant'])
      .references(['template_id', 'tenant'])
      .inTable(TABLES.templates)
      .onDelete('CASCADE');
    table
      .foreign(['ticket_id', 'tenant'])
      .references(['ticket_id', 'tenant'])
      .inTable('tickets')
      .onDelete('CASCADE');
    table
      .foreign(['tenant', 'client_id'])
      .references(['tenant', clientReference.idColumn])
      .inTable(clientReference.table);
    table
      .foreign(['tenant', 'contact_id'])
      .references(['tenant', 'contact_name_id'])
      .inTable('contacts');
    table
      .foreign('tenant')
      .references('tenant')
      .inTable('tenants');
  });

  await ensureTable(knex, TABLES.responses, (table) => {
    table.uuid('response_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant').notNullable();
    table.uuid('ticket_id').notNullable();
    table.uuid('client_id');
    table.uuid('contact_id');
    table.uuid('template_id').notNullable();
    table.integer('rating').notNullable();
    table.text('comment');
    table.string('survey_token_hash', 255).notNullable();
    table.timestamp('token_expires_at', { useTz: true }).notNullable();
    table.timestamp('submitted_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.integer('response_time_seconds');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.primary(['response_id', 'tenant']);
    table.unique(['tenant', 'survey_token_hash']);
    table
      .foreign(['template_id', 'tenant'])
      .references(['template_id', 'tenant'])
      .inTable(TABLES.templates)
      .onDelete('CASCADE');
    table
      .foreign(['ticket_id', 'tenant'])
      .references(['ticket_id', 'tenant'])
      .inTable('tickets')
      .onDelete('CASCADE');
    table
      .foreign(['tenant', 'client_id'])
      .references(['tenant', clientReference.idColumn])
      .inTable(clientReference.table);
    table
      .foreign(['tenant', 'contact_id'])
      .references(['tenant', 'contact_name_id'])
      .inTable('contacts');
    table
      .foreign('tenant')
      .references('tenant')
      .inTable('tenants');
  });

  await ensureIndex(
    knex,
    TABLES.triggers,
    `CREATE INDEX IF NOT EXISTS idx_survey_triggers_tenant_type
        ON ${TABLES.triggers} (tenant, trigger_type)
        WHERE enabled = true`
  );
  await ensureIndex(
    knex,
    TABLES.triggers,
    `CREATE INDEX IF NOT EXISTS idx_survey_triggers_template
        ON ${TABLES.triggers} (tenant, template_id)`
  );

  await ensureIndex(
    knex,
    TABLES.invitations,
    `CREATE INDEX IF NOT EXISTS idx_survey_invitations_tenant_ticket
        ON ${TABLES.invitations} (tenant, ticket_id)`
  );
  await ensureIndex(
    knex,
    TABLES.invitations,
    `CREATE INDEX IF NOT EXISTS idx_survey_invitations_token
        ON ${TABLES.invitations} (tenant, survey_token_hash)`
  );
  await ensureIndex(
    knex,
    TABLES.invitations,
    `CREATE INDEX IF NOT EXISTS idx_survey_invitations_sent
        ON ${TABLES.invitations} (tenant, sent_at DESC)`
  );

  await ensureIndex(
    knex,
    TABLES.responses,
    `CREATE INDEX IF NOT EXISTS idx_survey_responses_tenant_ticket
        ON ${TABLES.responses} (tenant, ticket_id)`
  );
  await ensureIndex(
    knex,
    TABLES.responses,
    `CREATE INDEX IF NOT EXISTS idx_survey_responses_tenant_client
        ON ${TABLES.responses} (tenant, client_id)`
  );
  await ensureIndex(
    knex,
    TABLES.responses,
    `CREATE INDEX IF NOT EXISTS idx_survey_responses_tenant_submitted
        ON ${TABLES.responses} (tenant, submitted_at)`
  );
  await ensureIndex(
    knex,
    TABLES.responses,
    `CREATE INDEX IF NOT EXISTS idx_survey_responses_token
        ON ${TABLES.responses} (tenant, survey_token_hash)
        WHERE submitted_at IS NULL`
  );
  await ensureIndex(
    knex,
    TABLES.responses,
    `CREATE INDEX IF NOT EXISTS idx_survey_responses_rating
        ON ${TABLES.responses} (tenant, rating)`
  );
};

async function resolveClientReference(knex) {
  const hasClients = await knex.schema.hasTable('clients');
  if (hasClients) {
    return { table: 'clients', idColumn: 'client_id' };
  }

  const hasCompanies = await knex.schema.hasTable('companies');
  if (hasCompanies) {
    return { table: 'companies', idColumn: 'company_id' };
  }

  throw new Error('Neither clients nor companies table exists; cannot create survey tables.');
}

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(TABLES.responses);
  await knex.schema.dropTableIfExists(TABLES.invitations);
  await knex.schema.dropTableIfExists(TABLES.triggers);
  await knex.schema.dropTableIfExists(TABLES.templates);
};
