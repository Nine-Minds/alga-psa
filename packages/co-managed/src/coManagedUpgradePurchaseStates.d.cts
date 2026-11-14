export const CO_MANAGED_UPGRADE_PURCHASE_STATES: readonly ['preparing', 'checkout', 'paid', 'expired', 'payment_failed'];
export const CO_MANAGED_UPGRADE_PENDING_STATES: readonly ['preparing', 'checkout', 'payment_failed'];
export function sqlList(states: readonly string[]): string;
