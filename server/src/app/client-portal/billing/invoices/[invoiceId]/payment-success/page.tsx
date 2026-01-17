import { Suspense } from 'react';
import { PaymentSuccessContent } from '@alga-psa/client-portal/components';

interface PaymentSuccessPageProps {
  params: {
    invoiceId: string;
  };
  searchParams: {
    session_id?: string;
  };
}

/**
 * Payment Success Page
 *
 * Displayed after a customer completes payment via Stripe Checkout.
 * Shows payment confirmation and next steps.
 */
export default function PaymentSuccessPage({ params, searchParams }: PaymentSuccessPageProps) {
  return (
    <Suspense fallback={<PaymentSuccessLoading />}>
      <PaymentSuccessContent
        invoiceId={params.invoiceId}
        sessionId={searchParams.session_id}
      />
    </Suspense>
  );
}

function PaymentSuccessLoading() {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="animate-pulse text-center">
        <div className="h-16 w-16 bg-gray-200 rounded-full mx-auto mb-4" />
        <div className="h-6 bg-gray-200 rounded w-48 mx-auto mb-2" />
        <div className="h-4 bg-gray-200 rounded w-64 mx-auto" />
      </div>
    </div>
  );
}
