/**
 * The one list of independent-upgrade purchase states (CM L8b).
 *
 * The migration builds its CHECK constraint from this list and the domain type
 * (`packages/co-managed/src/upgradePurchase.ts`) asserts equality in a unit test, so a state the
 * code writes can never again be missing from the constraint. The reference omitted
 * `payment_failed` here, so a failed payment violated the CHECK.
 */
const CO_MANAGED_UPGRADE_PURCHASE_STATES = ['preparing', 'checkout', 'paid', 'expired', 'payment_failed'];
/** States that count as "a purchase is still pending" for the one-pending-purchase index. */
const CO_MANAGED_UPGRADE_PENDING_STATES = ['preparing', 'checkout', 'payment_failed'];

const sqlList = (states) => states.map((state) => `'${state}'`).join(', ');

module.exports = { CO_MANAGED_UPGRADE_PURCHASE_STATES, CO_MANAGED_UPGRADE_PENDING_STATES, sqlList };
