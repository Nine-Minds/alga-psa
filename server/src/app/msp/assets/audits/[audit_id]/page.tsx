import { MspAssetAuditDetail } from '@alga-psa/msp-composition/assets';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { getSession } from '@alga-psa/auth';
import { redirect } from 'next/navigation';
import { enforceServerProductRoute } from '@/lib/serverProductRouteGuard';

interface Props {
  params: Promise<{ audit_id: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.assets.audits.detailTitle', { defaultValue: 'Site audit' }),
  };
}

export default async function AssetAuditDetailPage({ params }: Props) {
  const boundary = await enforceServerProductRoute({ pathname: '/msp/assets/audits', scope: 'msp' });
  if (boundary) return boundary;
  const session = await getSession();
  if (!session?.user) redirect('/auth/msp/signin');
  const { audit_id } = await params;
  return <MspAssetAuditDetail auditId={audit_id} />;
}

export const dynamic = 'force-dynamic';
