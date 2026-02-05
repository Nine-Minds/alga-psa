import { notFound } from 'next/navigation';
import { ContactDetails } from '@alga-psa/clients';
import type { IDocument } from '@alga-psa/types';
import { getCurrentUser } from '@alga-psa/users/actions';
import { getDocumentsByEntity } from '@alga-psa/documents/actions/documentActions';
import { getContactByContactNameId } from '@alga-psa/clients/actions';
import { getAllClients } from '@alga-psa/clients/actions';
import { getContactPortalPermissions } from '@alga-psa/auth/actions';


interface ContactDetailPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

const ContactDetailPage = async ({ params, searchParams }: ContactDetailPageProps) => {
  const [{ id }, resolvedSearchParams] = await Promise.all([params, searchParams]);
  const tab = typeof resolvedSearchParams.tab === 'string' ? resolvedSearchParams.tab.toLowerCase() : null;

  try {
    // Fetch user data first for authorization
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return (
        <div className="p-6">
          <div className="p-4 border border-red-300 bg-red-50 rounded-md text-red-600">
            <p className="font-semibold">Error</p>
            <p>User not authenticated</p>
          </div>
        </div>
      );
    }

    // Fetch contact data
    const contact = await getContactByContactNameId(id);
    if (!contact) {
      return notFound();
    }

    // Fetch additional data in parallel
    // Only fetch documents when viewing the documents tab
    const [clients, permissions] = await Promise.all([
      getAllClients(),
      getContactPortalPermissions()
    ]);

    // Conditionally fetch documents only when on documents tab
    let documents: IDocument[] = [];
    if (tab === 'documents') {
      const documentsResponse = await getDocumentsByEntity(id, 'contact');
      documents = Array.isArray(documentsResponse)
        ? documentsResponse
        : documentsResponse.documents || [];
    }

    return (
        <div className="p-6">
          <ContactDetails
            contact={contact}
            clients={clients}
            documents={documents}
            userId={currentUser.user_id}
            userPermissions={permissions}
          />
        </div>
    );
  } catch (error) {
    console.error(`Error fetching data for contact with id ${id}:`, error);
    return (
      <div className="p-6">
        <div className="p-4 border border-red-300 bg-red-50 rounded-md text-red-600">
          <p className="font-semibold">Error loading contact</p>
          <p>{error instanceof Error ? error.message : 'Unknown error occurred'}</p>
        </div>
      </div>
    );
  }
};

export default ContactDetailPage;

export const dynamic = "force-dynamic";
