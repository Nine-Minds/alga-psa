/**
 * Provision `invoice:payment` for every PSA tenant.
 *
 * `POST /api/v1/invoices/{id}/payment` (ApiInvoiceController.recordPayment) has
 * always gated on resource 'invoice' action 'payment', and the new MSP "Record
 * payment" action in the invoicing Finalized tab gates on the same capability.
 * Nothing ever declared the permission, so no role could hold it and the
 * endpoint returned 403 for everyone, Admin included — the same gap
 * 20260815120000 closed for `invoice:credit`.
 *
 * The entry is declared in the unified catalog
 * (server/migrations/utils/permissions/catalog.cjs) with its default grants
 * (PSA msp:Admin and msp:Finance, matching the rest of the invoice resource).
 * This migration reconciles existing tenants against the catalog; on a fresh
 * database the onboarding seeds already run against the current catalog, so it
 * writes nothing.
 *
 * Additive only: it inserts the missing permission and default-role grants and
 * never deletes. A tenant whose own shape blocks reconciliation is reported and
 * skipped, never fatal. See ./utils/permissions/reconcileTenants.cjs.
 */

const { reconcileAllTenants } = require('./utils/permissions/reconcileTenants.cjs');

exports.up = async function up(knex) {
  // migration-lint: allow 8 - reconcileAllTenants is the repo-standard, additive, per-tenant-idempotent way to provision catalog permissions and their default grants (server/migrations/utils/permissions/README.md, "Adding a permission"); invoice:payment is declared in catalog.cjs
  await reconcileAllTenants(knex, { label: 'add_invoice_payment_permission' });
};

exports.down = async function down() {
  throw new Error(
    'add_invoice_payment_permission is irreversible. Removing the permission and its grants would delete '
    + 'state tenants may have assigned to custom roles since. Retiring a permission requires its own reviewed '
    + 'migration — see server/migrations/utils/permissions/README.md.',
  );
};

exports.config = { transaction: false };
