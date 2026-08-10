import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { redirect } from 'next/navigation';
import { getSession } from '@alga-psa/auth';
import { getMarketingAccess } from '@alga-psa/marketing/actions';
import { listMarketingCampaigns, listMarketingContent } from '@alga-psa/marketing/actions';
import { ContentLibrary, MarketingAccessBoundary } from '@alga-psa/marketing/components';
import type { IMarketingCampaign, IMarketingContent } from '@alga-psa/types';
import { enforceServerProductRoute } from '@/lib/serverProductRouteGuard';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.marketing.content.title', { defaultValue: 'Marketing Content' }),
  };
}

export default async function MarketingContentPage() {
  const boundary = await enforceServerProductRoute({ pathname: '/msp/marketing/content', scope: 'msp' });
  if (boundary) {
    return boundary;
  }

  const session = await getSession();
  if (!session?.user) {
    redirect('/auth/msp/signin');
  }

  // M10: a failed guard renders a boundary, not a fake-working empty module.
  const access = await getMarketingAccess();
  if (!access.allowed) {
    return <MarketingAccessBoundary reason={access.reason ?? 'permission'} />;
  }

  let items: IMarketingContent[] = [];
  let campaigns: IMarketingCampaign[] = [];
  try {
    [items, campaigns] = await Promise.all([listMarketingContent(), listMarketingCampaigns()]);
  } catch (err) {
    console.error('marketing content: initial load failed', err);
  }

  return <ContentLibrary items={items} campaigns={campaigns} />;
}

export const dynamic = 'force-dynamic';
