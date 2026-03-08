import { getDocumentByClientId } from '@alga-psa/documents/actions/documentActions';
import { isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { getContactsByClient } from '@alga-psa/clients/actions';
import { getClientById } from '@alga-psa/clients/actions';
import { notFound } from 'next/navigation';
import { ClientDetails } from '@alga-psa/clients';
import { getSurveyClientSummary } from '@alga-psa/surveys/actions/survey-actions/surveyDashboardActions';
import type { Metadata } from 'next';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  try {
    const { id } = await params;
    const client = await getClientById(id);
    if (client && 'client_name' in client) {
      return { title: client.client_name };
    }
  } catch {}
  return { title: 'Client Details' };
}

const ClientPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;

  try {
    // First check if client exists
    const client = await getClientById(id);

    if (!client) {
      return notFound();
    }

    // Fetch additional data in parallel
    const [documentsResult, contacts, surveySummary] = await Promise.all([
      getDocumentByClientId(id),
      getContactsByClient(id, 'all'),
      getSurveyClientSummary(id).catch((error) => {
        console.error('[ClientPage] Failed to load survey summary', error);
        return null;
      })
    ]);
    const documents = isActionPermissionError(documentsResult) ? [] : documentsResult;

    return (
      <div className="w-full px-4">
        <ClientDetails
          client={client}
          documents={documents}
          contacts={contacts}
          isInDrawer={false}
          surveySummary={surveySummary}
        />
      </div>
    );
  } catch (error) {
    console.error(`Error fetching data for client with id ${id}:`, error);
    throw error; // Let Next.js error boundary handle it
  }
}

export default ClientPage;
