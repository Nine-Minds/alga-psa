/**
 * Independent-upgrade purchase states used by the domain and worker runtime.
 * Database integration tests verify these states against the migrated schema.
 */
const CO_MANAGED_UPGRADE_PURCHASE_STATES = ['preparing', 'checkout', 'paid', 'expired', 'payment_failed'];
const CO_MANAGED_UPGRADE_PENDING_STATES = ['preparing', 'checkout', 'payment_failed'];

const sqlList = (states) => states.map((state) => `'${state}'`).join(', ');

module.exports = { CO_MANAGED_UPGRADE_PURCHASE_STATES, CO_MANAGED_UPGRADE_PENDING_STATES, sqlList };
