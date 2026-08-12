import { redirect } from 'next/navigation';
import { getClientPortalInvoicePaymentLink } from '@alga-psa/client-portal/actions/clientPaymentActions';
import { PaymentRedirect, PaymentUnavailable } from '@alga-psa/client-portal/components';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('clientPortal.billing.invoices.detail.pay.title', { defaultValue: 'Pay Invoice' }),
  };
}

interface PayInvoicePageProps {
  params: Promise<{
    invoiceId: string;
  }>;
}

function billingBackUrl(invoiceId: string): string {
  const params = new URLSearchParams({ tab: 'invoices', invoiceId });
  return `/client-portal/billing?${params.toString()}`;
}

/**
 * Invoice Payment Page
 *
 * This page retrieves the payment link for an invoice and redirects
 * the customer to the Stripe Checkout page.
 *
 * Successful link creation renders PaymentRedirect. Already-paid invoices
 * redirect to Billing outside the work catch (Next's `redirect()` throws, so
 * it must never be inside a broad try/catch that would rewrite it as a
 * payment error). Link configuration/creation failures render the flagged
 * PaymentUnavailable state instead of collapsing into a silent redirect.
 */
export default async function PayInvoicePage({ params }: PayInvoicePageProps) {
  const { invoiceId } = await params;

  let result;
  try {
    result = await getClientPortalInvoicePaymentLink(invoiceId);
  } catch (error) {
    // Unexpected error path; PaymentUnavailable (flag-gated) handles the
    // stable failure state. `redirect()` is intentionally not used here.
    result = {
      success: false,
      error: { code: 'payment_link_creation_failed', message: 'We could not start the payment. Please try again.', retryable: true },
    };
  }

  if (result.success && result.data?.paymentUrl) {
    // Use client component for external redirect (handles URLs with fragments properly)
    return <PaymentRedirect url={result.data.paymentUrl} />;
  }

  const code = result.error?.code;

  // Non-creation failures keep the existing redirect behavior.
  if (code === 'already_paid') {
    redirect(billingBackUrl(invoiceId));
  }

  // Link configuration/creation failures render the flagged failure state.
  if (code === 'payment_not_configured' || code === 'payment_link_creation_failed') {
    return (
      <PaymentUnavailable
        code={code}
        invoiceId={invoiceId}
        retryable={result.error?.retryable ?? false}
      />
    );
  }

  // Access/state failures fall back to the legacy Billing redirect.
  redirect(billingBackUrl(invoiceId));
}
