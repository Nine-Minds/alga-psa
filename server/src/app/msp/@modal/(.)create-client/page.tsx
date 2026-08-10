import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import CreateClientRouteClient from '../../_components/CreateClientRouteClient';
import WorkspaceRouteLayout from '../../_components/WorkspaceRouteLayout';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.createClient.title', { defaultValue: 'Create Client' }),
  };
}

export default function CreateClientModalPage() {
  return (
    <WorkspaceRouteLayout>
      <CreateClientRouteClient closeMode="back" />
    </WorkspaceRouteLayout>
  );
}
