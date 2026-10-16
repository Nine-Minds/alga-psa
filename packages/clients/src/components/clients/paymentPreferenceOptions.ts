import {
  PAYMENT_TERMS,
  PREFERRED_PAYMENT_METHODS,
  type PaymentTerms,
  type PreferredPaymentMethod,
} from '@alga-psa/shared/billingClients/paymentPreferences';

/**
 * Localized options for payment terms and preferred payment method, shared by
 * the client billing form and the billing profile settings so both offer the
 * same keys with the same labels (plan F003).
 *
 * The label maps are typed as complete records over the shared key lists, so
 * adding a key to `paymentPreferences.ts` fails to compile here until it has a
 * label. Keys stay literal for the i18n extraction tooling.
 */

/** The slice of the i18n `t` function these helpers need. */
type Translate = (key: string, options: { defaultValue: string }) => string;

export interface PaymentPreferenceOption<T extends string> {
  value: T;
  label: string;
}

export function paymentMethodLabels(t: Translate): Record<PreferredPaymentMethod, string> {
  return {
    credit_card: t('billingConfigForm.paymentMethods.creditCard', { defaultValue: 'Credit Card' }),
    bank_transfer: t('billingConfigForm.paymentMethods.bankTransfer', { defaultValue: 'Bank Transfer' }),
    check: t('billingConfigForm.paymentMethods.check', { defaultValue: 'Check' }),
  };
}

export function paymentTermsLabels(t: Translate): Record<PaymentTerms, string> {
  return {
    net_30: t('billingConfigForm.paymentTerms.net30', { defaultValue: 'Net 30' }),
    net_15: t('billingConfigForm.paymentTerms.net15', { defaultValue: 'Net 15' }),
    due_on_receipt: t('billingConfigForm.paymentTerms.dueOnReceipt', { defaultValue: 'Due on Receipt' }),
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
