import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import CreateServiceRouteClient from '../../_components/CreateServiceRouteClient';
import WorkspaceRouteLayout from '../../_components/WorkspaceRouteLayout';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.createService.title', { defaultValue: 'Create Service' }),
  };
}

export default function CreateServiceModalPage() {
  return (
    <WorkspaceRouteLayout>
      <CreateServiceRouteClient closeMode="back" />
    </WorkspaceRouteLayout>
  );
}
