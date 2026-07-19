import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@alga-psa/auth';
import { getMarketingAccess } from '@alga-psa/marketing/actions';
import { getMarketingSequenceDetail, listMarketingSequences } from '@alga-psa/marketing/actions';
import type { SequenceDetail } from '@alga-psa/marketing/lib';
import { SequencesView, MarketingAccessBoundary } from '@alga-psa/marketing/components';
import { getAllContacts } from '@alga-psa/clients/actions';
import type { IContact, IMarketingSequence } from '@alga-psa/types';
import { enforceServerProductRoute } from '@/lib/serverProductRouteGuard';

export const metadata: Metadata = {
  title: 'Marketing Sequences',
};

export default async function MarketingSequencesPage() {
  const boundary = await enforceServerProductRoute({ pathname: '/msp/marketing/sequences', scope: 'msp' });
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

  let sequences: IMarketingSequence[] = [];
  let initialDetail: SequenceDetail | null = null;
  let contacts: IContact[] = [];
  try {
    [sequences, contacts] = await Promise.all([listMarketingSequences(), getAllContacts('all')]);
    if (sequences.length > 0) {
      initialDetail = await getMarketingSequenceDetail(sequences[0].sequence_id);
    }
  } catch (err) {
    console.error('marketing sequences: initial load failed', err);
  }

  return <SequencesView sequences={sequences} initialDetail={initialDetail} contacts={contacts} />;
}

export const dynamic = 'force-dynamic';
