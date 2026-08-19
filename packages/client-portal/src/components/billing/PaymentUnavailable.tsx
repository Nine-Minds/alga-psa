'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useFeatureFlag } from '@alga-psa/ui';
import { ArrowLeft, Loader2, RefreshCw, XCircle } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent } from '@alga-psa/ui/components/Card';
import {
  getClientPortalInvoicePaymentLink,
  type ClientPaymentErrorCode,
} from '@alga-psa/client-portal/actions/clientPaymentActions';

interface PaymentUnavailableProps {
  code: ClientPaymentErrorCode;
  invoiceId: string;
  retryable: boolean;
}

function billingBackUrl(invoiceId: string): string {
  const params = new URLSearchParams({ tab: 'invoices', invoiceId });
  return `/client-portal/billing?${params.toString()}`;
}

function reasonKey(code: ClientPaymentErrorCode): string {
  switch (code) {
    case 'payment_not_configured':
      return 'paymentUnavailable.notConfigured';
    case 'payment_link_creation_failed':
      return 'paymentUnavailable.creationFailed';
    case 'already_paid':
      return 'paymentUnavailable.alreadyPaid';
    case 'invoice_unavailable':
      return 'paymentUnavailable.invoiceUnavailable';
    case 'access_denied':
      return 'paymentUnavailable.accessDenied';
    default:
      return 'paymentUnavailable.generic';
  }
}

/**
 * Failure state shown on the portal Pay page when a payment link cannot be
 * created or online payment is not configured.
 *
 * While `release-v1-5-feature` resolves it renders the existing loading
 * treatment; when disabled it preserves the legacy Billing redirect; when
 * enabled it explains the failure, offers a retry for creation failures, and
 * links back to the invoices tab.
 */
export function PaymentUnavailable({ code, invoiceId, retryable }: PaymentUnavailableProps) {
  const { t } = useTranslation('features/billing');
  const { enabled, loading } = useFeatureFlag('release-v1-5-feature');
  const [retrying, setRetrying] = useState(false);
  const [retryMessage, setRetryMessage] = useState('');

  useEffect(() => {
    if (!loading && !enabled) {
      window.location.replace(billingBackUrl(invoiceId));
    }
  }, [loading, enabled, invoiceId]);

  const handleTryAgain = useCallback(async () => {
    setRetrying(true);
    setRetryMessage('');
    try {
      const result = await getClientPortalInvoicePaymentLink(invoiceId);
      if (result.success && result.data?.paymentUrl) {
        window.location.href = result.data.paymentUrl;
        return;
      }
      if (result.error?.code === 'already_paid') {
        window.location.replace(billingBackUrl(invoiceId));
        return;
      }
      setRetryMessage(t('paymentUnavailable.retryFailed', { defaultValue: 'We still could not start the payment. Please try again in a moment.' }));
    } catch {
      setRetryMessage(t('paymentUnavailable.retryFailed', { defaultValue: 'We still could not start the payment. Please try again in a moment.' }));
    } finally {
      setRetrying(false);
    }
  }, [invoiceId, t]);

  if (loading || !enabled) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500 mx-auto mb-4"></div>
          <p className="text-gray-600">{t('paymentUnavailable.loading', { defaultValue: 'Loading...' })}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto py-12 px-4">
      <Card>
        <CardContent className="pt-8 pb-6 text-center">
          <div className="flex justify-center mb-4">
            <div className="h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center">
              <XCircle className="h-8 w-8 text-destructive" />
            </div>
          </div>
          <h1 className="text-2xl font-semibold text-gray-900 mb-2">
            {t('paymentUnavailable.title', { defaultValue: 'Payment Unavailable' })}
          </h1>
          <p className="text-gray-600 mb-6">{t(reasonKey(code), { defaultValue: 'Online payment could not be started.' })}</p>
          {retryMessage ? <p className="text-sm text-gray-500 mb-6">{retryMessage}</p> : null}

          <div className="mt-8 flex flex-col gap-3">
            {retryable && (
              <Button id="try-again-button" variant="default" onClick={handleTryAgain} disabled={retrying}>
                <RefreshCw className="h-4 w-4 mr-2" />
                {t('paymentUnavailable.tryAgain', { defaultValue: 'Try again' })}
              </Button>
            )}
            <Button id="back-to-billing-button" variant="soft" asChild>
              <Link href={billingBackUrl(invoiceId)} id="back-to-billing-link">
                <ArrowLeft className="h-4 w-4 mr-2" />
                {t('paymentUnavailable.backToBilling', { defaultValue: 'Back to billing' })}
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
      {retrying ? (
        <div className="flex items-center justify-center mt-6">
          <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
        </div>
      ) : null}
    </div>
  );
}
