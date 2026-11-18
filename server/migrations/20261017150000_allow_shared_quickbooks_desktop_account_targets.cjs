/**
 * Migration: let QuickBooks Desktop account targets be shared.
 *
 * A QuickBooks Desktop Services, Discounts or Tax Codes mapping stores the
 * Desktop *account* name as its value (the item it names lives in
 * metadata.qbdItem / metadata.qbdSalesTaxItem). Many services post to one
 * income account and many tax regions to one liability account, so those rows
 * must not be unique on external_entity_id. idx_unique_external_mapping keeps
 * the Xero exclusion from 20261013120000 and additionally excludes these
 * Desktop rows. Desktop customers and payment terms stay one-to-one, as does
 * every other integration.
 *
 * The new index is looser than the old one, so `up` needs no dedupe.
 */

const INDEX_KEY =
  "tenant, integration_type, alga_entity_type, external_entity_id, COALESCE(external_realm_id, '')";

const XERO_PREDICATE =
  "(integration_type <> 'xero' OR COALESCE(metadata ->> 'xeroTargetKind', 'item') <> 'account')";

const DESKTOP_PREDICATE =
  "(integration_type <> 'quickbooks_desktop' OR alga_entity_type NOT IN ('service', 'discount', 'tax_code'))";

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  await knex.raw('DROP INDEX IF EXISTS idx_unique_external_mapping');
  // migration-lint: allow 1 - retroactive: replaces a unique index via DROP/CREATE inside the transaction because the key shape changes; merged before the lint existed
  await knex.raw(`
    CREATE UNIQUE INDEX idx_unique_external_mapping
    ON tenant_external_entity_mappings (${INDEX_KEY})
    WHERE ${XERO_PREDICATE} AND ${DESKTOP_PREDICATE}
  `);
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  const dupes = await knex.raw(`
    SELECT COUNT(*)::int AS groups FROM (
      SELECT 1
      FROM tenant_external_entity_mappings
      WHERE ${XERO_PREDICATE}
      GROUP BY ${INDEX_KEY}
      HAVING COUNT(*) > 1
    ) d
  `);
  const groups = dupes.rows[0].groups;
  if (groups > 0) {
    throw new Error(
      `Cannot restore the Xero-only idx_unique_external_mapping: ${groups} duplicate target group(s) exist ` +
        '(QuickBooks Desktop accounts shared by several services or tax regions). Remap them to ' +
        'distinct accounts first, then re-run the rollback. No mappings were deleted.'
    );
  }

  await knex.raw('DROP INDEX IF EXISTS idx_unique_external_mapping');
  await knex.raw(`
    CREATE UNIQUE INDEX idx_unique_external_mapping
    ON tenant_external_entity_mappings (${INDEX_KEY})
    WHERE ${XERO_PREDICATE}
  `);
};

exports.config = { transaction: true };
