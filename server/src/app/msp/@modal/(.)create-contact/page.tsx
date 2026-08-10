import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import CreateContactRouteClient from '../../_components/CreateContactRouteClient';
import WorkspaceRouteLayout from '../../_components/WorkspaceRouteLayout';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.createContact.title', { defaultValue: 'Create Contact' }),
  };
}

export default function CreateContactModalPage() {
  return (
    <WorkspaceRouteLayout>
      <CreateContactRouteClient closeMode="back" />
    </WorkspaceRouteLayout>
  );
}
