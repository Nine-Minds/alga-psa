import { redirect } from 'next/navigation';
import { getClientPortalInvoicePaymentLink } from 'server/src/lib/actions/client-portal-actions/client-payment';
import { PaymentRedirect } from './PaymentRedirect';

interface PayInvoicePageProps {
  params: {
    invoiceId: string;
  };
}

/**
 * Invoice Payment Page
 *
 * This page retrieves the payment link for an invoice and redirects
 * the customer to the Stripe Checkout page.
 *
 * If no payment link is available (e.g., payment not configured or
 * invoice already paid), it redirects back to the invoice detail page.
 */
export default async function PayInvoicePage({ params }: PayInvoicePageProps) {
  const { invoiceId } = params;

  try {
    const result = await getClientPortalInvoicePaymentLink(invoiceId);

    if (result.success && result.data?.paymentUrl) {
      // Use client component for external redirect (handles URLs with fragments properly)
      return <PaymentRedirect url={result.data.paymentUrl} />;
    }

    // If no payment URL, redirect back to billing with message
    if (result.error === 'already_paid') {
      redirect(`/client-portal/billing?message=invoice_already_paid`);
    }

    if (result.error === 'payment_not_configured') {
      redirect(`/client-portal/billing?message=payment_not_available`);
    }

    // Default redirect back to billing
    redirect('/client-portal/billing');
  } catch (error) {
    // On any error, redirect back to billing
    redirect('/client-portal/billing?message=payment_error');
  }
}
