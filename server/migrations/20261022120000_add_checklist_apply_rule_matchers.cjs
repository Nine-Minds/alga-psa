/**
 * Checklist auto-apply rules: client, origin, service request and keyword
 * matchers (2026-10-22).
 *
 * Adds typed matcher columns to checklist_template_apply_rules. Every column
 * is nullable or defaulted so existing rules keep their meaning (null/empty =
 * match any; from_service_request = false = no service-request constraint).
 *
 *  - client_ids                     uuid[]  ticket's client must be in the list
 *  - ticket_origins                 text[]  ticket's origin must be in the list
 *  - from_service_request           bool    ticket must come from a service request
 *  - service_request_definition_id  uuid    ...and from this definition (implies the above)
 *  - keywords / keyword_mode / keyword_target
 *                                           case-insensitive substring match
 *
 * The table was created tenant-scoped and Citus-distributed by
 * 20260610100000_create_ticket_close_rules_tables.cjs. Adding columns to a
 * distributed table needs no extra distribution step (the tenant column and
 * composite (tenant, apply_rule_id) key already exist). No FK is added for
 * service_request_definition_id or client_ids: a dangling id just stops
 * matching, and array elements cannot carry FKs anyway. Array columns use
 * raw SQL so they are real Postgres arrays, never delimited text.
 */

const TABLE = 'checklist_template_apply_rules';

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    throw new Error(`${TABLE} does not exist; run 20260610100000_create_ticket_close_rules_tables first`);
  }

  await knex.raw(`
    ALTER TABLE ${TABLE}
      ADD COLUMN IF NOT EXISTS client_ids uuid[] NULL,
      ADD COLUMN IF NOT EXISTS ticket_origins text[] NULL,
      ADD COLUMN IF NOT EXISTS from_service_request boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS service_request_definition_id uuid NULL,
      ADD COLUMN IF NOT EXISTS keywords text[] NULL,
      ADD COLUMN IF NOT EXISTS keyword_mode text NOT NULL DEFAULT 'any',
      ADD COLUMN IF NOT EXISTS keyword_target text NOT NULL DEFAULT 'title_and_description'
  `);

  // migration-lint: allow 2 - retroactive: CHECKs added in a guarded DO block on checklist_template_apply_rules, whose new columns are all defaulted; merged before the lint existed
  await knex.raw(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checklist_template_apply_rules_keyword_mode_check') THEN
        ALTER TABLE ${TABLE}
          ADD CONSTRAINT checklist_template_apply_rules_keyword_mode_check
          CHECK (keyword_mode IN ('any', 'all'));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checklist_template_apply_rules_keyword_target_check') THEN
        ALTER TABLE ${TABLE}
          ADD CONSTRAINT checklist_template_apply_rules_keyword_target_check
          CHECK (keyword_target IN ('title', 'description', 'title_and_description'));
      END IF;
    END $$;
  `);

  // migration-lint: allow 1 - retroactive: GIN index on checklist_template_apply_rules built in the transaction; merged before the lint existed
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS checklist_template_apply_rules_client_ids_gin
      ON ${TABLE} USING GIN (client_ids)
  `);
};

exports.down = async function (knex) {
  if (!(await knex.schema.hasTable(TABLE))) return;

  await knex.raw('DROP INDEX IF EXISTS checklist_template_apply_rules_client_ids_gin');
  await knex.raw(`ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS checklist_template_apply_rules_keyword_mode_check`);
  await knex.raw(`ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS checklist_template_apply_rules_keyword_target_check`);
  await knex.raw(`
    ALTER TABLE ${TABLE}
      DROP COLUMN IF EXISTS keyword_target,
      DROP COLUMN IF EXISTS keyword_mode,
      DROP COLUMN IF EXISTS keywords,
      DROP COLUMN IF EXISTS service_request_definition_id,
      DROP COLUMN IF EXISTS from_service_request,
      DROP COLUMN IF EXISTS ticket_origins,
      DROP COLUMN IF EXISTS client_ids
  `);
};
