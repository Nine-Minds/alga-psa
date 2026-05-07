import { cache } from 'react';
import { getDocumentByClientId } from '@alga-psa/documents/actions/documentActions';
import { isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { getContactsByClient } from '@alga-psa/clients/actions';
import { getClientById } from '@alga-psa/clients/actions';
import { notFound } from 'next/navigation';
import { ClientDetails } from '@alga-psa/clients';
import { getSurveyClientSummary } from '@alga-psa/surveys/actions/survey-actions/surveyDashboardActions';
import { AIChatContextBoundary } from '@product/chat/context';
import { getCurrentTenantProduct } from '@/lib/productAccess';
import type { Metadata } from 'next';


const getCachedClient = cache((id: string) => getClientById(id));

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  try {
    const { id } = await params;
    const client = await getCachedClient(id);
    if (client && 'client_name' in client) {
      return { title: client.client_name };
    }
  } catch (error) {
    console.error('[generateMetadata] Failed to fetch client title:', error);
  }
  return { title: 'Client Details' };
}

const ClientPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const isAlgadesk = (await getCurrentTenantProduct()) === 'algadesk';

  try {
    // First check if client exists (uses React.cache — deduped with generateMetadata)
    const client = await getCachedClient(id);

    if (!client) {
      return notFound();
    }

    // Fetch additional data in parallel
    const [documentsResult, contacts, surveySummary] = await Promise.all([
      isAlgadesk ? Promise.resolve([]) : getDocumentByClientId(id),
      getContactsByClient(id, 'all'),
      (isAlgadesk ? Promise.resolve(null) : getSurveyClientSummary(id)).catch((error) => {
        console.error('[ClientPage] Failed to load survey summary', error);
        return null;
      })
    ]);
    const documents = isActionPermissionError(documentsResult) ? [] : documentsResult;

    return (
      <AIChatContextBoundary
        value={{
          pathname: `/msp/clients/${id}`,
          screen: {
            key: 'clients.detail',
            label: 'Client Details',
          },
          record: {
            type: 'client',
            id,
          },
        }}
      >
        <div className="w-full px-4">
          <ClientDetails
            client={client}
            documents={documents}
            contacts={contacts}
            isInDrawer={false}
            surveySummary={surveySummary}
            isAlgadeskMode={isAlgadesk}
          />
        </div>
      </AIChatContextBoundary>
    );
  } catch (error) {
    console.error(`Error fetching data for client with id ${id}:`, error);
    throw error; // Let Next.js error boundary handle it
  }
}

export default ClientPage;
