import type {
  ManualInvoiceErrorCode,
  ManualInvoiceFailure,
} from '../../errors/manualInvoiceErrors';

const translatedManualInvoiceErrorCodes = new Set<ManualInvoiceErrorCode>([
  'NO_BILLING_EMAIL',
  'CLIENT_NOT_FOUND',
  'SERVICE_NOT_FOUND',
  'INVALID_QUANTITY',
  'NO_TAX_RATE',
  'DISCOUNT_TARGET_NOT_FOUND',
  'INVOICE_NUMBER_CONFLICT',
  'PERMISSION_DENIED',
  'UNEXPECTED',
]);

export type ManualInvoiceTranslation = (
  key: string,
  options?: Record<string, unknown>,
) => string;

export function translateManualInvoiceFailure(
  t: ManualInvoiceTranslation,
  result: Partial<ManualInvoiceFailure>,
): string {
  const message = result.message ?? result.error ?? 'Error generating invoice';
  if (!result.code || !translatedManualInvoiceErrorCodes.has(result.code)) {
    return message;
  }

  if (result.code === 'UNEXPECTED') {
    const ref = result.ref ?? result.params?.ref ?? 'unknown';
    return t('manualInvoices.errors.UNEXPECTED', {
      ref,
      defaultValue: `Something went wrong generating the invoice. Quote reference ${ref} when contacting support.`,
    });
  }

  return t(`manualInvoices.errors.${result.code}`, {
    ...result.params,
    defaultValue: message,
  });
}
