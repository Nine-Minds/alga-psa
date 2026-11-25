/**
 * Per-inbox trusted inbound gateway policy for contact sender attribution.
 *
 * `inbound_auth_trust` is `{ "mode": "off" | "arc-sealed" | "mta-arc-pass",
 * "trustedAuthservIds": ["mx.example.net"] }`. The default `{"mode":"off"}` keeps
 * every existing inbox on today's behaviour. The column lives on the
 * tenant-scoped `email_providers` row, so it is read and written only under the
 * row's tenant like the rest of the table.
 *
 * The mode CHECK is added NOT VALID here and validated in
 * 20261123200100_validate_inbound_auth_trust_mode_check.cjs.
 *
 * @param { import('knex').Knex } knex
 */
exports.up = async function up(knex) {
  await knex.raw(`
    ALTER TABLE email_providers
    ADD COLUMN IF NOT EXISTS inbound_auth_trust jsonb NOT NULL DEFAULT '{"mode":"off"}'::jsonb
  `);

  await knex.raw(`
    ALTER TABLE email_providers
    DROP CONSTRAINT IF EXISTS email_providers_inbound_auth_trust_mode_check
  `);
  await knex.raw(`
    ALTER TABLE email_providers
    ADD CONSTRAINT email_providers_inbound_auth_trust_mode_check
    CHECK (
      jsonb_typeof(inbound_auth_trust) = 'object'
      AND inbound_auth_trust->>'mode' IN ('off', 'arc-sealed', 'mta-arc-pass')
    ) NOT VALID
  `);
};

/** @param { import('knex').Knex } knex */
exports.down = async function down(knex) {
  await knex.raw(`
    ALTER TABLE email_providers
    DROP CONSTRAINT IF EXISTS email_providers_inbound_auth_trust_mode_check
  `);
  await knex.raw(`ALTER TABLE email_providers DROP COLUMN IF EXISTS inbound_auth_trust`);
};
