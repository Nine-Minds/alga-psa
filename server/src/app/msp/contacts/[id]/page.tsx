import { notFound } from 'next/navigation';
import ContactDetails from 'server/src/components/contacts/ContactDetails';
import { IContact } from 'server/src/interfaces/contact.interfaces';
import { IClient } from 'server/src/interfaces/client.interfaces';
import { IDocument } from 'server/src/interfaces/document.interface';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { getDocumentsByEntity } from 'server/src/lib/actions/document-actions/documentActions';
import { getContactByContactNameId } from 'server/src/lib/actions/contact-actions/contactActions';
import { getAllClients } from 'server/src/lib/actions/client-actions/clientActions';
import { getContactPortalPermissions } from 'server/src/lib/actions/permission-actions';

interface ContactDetailPageProps {
  params: Promise<{ id: string }>;
}

const ContactDetailPage = async ({ params }: ContactDetailPageProps) => {
  const { id } = await params;

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
    const [clients, documentsResponse, permissions] = await Promise.all([
      getAllClients(),
      getDocumentsByEntity(id, 'contact'),
      getContactPortalPermissions()
    ]);

    // Handle both array and paginated response formats
    const documents = Array.isArray(documentsResponse)
      ? documentsResponse
      : documentsResponse.documents || [];

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
