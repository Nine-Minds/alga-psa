import {
  PAYMENT_TERMS,
  PREFERRED_PAYMENT_METHODS,
  type PaymentTerms,
  type PreferredPaymentMethod,
} from './paymentPreferences';

/**
 * Localized options for payment terms and preferred payment method, shared by
 * the client billing form, the billing profile settings and the tenant billing
 * settings so all three offer the same keys with the same labels. Lives in
 * `shared/billingClients` because `@alga-psa/clients` must not import
 * `@alga-psa/billing` (that edge closes a package cycle and is rejected by
 * autopayBridge.test.ts). The label keys are in the `features/billing`
 * namespace, so callers pass a `t` from `useTranslation('features/billing')`.
 *
 * The label maps are typed as complete records over the shared key lists, so
 * adding a key to `paymentPreferences.ts` fails to compile here until it has a
 * label. Keys stay literal for the i18n extraction tooling.
 */

/** The slice of the i18n `t` function these helpers need. */
type Translate = (key: string, options: { defaultValue: string; value?: string }) => string;

export interface PaymentPreferenceOption<T extends string> {
  value: T;
  label: string;
}

export function paymentMethodLabels(t: Translate): Record<PreferredPaymentMethod, string> {
  return {
    credit_card: t('paymentPreferences.paymentMethods.creditCard', { defaultValue: 'Credit Card' }),
    bank_transfer: t('paymentPreferences.paymentMethods.bankTransfer', { defaultValue: 'Bank Transfer' }),
    check: t('paymentPreferences.paymentMethods.check', { defaultValue: 'Check' }),
  };
}

export function paymentTermsLabels(t: Translate): Record<PaymentTerms, string> {
  return {
    net_30: t('paymentPreferences.paymentTerms.net30', { defaultValue: 'Net 30' }),
    net_15: t('paymentPreferences.paymentTerms.net15', { defaultValue: 'Net 15' }),
    net_14: t('paymentPreferences.paymentTerms.net14', { defaultValue: 'Net 14' }),
    net_7: t('paymentPreferences.paymentTerms.net7', { defaultValue: 'Net 7' }),
    due_on_receipt: t('paymentPreferences.paymentTerms.dueOnReceipt', { defaultValue: 'Due on Receipt' }),
  };
}

export function paymentMethodOptions(t: Translate): PaymentPreferenceOption<PreferredPaymentMethod>[] {
  const labels = paymentMethodLabels(t);
  return PREFERRED_PAYMENT_METHODS.map((value) => ({ value, label: labels[value] }));
}

export function paymentTermsOptions(t: Translate): PaymentPreferenceOption<PaymentTerms>[] {
  const labels = paymentTermsLabels(t);
  return PAYMENT_TERMS.map((value) => ({ value, label: labels[value] }));
}

/**
 * Label of the client-form option that stores nothing and inherits the tenant
 * default, e.g. "Tenant default (Net 14)". `resolved` is the tenant's resolved
 * default term.
 */
export function tenantDefaultPaymentTermsLabel(
  t: Translate,
  resolved: PaymentTerms,
): string {
  const label = paymentTermsLabels(t)[resolved];
  return t('paymentPreferences.tenantDefault', {
    value: label,
    defaultValue: 'Tenant default ({{value}})',
  });
}
