import type { Metadata } from 'next';
import QuoteApprovalDashboard from '@alga-psa/billing/components/billing-dashboard/quotes/QuoteApprovalDashboard';

export const metadata: Metadata = {
  title: 'Quote Approvals',
};

export default function QuoteApprovalsPage() {
  return <QuoteApprovalDashboard />;
}

export const dynamic = 'force-dynamic';
