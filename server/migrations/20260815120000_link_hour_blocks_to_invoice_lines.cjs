/**
 * Links hour blocks to the exact invoice charge line they were minted against.
 *
 * The draft purchase invoice is editable before finalization (qty/rate/service,
 * line removal). At finalization the pending block must be synchronized with
 * the AUTHORITATIVE final line, and a block whose line was removed must be
 * voided — matching by service alone breaks the moment the line's service is
 * edited. This migration adds the explicit linkage column
 * `hour_blocks.source_invoice_charge_id` (set at purchase-invoice creation),
 * backfills it for existing blocks where the match is unambiguous, and widens
 * the hour_block_audit type check with `purchase_reversal` — the audit row
 * written when unfinalizing an invoice returns its unused block to pending.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */

async function columnExists(knex, tableName, columnName) {
  const rows = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = '${tableName}'
        AND column_name = '${columnName}'
    ) AS exists;
  `);
  return Boolean(rows.rows?.[0]?.exists);
}

exports.up = async function(knex) {
  if (!(await columnExists(knex, 'hour_blocks', 'source_invoice_charge_id'))) {
    await knex.schema.alterTable('hour_blocks', (table) => {
      table.uuid('source_invoice_charge_id')
        .comment('Invoice charge line this block was minted against; authority for qty/rate/service at finalization.');
    });
    await knex.raw(`
      CREATE INDEX IF NOT EXISTS hour_blocks_source_charge_idx
        ON hour_blocks (tenant, source_invoice_charge_id)
    `);
  }

  // Backfill: link existing blocks to their invoice's charge when exactly one
  // charge on the linked invoice matches the block's service.
  await knex.raw(`
    UPDATE hour_blocks hb
    SET source_invoice_charge_id = ic.item_id
    FROM invoice_charges ic
    WHERE ic.tenant = hb.tenant
      AND ic.invoice_id = hb.source_invoice_id
      AND ic.service_id = hb.service_id
      AND hb.source_invoice_charge_id IS NULL
      AND hb.source_invoice_id IS NOT NULL
      AND (
        SELECT count(*) FROM invoice_charges ic2
        WHERE ic2.tenant = hb.tenant
          AND ic2.invoice_id = hb.source_invoice_id
          AND ic2.service_id = hb.service_id
      ) = 1
  `);

  await knex.raw(`
    DO $$ BEGIN
      ALTER TABLE hour_blocks
        DROP CONSTRAINT hour_blocks_source_charge_fkey;
    EXCEPTION WHEN undefined_object THEN NULL;
    END $$;
  `);
  await knex.raw(`
    ALTER TABLE hour_blocks
      ADD CONSTRAINT hour_blocks_source_charge_fkey
      FOREIGN KEY (tenant, source_invoice_charge_id)
      REFERENCES invoice_charges(tenant, item_id)
      ON DELETE SET NULL (source_invoice_charge_id)
  `);

  // Widen the audit type check with purchase_reversal (unfinalize).
  await knex.raw(`
    DO $$ BEGIN
      ALTER TABLE hour_block_audit
        DROP CONSTRAINT hour_block_audit_type_check;
    EXCEPTION WHEN undefined_object THEN NULL;
    END $$;
  `);
  await knex.raw(`
    ALTER TABLE hour_block_audit
      ADD CONSTRAINT hour_block_audit_type_check
      CHECK (type IN ('purchase', 'grant', 'adjustment', 'expiration_date_change',
                      'manual_expiration', 'auto_expiration', 'void', 'purchase_reversal'))
  `);
};

exports.down = async function(knex) {
  await knex.raw(`
    DO $$ BEGIN
      ALTER TABLE hour_blocks
        DROP CONSTRAINT hour_blocks_source_charge_fkey;
    EXCEPTION WHEN undefined_object THEN NULL;
    END $$;
  `);
  await knex.raw(`
    DO $$ BEGIN
      ALTER TABLE hour_blocks
        DROP COLUMN source_invoice_charge_id;
    EXCEPTION WHEN undefined_column THEN NULL;
    END $$;
  `);
  await knex.raw(`
    DO $$ BEGIN
      DELETE FROM hour_block_audit WHERE type = 'purchase_reversal';
      ALTER TABLE hour_block_audit
        DROP CONSTRAINT hour_block_audit_type_check;
    EXCEPTION WHEN undefined_object THEN NULL;
    END $$;
  `);
  await knex.raw(`
    DO $$ BEGIN
      ALTER TABLE hour_block_audit
        ADD CONSTRAINT hour_block_audit_type_check
        CHECK (type IN ('purchase', 'grant', 'adjustment', 'expiration_date_change',
                        'manual_expiration', 'auto_expiration', 'void'));
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);
};

// Matches the create-table migration: Citus FK/reference-table manipulation
// must run outside a transaction block.
exports.config = { transaction: false };
