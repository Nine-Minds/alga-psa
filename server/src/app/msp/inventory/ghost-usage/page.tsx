import { GhostUsageReport } from '@alga-psa/inventory/components';
// The EE/AI classifier actions live in server/src (they read edition + add-on + tenant
// opt-in) and are passed down to the client component as props (D12), so the inventory
// package stays free of @ee imports. The CE funnel report the component fetches itself.
import {
  getGhostUsageAiStatus,
  setGhostUsageAiEnabled,
  runGhostUsageClassification,
} from '@/lib/actions/ghostUsageAiActions';
import { getSession } from '@alga-psa/auth';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { enforceServerProductRoute } from '@/lib/serverProductRouteGuard';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.inventory.ghostUsage.title', { defaultValue: 'Ghost Usage' }),
  };
}

export default async function GhostUsagePage() {
  const boundary = await enforceServerProductRoute({ pathname: '/msp/inventory/ghost-usage', scope: 'msp' });
  if (boundary) {
    return boundary;
  }

  const session = await getSession();
  if (!session?.user) {
    redirect('/auth/msp/signin');
  }

  return (
    <GhostUsageReport
      getAiStatus={getGhostUsageAiStatus}
      setAiEnabled={setGhostUsageAiEnabled}
      runAiClassification={runGhostUsageClassification}
    />
  );
}

export const dynamic = 'force-dynamic';
