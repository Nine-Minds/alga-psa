import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import ServiceRequestFormBuilderPage from '../../form-builder/ServiceRequestFormBuilderPage';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.serviceRequests.formBuilder.title', { defaultValue: 'Form builder' }),
  };
}

export default function ServiceRequestFormBuilderRoute() {
  return <ServiceRequestFormBuilderPage />;
}
