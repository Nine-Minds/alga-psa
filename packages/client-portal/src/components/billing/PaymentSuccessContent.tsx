'use client';

import { useEffect, useState } from 'react';
import { useCurrencyFormat } from '@alga-psa/ui/lib';
import { ArrowLeft, CheckCircle, Clock, FileText, XCircle } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent } from '@alga-psa/ui/components/Card';
import { verifyClientPortalPayment } from '@alga-psa/client-portal/actions/clientPaymentActions';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface PaymentSuccessContentProps {
  invoiceId: string;
  sessionId?: string;
}

type PaymentStatus = 'verifying' | 'success' | 'pending' | 'failed';

export default function PaymentSuccessContent({ invoiceId, sessionId }: PaymentSuccessContentProps) {
  const { t } = useTranslation('client-portal');
  const { money } = useCurrencyFormat();
  const [status, setStatus] = useState<PaymentStatus>('verifying');
  const [invoiceNumber, setInvoiceNumber] = useState<string>('');
  const [amount, setAmount] = useState<number>(0);
  const [currencyCode, setCurrencyCode] = useState<string>('USD');
  const [error, setError] = useState<string>('');
  const [servicePeriodSummary, setServicePeriodSummary] = useState<string | null>(null);

  useEffect(() => {
    const verifyPayment = async () => {
      if (!sessionId) {
        setStatus('pending');
        return;
      }

      try {
        const result = await verifyClientPortalPayment(invoiceId, sessionId);

        if (result.success && result.data) {
          setInvoiceNumber(result.data.invoiceNumber || '');
          setAmount(result.data.amount || 0);
          setCurrencyCode(result.data.currencyCode || 'USD');
          setServicePeriodSummary(
            result.data.servicePeriodStart || result.data.servicePeriodEnd
              ? `${result.data.servicePeriodStart ?? t('billing.paymentSuccess.unknownStart', { defaultValue: 'Unknown start' })} - ${result.data.servicePeriodEnd ?? t('billing.paymentSuccess.unknownEnd', { defaultValue: 'Unknown end' })}`
              : null
          );

          if (result.data.status === 'succeeded') {
            setStatus('success');
          } else if (result.data.status === 'pending' || result.data.status === 'processing') {
            setStatus('pending');
          } else {
            setStatus('failed');
            setError(result.data.message || t('billing.paymentSuccess.errors.verificationFailed', { defaultValue: 'Payment verification failed' }));
          }
        } else {
          setStatus('failed');
          setError(result.error?.message || t('billing.paymentSuccess.errors.verifyFailed', { defaultValue: 'Failed to verify payment' }));
        }
      } catch (err) {
        console.error('Payment verification error:', err);
        setStatus('failed');
        setError(t('billing.paymentSuccess.errors.unexpected', { defaultValue: 'An error occurred while verifying your payment' }));
      }
    };

    verifyPayment();
  }, [invoiceId, sessionId, t]);

  // Tenant locale via CurrencyFormatProvider; the paid invoice's own currency
  // (from the verify response) overrides the tenant default.
  const formatCurrency = (cents: number) => money(cents, currencyCode);

  return (
    <div className="max-w-lg mx-auto py-12 px-4">
      <Card>
        <CardContent className="pt-8 pb-6 text-center">
          {status === 'verifying' && (
            <>
              <div className="flex justify-center mb-4">
                <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                  <Clock className="h-8 w-8 text-primary animate-pulse" />
                </div>
              </div>
              <h1 className="text-2xl font-semibold text-gray-900 mb-2">{t('billing.paymentSuccess.verifying.title', { defaultValue: 'Verifying Payment' })}</h1>
              <p className="text-gray-600">{t('billing.paymentSuccess.verifying.description', { defaultValue: 'Please wait while we confirm your payment...' })}</p>
            </>
          )}

          {status === 'success' && (
            <>
              <div className="flex justify-center mb-4">
                <div className="h-16 w-16 rounded-full bg-success/10 flex items-center justify-center">
                  <CheckCircle className="h-8 w-8 text-success" />
                </div>
              </div>
              <h1 className="text-2xl font-semibold text-gray-900 mb-2">{t('billing.paymentSuccess.success.title', { defaultValue: 'Payment Successful!' })}</h1>
              <p className="text-gray-600 mb-6">
                {/* Whole sentences, not fragments: a translator cannot reorder
                    glued-together pieces, and a leading space inside a value is
                    the first thing a translation pass trims. */}
                {invoiceNumber
                  ? t('billing.paymentSuccess.success.thankYouForInvoice', {
                      defaultValue: 'Thank you for your payment for Invoice #{{invoiceNumber}}.',
                      invoiceNumber,
                    })
                  : t('billing.paymentSuccess.success.thankYou', { defaultValue: 'Thank you for your payment.' })}
                {amount > 0 && ` ${t('billing.paymentSuccess.success.amountPaid', { defaultValue: 'Amount paid: {{amount}}.', amount: formatCurrency(amount) })}`}
              </p>
              <p className="text-sm text-gray-500 mb-6">
                {t('billing.paymentSuccess.success.confirmationEmail', { defaultValue: 'A confirmation email will be sent to your registered email address.' })}
              </p>
              {servicePeriodSummary ? (
                <div className="mb-6 rounded-md bg-slate-50 p-4 text-left">
                  <p className="text-sm font-medium text-slate-900">{t('billing.paymentSuccess.servicePeriod.title', { defaultValue: 'Service Period Summary' })}</p>
                  <p className="mt-1 text-sm text-slate-600">{servicePeriodSummary}</p>
                  <p className="mt-2 text-sm text-slate-600">
                    {t('billing.paymentSuccess.servicePeriod.description', { defaultValue: "This summary comes from the invoice's recurring detail periods, not from invoice-header billing dates alone." })}
                  </p>
                </div>
              ) : null}
            </>
          )}

          {status === 'pending' && (
            <>
              <div className="flex justify-center mb-4">
                <div className="h-16 w-16 rounded-full bg-warning/10 flex items-center justify-center">
                  <Clock className="h-8 w-8 text-warning" />
                </div>
              </div>
              <h1 className="text-2xl font-semibold text-gray-900 mb-2">{t('billing.paymentSuccess.pending.title', { defaultValue: 'Payment Processing' })}</h1>
              <p className="text-gray-600 mb-6">
                {t('billing.paymentSuccess.pending.description', { defaultValue: 'Your payment is being processed. This may take a few moments. You will receive a confirmation email once the payment is complete.' })}
              </p>
            </>
          )}

          {status === 'failed' && (
            <>
              <div className="flex justify-center mb-4">
                <div className="h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center">
                  <XCircle className="h-8 w-8 text-destructive" />
                </div>
              </div>
              <h1 className="text-2xl font-semibold text-gray-900 mb-2">{t('billing.paymentSuccess.failed.title', { defaultValue: 'Payment Verification Failed' })}</h1>
              <p className="text-gray-600 mb-6">
                {error || t('billing.paymentSuccess.failed.description', { defaultValue: 'We could not confirm your payment. Please contact support.' })}
              </p>
            </>
          )}

          <div className="mt-8 flex flex-col gap-3">
            <Button id="back-to-billing-button" variant="soft" asChild>
              <Link href="/client-portal/billing" id="back-to-billing-button">
                <ArrowLeft className="h-4 w-4 mr-2" />
                {t('billing.paymentSuccess.actions.backToBilling', { defaultValue: 'Back to Billing' })}
              </Link>
            </Button>

            {status === 'success' && (
              <Button id="view-invoice-button" variant="default" asChild>
                <Link
                  href={`/client-portal/billing/invoices/${invoiceId}`}
                  id="view-invoice-button"
                >
                  <FileText className="h-4 w-4 mr-2" />
                  {t('billing.paymentSuccess.actions.viewInvoice', { defaultValue: 'View Invoice' })}
                </Link>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
