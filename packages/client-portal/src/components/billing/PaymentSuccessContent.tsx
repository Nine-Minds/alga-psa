'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle, Clock, FileText, XCircle } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent } from '@alga-psa/ui/components/Card';
import { verifyClientPortalPayment } from '../../actions/clientPaymentActions';

interface PaymentSuccessContentProps {
  invoiceId: string;
  sessionId?: string;
}

type PaymentStatus = 'verifying' | 'success' | 'pending' | 'failed';

export default function PaymentSuccessContent({ invoiceId, sessionId }: PaymentSuccessContentProps) {
  const [status, setStatus] = useState<PaymentStatus>('verifying');
  const [invoiceNumber, setInvoiceNumber] = useState<string>('');
  const [amount, setAmount] = useState<number>(0);
  const [currencyCode, setCurrencyCode] = useState<string>('USD');
  const [error, setError] = useState<string>('');

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

          if (result.data.status === 'succeeded') {
            setStatus('success');
          } else if (result.data.status === 'pending' || result.data.status === 'processing') {
            setStatus('pending');
          } else {
            setStatus('failed');
            setError(result.data.message || 'Payment verification failed');
          }
        } else {
          setStatus('failed');
          setError(result.error || 'Failed to verify payment');
        }
      } catch (err) {
        console.error('Payment verification error:', err);
        setStatus('failed');
        setError('An error occurred while verifying your payment');
      }
    };

    verifyPayment();
  }, [invoiceId, sessionId]);

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currencyCode,
    }).format(cents / 100);
  };

  return (
    <div className="max-w-lg mx-auto py-12 px-4">
      <Card>
        <CardContent className="pt-8 pb-6 text-center">
          {status === 'verifying' && (
            <>
              <div className="flex justify-center mb-4">
                <div className="h-16 w-16 rounded-full bg-blue-100 flex items-center justify-center">
                  <Clock className="h-8 w-8 text-blue-600 animate-pulse" />
                </div>
              </div>
              <h1 className="text-2xl font-semibold text-gray-900 mb-2">Verifying Payment</h1>
              <p className="text-gray-600">Please wait while we confirm your payment...</p>
            </>
          )}

          {status === 'success' && (
            <>
              <div className="flex justify-center mb-4">
                <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center">
                  <CheckCircle className="h-8 w-8 text-green-600" />
                </div>
              </div>
              <h1 className="text-2xl font-semibold text-gray-900 mb-2">Payment Successful!</h1>
              <p className="text-gray-600 mb-6">
                Thank you for your payment
                {invoiceNumber && ` for Invoice #${invoiceNumber}`}.
                {amount > 0 && ` Amount paid: ${formatCurrency(amount)}.`}
              </p>
              <p className="text-sm text-gray-500 mb-6">
                A confirmation email will be sent to your registered email address.
              </p>
            </>
          )}

          {status === 'pending' && (
            <>
              <div className="flex justify-center mb-4">
                <div className="h-16 w-16 rounded-full bg-yellow-100 flex items-center justify-center">
                  <Clock className="h-8 w-8 text-yellow-600" />
                </div>
              </div>
              <h1 className="text-2xl font-semibold text-gray-900 mb-2">Payment Processing</h1>
              <p className="text-gray-600 mb-6">
                Your payment is being processed. This may take a few moments. You will receive a
                confirmation email once the payment is complete.
              </p>
            </>
          )}

          {status === 'failed' && (
            <>
              <div className="flex justify-center mb-4">
                <div className="h-16 w-16 rounded-full bg-red-100 flex items-center justify-center">
                  <XCircle className="h-8 w-8 text-red-600" />
                </div>
              </div>
              <h1 className="text-2xl font-semibold text-gray-900 mb-2">Payment Verification Failed</h1>
              <p className="text-gray-600 mb-6">
                {error || 'We could not confirm your payment. Please contact support.'}
              </p>
            </>
          )}

          <div className="mt-8 flex flex-col gap-3">
            <Button id="back-to-billing-button" variant="soft" asChild>
              <Link href="/client-portal/billing" id="back-to-billing-button">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Billing
              </Link>
            </Button>

            {status === 'success' && (
              <Button id="view-invoice-button" variant="default" asChild>
                <Link
                  href={`/client-portal/billing/invoices/${invoiceId}`}
                  id="view-invoice-button"
                >
                  <FileText className="h-4 w-4 mr-2" />
                  View Invoice
                </Link>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
