import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getSession } from '@alga-psa/auth';
import { getOpportunity } from '@alga-psa/opportunities/actions';
import { getOpportunityDraftingAvailability } from '@enterprise/lib/opportunities/draftingActions';
import { getManagementAvailability } from '@enterprise/lib/opportunities/actions';
import { OpportunityDetailWithDrafting } from '@/components/opportunities/OpportunityDetailWithDrafting';
import { enforceServerProductRoute } from '@/lib/serverProductRouteGuard';

export const metadata: Metadata = {
  title: 'Opportunity',
};

export default async function OpportunityDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ opportunityId: string }>;
  searchParams?: Promise<{ draft?: string }>;
}) {
  const boundary = await enforceServerProductRoute({ pathname: '/msp/opportunities', scope: 'msp' });
  if (boundary) {
    return boundary;
  }

  const session = await getSession();
  if (!session?.user) {
    redirect('/auth/msp/signin');
  }

  const { opportunityId } = await params;
  try {
    const [detail, draftingAvailable, managementAvailable] = await Promise.all([
      getOpportunity(opportunityId),
      getOpportunityDraftingAvailability().catch(() => false),
      getManagementAvailability().catch(() => false),
    ]);
    const wantsDraft = (await searchParams)?.draft === '1';
    return (
      <div className="p-6">
        <OpportunityDetailWithDrafting
          detail={detail}
          draftingAvailable={draftingAvailable}
          managementAvailable={managementAvailable}
          autoOpenDraft={draftingAvailable && wantsDraft}
        />
      </div>
    );
  } catch (err) {
    console.error('opportunity detail: load failed', err);
    notFound();
  }
}

export const dynamic = 'force-dynamic';
