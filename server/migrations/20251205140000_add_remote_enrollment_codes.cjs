/**
 * Migration: Add Remote Desktop Enrollment Codes
 *
 * This migration creates the enrollment codes table and agent permissions:
 * - rd_enrollment_codes: Enrollment codes for agent registration
 * - Adds permissions column to rd_agents table
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
    // Create rd_enrollment_codes table
    await knex.schema.createTable('rd_enrollment_codes', table => {
        table.uuid('tenant').notNullable().references('tenant').inTable('tenants').onDelete('CASCADE');
        table.uuid('code_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.uuid('company_id').nullable(); // Optional: restrict to company

        // The enrollment code (ABC-123-XYZ format)
        table.text('code').notNullable();
        // SHA-256 hash of the code for validation
        table.text('code_hash').notNullable();

        // Creator tracking
        table.uuid('created_by').notNullable();
        table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.timestamp('expires_at', { useTz: true }).notNullable();

        // Usage limits
        table.integer('usage_limit').notNullable().defaultTo(1);
        table.integer('usage_count').notNullable().defaultTo(0);

        // Default permissions for enrolled agents
        table.jsonb('default_permissions').notNullable().defaultTo(JSON.stringify({
            canConnect: true,
            canViewScreen: true,
            canControlInput: true,
            canAccessTerminal: true,
            canTransferFiles: true,
            canElevate: false,
            requiresUserConsent: true
        }));

        // Revocation
        table.timestamp('revoked_at', { useTz: true }).nullable();
        table.uuid('revoked_by').nullable();

        // Constraints
        table.primary(['tenant', 'code_id']);
        table.foreign(['tenant', 'company_id']).references(['tenant', 'company_id']).inTable('companies').onDelete('SET NULL');
        table.foreign(['tenant', 'created_by']).references(['tenant', 'user_id']).inTable('users').onDelete('CASCADE');
        table.foreign(['tenant', 'revoked_by']).references(['tenant', 'user_id']).inTable('users').onDelete('SET NULL');

        // Indexes
        table.index(['tenant'], 'idx_rd_enrollment_codes_tenant');
        table.unique(['code_hash'], { indexName: 'idx_rd_enrollment_codes_hash' });
        table.index(['tenant', 'expires_at'], 'idx_rd_enrollment_codes_expires');
        table.index(['tenant', 'company_id'], 'idx_rd_enrollment_codes_company');

        // Check constraint for valid limits
        table.check('?? > 0 AND ?? >= 0', ['usage_limit', 'usage_count']);
    });

    // Add permissions column to rd_agents
    await knex.schema.alterTable('rd_agents', table => {
        table.jsonb('permissions').notNullable().defaultTo(JSON.stringify({
            canConnect: true,
            canViewScreen: true,
            canControlInput: true,
            canAccessTerminal: true,
            canTransferFiles: true,
            canElevate: false,
            requiresUserConsent: true
        }));

        // Reference to enrollment code used (optional, for tracking)
        table.uuid('enrolled_with_code_id').nullable();
        table.timestamp('enrolled_at', { useTz: true }).nullable();

        // Machine ID for uniqueness check
        table.text('machine_id').nullable();
    });

    // Add unique index for machine_id per tenant (prevent duplicate enrollments)
    await knex.schema.alterTable('rd_agents', table => {
        table.unique(['tenant', 'machine_id'], { indexName: 'idx_rd_agents_machine_id' });
    });

    // Add foreign key for enrollment code
    await knex.raw(`
        ALTER TABLE rd_agents
        ADD CONSTRAINT fk_rd_agents_enrollment_code
        FOREIGN KEY (tenant, enrolled_with_code_id)
        REFERENCES rd_enrollment_codes(tenant, code_id)
        ON DELETE SET NULL;
    `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
    // Remove foreign key from rd_agents
    await knex.raw(`
        ALTER TABLE rd_agents
        DROP CONSTRAINT IF EXISTS fk_rd_agents_enrollment_code;
    `);

    // Remove added columns from rd_agents
    await knex.schema.alterTable('rd_agents', table => {
        table.dropIndex(['tenant', 'machine_id'], 'idx_rd_agents_machine_id');
        table.dropColumn('machine_id');
        table.dropColumn('enrolled_at');
        table.dropColumn('enrolled_with_code_id');
        table.dropColumn('permissions');
    });

    // Drop enrollment codes table
    await knex.schema.dropTableIfExists('rd_enrollment_codes');
};
