import { IClient } from 'server/src/interfaces/client.interfaces';
import { IDocument } from 'server/src/interfaces/document.interface';
import { IContact } from "server/src/interfaces/contact.interfaces";
import { getDocumentByClientId } from 'server/src/lib/actions/document-actions/documentActions';
import { getContactsByClient } from 'server/src/lib/actions/contact-actions/contactActions';
import { getClientById } from 'server/src/lib/actions/client-actions/clientActions';
import { notFound } from 'next/navigation';
import ClientDetails from 'server/src/components/clients/ClientDetails';

const ClientPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;

  try {
    // First check if client exists
    const client = await getClientById(id);

    if (!client) {
      return notFound();
    }

    // Fetch additional data in parallel
    const [documents, contacts] = await Promise.all([
      getDocumentByClientId(id),
      getContactsByClient(id, 'all')
    ]);

    return (
      <div className="mx-auto px-4">
        <ClientDetails
          client={client}
          documents={documents}
          contacts={contacts}
          isInDrawer={false}
        />
      </div>
    );
  } catch (error) {
    console.error(`Error fetching data for client with id ${id}:`, error);
    throw error; // Let Next.js error boundary handle it
  }
}

export default ClientPage;
