/**
 * MCP OAuth Authorization Server (plan 2026-06-27-mcp-authorization-server).
 *
 * AlgaPSA becomes its own OAuth 2.1 AS for the remote MCP server. The interactive
 * connection represents the AlgaPSA *user* (their RBAC), authenticated via Alga's
 * own login session. Client identification is CIMD (no DCR). These tables hold:
 *
 *  - mcp_oauth_signing_keys  : instance-wide JWT signing keypairs (rotatable).
 *  - mcp_oauth_clients       : CIMD-derived client records (instance-wide).
 *  - mcp_oauth_grants        : one row per (user, client) authorization — doubles
 *                              as the consent record and the revocation anchor.
 *  - mcp_oauth_auth_codes    : short-lived, single-use authorization codes.
 *  - mcp_oauth_refresh_tokens: rotating refresh tokens (replay-detectable).
 *
 * Tenant isolation is enforced in application code (WHERE tenant = ...), matching
 * the existing MCP agent tables. Signing keys and clients are intentionally global.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('mcp_oauth_signing_keys'))) {
    await knex.schema.createTable('mcp_oauth_signing_keys', (t) => {
      t.string('kid').primary();
      t.string('alg').notNullable().defaultTo('ES256');
      t.jsonb('private_jwk').notNullable();
      t.jsonb('public_jwk').notNullable();
      t.boolean('active').notNullable().defaultTo(true);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.index('active');
    });
  }

  if (!(await knex.schema.hasTable('mcp_oauth_clients'))) {
    await knex.schema.createTable('mcp_oauth_clients', (t) => {
      // For CIMD the client_id IS the https metadata-document URL.
      t.text('client_id').primary();
      t.string('client_name').nullable();
      t.jsonb('redirect_uris').notNullable().defaultTo('[]');
      t.string('source').notNullable().defaultTo('cimd'); // cimd (| dcr later)
      t.jsonb('metadata').nullable(); // cached CIMD document
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('last_seen_at', { useTz: true }).nullable();
    });
  }

  if (!(await knex.schema.hasTable('mcp_oauth_grants'))) {
    await knex.schema.createTable('mcp_oauth_grants', (t) => {
      t.uuid('grant_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.string('tenant').notNullable();
      t.uuid('user_id').notNullable();
      t.text('client_id').notNullable();
      t.string('scope').nullable();
      t.text('resource').nullable(); // RFC 8707 resource indicator (MCP resource)
      t.timestamp('consented_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('revoked_at', { useTz: true }).nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.index('tenant');
      t.index(['tenant', 'user_id']);
      // One active authorization per (tenant, user, client). Re-consent reuses it.
      t.unique(['tenant', 'user_id', 'client_id']);
    });
  }

  if (!(await knex.schema.hasTable('mcp_oauth_auth_codes'))) {
    await knex.schema.createTable('mcp_oauth_auth_codes', (t) => {
      t.string('code_hash').primary(); // sha256 of the opaque code
      t.uuid('grant_id').notNullable();
      t.string('tenant').notNullable();
      t.uuid('user_id').notNullable();
      t.text('client_id').notNullable();
      t.text('redirect_uri').notNullable();
      t.text('code_challenge').notNullable(); // PKCE S256 challenge
      t.text('resource').nullable();
      t.string('scope').nullable();
      t.timestamp('expires_at', { useTz: true }).notNullable();
      t.timestamp('consumed_at', { useTz: true }).nullable(); // single-use guard
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.index('grant_id');
      t.index('expires_at');
    });
  }

  if (!(await knex.schema.hasTable('mcp_oauth_refresh_tokens'))) {
    await knex.schema.createTable('mcp_oauth_refresh_tokens', (t) => {
      t.string('token_hash').primary(); // sha256 of the opaque refresh token
      t.uuid('grant_id').notNullable();
      t.string('tenant').notNullable();
      t.timestamp('expires_at', { useTz: true }).notNullable();
      // Rotation: when consumed, points at its successor; reuse of a consumed
      // token is a replay signal (the whole grant should be revoked).
      t.timestamp('consumed_at', { useTz: true }).nullable();
      t.string('rotated_to').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.index('grant_id');
      t.index('expires_at');
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('mcp_oauth_refresh_tokens');
  await knex.schema.dropTableIfExists('mcp_oauth_auth_codes');
  await knex.schema.dropTableIfExists('mcp_oauth_grants');
  await knex.schema.dropTableIfExists('mcp_oauth_clients');
  await knex.schema.dropTableIfExists('mcp_oauth_signing_keys');
};
