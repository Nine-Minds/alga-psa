import { getDocumentByClientId } from '@alga-psa/documents/actions/documentActions';
import { getContactsByClient } from '@alga-psa/clients/actions';
import { getClientById } from '@alga-psa/clients/actions';
import { notFound } from 'next/navigation';
import { ClientDetails } from '@alga-psa/clients/components';
import { getSurveyClientSummary } from '@alga-psa/surveys/actions/survey-actions/surveyDashboardActions';

const ClientPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;

  try {
    // First check if client exists
    const client = await getClientById(id);

    if (!client) {
      return notFound();
    }

    // Fetch additional data in parallel
    const [documents, contacts, surveySummary] = await Promise.all([
      getDocumentByClientId(id),
      getContactsByClient(id, 'all'),
      getSurveyClientSummary(id).catch((error) => {
        console.error('[ClientPage] Failed to load survey summary', error);
        return null;
      })
    ]);

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
