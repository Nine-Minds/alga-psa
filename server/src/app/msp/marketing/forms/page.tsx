import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@alga-psa/auth';
import { listCaptureForms, listMarketingCampaigns } from '@alga-psa/marketing/actions';
import { CaptureFormsList } from '@alga-psa/marketing/components';
import type { IMarketingCampaign, IMarketingCaptureForm } from '@alga-psa/types';
import { enforceServerProductRoute } from '@/lib/serverProductRouteGuard';

export const metadata: Metadata = {
  title: 'Marketing Forms',
};

export default async function MarketingFormsPage() {
  const boundary = await enforceServerProductRoute({ pathname: '/msp/marketing/forms', scope: 'msp' });
  if (boundary) {
    return boundary;
  }

  const session = await getSession();
  if (!session?.user) {
    redirect('/auth/msp/signin');
  }

  let items: IMarketingCaptureForm[] = [];
  let campaigns: IMarketingCampaign[] = [];
  try {
    [items, campaigns] = await Promise.all([listCaptureForms(), listMarketingCampaigns()]);
  } catch (err) {
    console.error('marketing forms: initial load failed', err);
  }

  return <CaptureFormsList items={items} campaigns={campaigns} />;
}

export const dynamic = 'force-dynamic';
