export type ManualInvoiceErrorCode =
  | 'NO_BILLING_EMAIL'
  | 'USAGE_RECORDS_MISSING'
  | 'USAGE_RECORDS_MISSING_ACK_REQUIRED'
  | 'USAGE_PERIOD_TOTAL_STALE'
  | 'USAGE_CALCULATION_ERROR'
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
    /**
     * Structured per-service usage-period diagnoses backing a usage failure
     * (USAGE_RECORDS_MISSING / USAGE_CALCULATION_ERROR). Lets a failed
     * preview keep full remediation context — client, line, service,
     * configuration, and canonical period — instead of flattening it into
     * string params.
     */
    public readonly usageStatuses?: import('@alga-psa/types').IUsageServicePeriodStatus[],
  ) {
    super(message);
    this.name = 'ManualInvoiceError';
  }
}
