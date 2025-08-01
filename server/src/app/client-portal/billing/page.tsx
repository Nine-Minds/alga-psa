import BillingOverview from 'server/src/components/client-portal/billing/BillingOverview';
import ClientBillingWrapper from 'server/src/components/client-portal/billing/ClientBillingWrapper';

export default function BillingPage() {
  return (
    <ClientBillingWrapper>
      <BillingOverview />
    </ClientBillingWrapper>
  );
}