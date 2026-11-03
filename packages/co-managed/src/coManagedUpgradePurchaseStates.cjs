/**
 * Shared independent-upgrade purchase states for the domain and its database migration.
 * Keep this dependency-free so migration startup does not load the application package graph.
 */
const CO_MANAGED_UPGRADE_PURCHASE_STATES = ['preparing', 'checkout', 'paid', 'expired', 'payment_failed'];
const CO_MANAGED_UPGRADE_PENDING_STATES = ['preparing', 'checkout', 'payment_failed'];

const sqlList = (states) => states.map((state) => `'${state}'`).join(', ');

module.exports = { CO_MANAGED_UPGRADE_PURCHASE_STATES, CO_MANAGED_UPGRADE_PENDING_STATES, sqlList };
