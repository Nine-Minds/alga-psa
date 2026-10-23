'use strict';

/**
 * Payment method per billing profile
 * (ee/docs/plans/2026-09-22-billing-profile-payment-methods, F001–F002).
 *
 * - `client_billing_profiles.preferred_payment_method`: nullable, where NULL
 *   means "inherit the client's preferred payment method", the same rule as
 *   every other profile setting added in 20260818040000. The CHECK covers
 *   only this new column. The legacy `clients.preferred_payment_method` stays
 *   unconstrained because it already holds `''` and older free text.
 * - `invoices.payment_method`: the effective method snapshotted when an
 *   invoice is generated, so editing a profile later never rewrites an issued
 *   invoice (and never changes whether that invoice offers "Pay now"). No
 *   CHECK and no backfill: existing invoices stay NULL, which keeps today's
 *   behaviour.
 *
 * Both tables are already distributed on Citus. Adding a nullable column and a
 * column-local CHECK needs no distribution change.
 */

const PROFILES = 'client_billing_profiles';
const INVOICES = 'invoices';
const PROFILE_METHOD_CHECK = 'client_billing_profiles_preferred_payment_method_check';

const hasColumn = async (knex, tableName, columnName) => {
  try {
    return await knex.schema.hasColumn(tableName, columnName);
  } catch {
    return false;
  }
};

const hasConstraint = async (knex, tableName, constraintName) => {
  const result = await knex.raw(
    `SELECT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = ? AND conrelid = ?::regclass
    ) AS present`,
    [constraintName, tableName]
  );
  return Boolean(result.rows?.[0]?.present);
};

exports.up = async function up(knex) {
  if (!(await hasColumn(knex, PROFILES, 'preferred_payment_method'))) {
    await knex.schema.alterTable(PROFILES, (t) => {
      t.text('preferred_payment_method').nullable();
    });
  }

  if (!(await hasConstraint(knex, PROFILES, PROFILE_METHOD_CHECK))) {
    await knex.raw(`
      ALTER TABLE ${PROFILES}
      ADD CONSTRAINT ${PROFILE_METHOD_CHECK}
      CHECK (preferred_payment_method IN ('credit_card', 'bank_transfer', 'check'))
    `);
  }

  if (!(await hasColumn(knex, INVOICES, 'payment_method'))) {
    await knex.schema.alterTable(INVOICES, (t) => {
      t.text('payment_method').nullable();
    });
  }
};

exports.down = async function down(knex) {
  if (await hasColumn(knex, INVOICES, 'payment_method')) {
    await knex.schema.alterTable(INVOICES, (t) => {
      t.dropColumn('payment_method');
    });
  }

  if (await hasConstraint(knex, PROFILES, PROFILE_METHOD_CHECK)) {
    await knex.raw(`ALTER TABLE ${PROFILES} DROP CONSTRAINT ${PROFILE_METHOD_CHECK}`);
  }

  if (await hasColumn(knex, PROFILES, 'preferred_payment_method')) {
    await knex.schema.alterTable(PROFILES, (t) => {
      t.dropColumn('preferred_payment_method');
    });
  }
};

// ALTER TABLE on Citus-distributed tables must not run inside a transaction.
exports.config = { transaction: false };
