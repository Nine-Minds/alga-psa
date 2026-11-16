import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import SubmitOnBehalfPage from './SubmitOnBehalfPage';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');
  return {
    title: t('msp.serviceRequests.submit.title', { defaultValue: 'Submit Service Request' }),
  };
}

interface PageProps {
  searchParams?: Promise<{ clientId?: string; contactId?: string; definitionId?: string }>;
}

const asId = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

/** `clientId`, `contactId` and `definitionId` prefill the flow so entry points can deep-link. */
export default async function MspSubmitServiceRequestPage({ searchParams }: PageProps) {
  const params = searchParams ? await searchParams : undefined;
  return (
    <SubmitOnBehalfPage
      initialClientId={asId(params?.clientId)}
      initialContactId={asId(params?.contactId)}
      initialDefinitionId={asId(params?.definitionId)}
    />
  );
}
