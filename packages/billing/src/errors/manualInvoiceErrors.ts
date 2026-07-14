export type ManualInvoiceErrorCode =
  | 'NO_BILLING_EMAIL'
  | 'CLIENT_NOT_FOUND'
  | 'SERVICE_NOT_FOUND'
  | 'INVALID_QUANTITY'
  | 'NO_TAX_RATE'
  | 'DISCOUNT_TARGET_NOT_FOUND'
  | 'INVOICE_NUMBER_CONFLICT'
  | 'PERMISSION_DENIED'
  | 'UNEXPECTED';

export type HandledManualInvoiceErrorCode = Exclude<ManualInvoiceErrorCode, 'UNEXPECTED'>;

export interface ManualInvoiceFailure {
  success: false;
  code: ManualInvoiceErrorCode;
  params?: Record<string, string>;
  message: string;
  /** @deprecated Kept for one release for consumers of the previous result shape. */
  error: string;
  ref?: string;
}

export class ManualInvoiceError extends Error {
  constructor(
    public readonly code: HandledManualInvoiceErrorCode,
    message: string,
    public readonly params: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'ManualInvoiceError';
  }
}
