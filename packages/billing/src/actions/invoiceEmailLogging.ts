import type { EmailMessage, EmailSendResult, IEmailProvider } from '@alga-psa/types';
import { buildFailedProviderResult, writeEmailSendResultLog } from '@alga-psa/email';

const SERVICE_NAME = 'sendInvoiceEmailAction';

export function logInvoiceEmailSendResult(
  tenantId: string,
  message: EmailMessage,
  providerResult: EmailSendResult
): void {
  void writeEmailSendResultLog({
    serviceName: SERVICE_NAME,
    tenantId,
    providerResult,
    message,
  });
}

export function logInvoiceEmailSendFailure(
  tenantId: string,
  message: EmailMessage,
  provider: Pick<IEmailProvider, 'providerId' | 'providerType'>,
  error: unknown
): void {
  void writeEmailSendResultLog({
    serviceName: SERVICE_NAME,
    tenantId,
    providerResult: buildFailedProviderResult({
      providerId: provider.providerId,
      providerType: provider.providerType,
      error,
    }),
    message,
  });
}
