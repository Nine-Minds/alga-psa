import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import QuoteApprovalDashboard from '@alga-psa/billing/components/billing-dashboard/quotes/QuoteApprovalDashboard';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.quoteApprovals.title', { defaultValue: 'Quote Approvals' }),
  };
}

export default function QuoteApprovalsPage() {
  return <QuoteApprovalDashboard />;
}

export const dynamic = 'force-dynamic';
