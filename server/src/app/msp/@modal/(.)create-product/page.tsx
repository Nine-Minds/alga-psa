import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import CreateProductRouteClient from '../../_components/CreateProductRouteClient';
import WorkspaceRouteLayout from '../../_components/WorkspaceRouteLayout';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.createProduct.title', { defaultValue: 'Create Product' }),
  };
}

export default function CreateProductModalPage() {
  return (
    <WorkspaceRouteLayout>
      <CreateProductRouteClient closeMode="back" />
    </WorkspaceRouteLayout>
  );
}
