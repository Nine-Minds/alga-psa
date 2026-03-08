import { BillingOverview } from '@alga-psa/client-portal/components';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Billing',
};

export default function BillingPage() {
  return <BillingOverview />;
}
