import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import ServiceRequestDefinitionEditorPage from '../ServiceRequestDefinitionEditorPage';
import { getServiceRequestDefinitionEditorDataAction } from '../actions';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ definitionId: string }>;
}): Promise<Metadata> {
  const { definitionId } = await params;
  const { t } = await getServerTranslation(undefined, 'metadata');
  const fallbackTitle = t('msp.serviceRequests.detail.fallbackTitle', {
    defaultValue: 'Service Request',
  });

  try {
    const data = await getServiceRequestDefinitionEditorDataAction(definitionId);
    const name = data?.basics.name?.trim();
    return { title: name ? name : fallbackTitle };
  } catch {
    return { title: fallbackTitle };
  }
}

export default function ServiceRequestDefinitionEditorRoute() {
  return <ServiceRequestDefinitionEditorPage />;
}
