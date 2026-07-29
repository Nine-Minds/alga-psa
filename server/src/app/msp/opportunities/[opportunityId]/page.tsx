import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getSession } from '@alga-psa/auth';
import { getOpportunity } from '@alga-psa/opportunities/actions';
import { getOpportunityDraftingAvailability } from '@enterprise/lib/opportunities/draftingActions';
import { getManagementAvailability } from '@enterprise/lib/opportunities/actions';
import { OpportunityDetailWithDrafting } from '@/components/opportunities/OpportunityDetailWithDrafting';
import { enforceServerProductRoute } from '@/lib/serverProductRouteGuard';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ opportunityId: string }>;
}): Promise<Metadata> {
  try {
    const detail = await getOpportunity((await params).opportunityId);
    return { title: detail.title };
  } catch {
    return { title: 'Opportunity' };
  }
}

export default async function OpportunityDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ opportunityId: string }>;
  searchParams?: Promise<{ draft?: string; fromTab?: string }>;
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
    const resolvedSearchParams = await searchParams;
    const wantsDraft = resolvedSearchParams?.draft === '1';
    return (
      <div className="p-6">
        <OpportunityDetailWithDrafting
          detail={detail}
          draftingAvailable={draftingAvailable}
          managementAvailable={managementAvailable}
          autoOpenDraft={draftingAvailable && wantsDraft}
          returnTab={resolvedSearchParams?.fromTab}
        />
      </div>
    );
  } catch (err) {
    console.error('opportunity detail: load failed', err);
    notFound();
  }
}

export const dynamic = 'force-dynamic';
