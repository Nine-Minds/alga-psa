/**
 * Payment methods offered when the MSP records a payment taken outside any
 * gateway (cheque, bank transfer, cash).
 *
 * Deliberately NOT declared in invoicePaymentActions.ts: that file is
 * `'use server'`, and Next turns every runtime export of such a file into a
 * server reference — a client importing this list would receive an action
 * proxy instead of the array (`MANUAL_PAYMENT_METHODS.map is not a function`)
 * and the route build fails with "a 'use server' file can only export async
 * functions". Keeping it here lets the action and the dialog share one list.
 */

export const MANUAL_PAYMENT_METHODS = ['manual', 'check', 'bank_transfer', 'cash', 'other'] as const;

export type ManualPaymentMethod = (typeof MANUAL_PAYMENT_METHODS)[number];

export function isManualPaymentMethod(value: unknown): value is ManualPaymentMethod {
  return typeof value === 'string' && (MANUAL_PAYMENT_METHODS as readonly string[]).includes(value);
}
