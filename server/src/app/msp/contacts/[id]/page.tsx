import { cache } from 'react';
import { notFound } from 'next/navigation';
import { ContactDetails } from '@alga-psa/clients';
import type { IDocument } from '@alga-psa/types';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { getDocumentsByEntity } from '@alga-psa/documents/actions/documentActions';
import { isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { getContactByContactNameId } from '@alga-psa/clients/actions';
import { getAllClients } from '@alga-psa/clients/actions';
import { getContactPortalPermissions } from '@alga-psa/auth/actions';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { AIChatContextBoundary } from '@product/chat/context';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import type { Metadata } from 'next';

const getCachedContact = cache((id: string) => getContactByContactNameId(id));

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  try {
    const { id } = await params;
    const contact = await getCachedContact(id);
    if (contact) {
      return { title: contact.full_name };
    }
  } catch (error) {
    console.error('[generateMetadata] Failed to fetch contact title:', error);
  }
  return { title: 'Contact Details' };
}

interface ContactDetailPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

const ContactDetailPage = async ({ params, searchParams }: ContactDetailPageProps) => {
  const [{ id }, resolvedSearchParams] = await Promise.all([params, searchParams]);
  const tab = typeof resolvedSearchParams.tab === 'string' ? resolvedSearchParams.tab.toLowerCase() : null;
  const { t } = await getServerTranslation(undefined, 'common');

  try {
    // Fetch user data first for authorization
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return (
        <div className="p-6">
          <Alert variant="destructive">
            <AlertDescription>
              <p className="font-semibold">{t('status.error')}</p>
              <p>{t('pages.errors.userNotAuthenticated')}</p>
            </AlertDescription>
          </Alert>
        </div>
      );
    }

    // Fetch contact data (uses React.cache — deduped with generateMetadata)
    const contact = await getCachedContact(id);
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
      if (!isActionPermissionError(documentsResponse)) {
        documents = Array.isArray(documentsResponse)
          ? documentsResponse
          : documentsResponse.documents || [];
      }
    }

    return (
      <AIChatContextBoundary
        value={{
          pathname: `/msp/contacts/${id}`,
          screen: {
            key: 'contacts.detail',
            label: 'Contact Details',
          },
          record: {
            type: 'contact',
            id,
          },
        }}
      >
        <div className="p-6">
          <ContactDetails
            contact={contact}
            clients={clients}
            documents={documents}
            userId={currentUser.user_id}
            userPermissions={permissions}
          />
        </div>
      </AIChatContextBoundary>
    );
  } catch (error) {
    console.error(`Error fetching data for contact with id ${id}:`, error);
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertDescription>
            <p className="font-semibold">{t('pages.errors.contactLoadError', { defaultValue: 'Error loading contact' })}</p>
            <p>{error instanceof Error ? error.message : t('pages.errors.unknownError', { defaultValue: 'Unknown error occurred' })}</p>
          </AlertDescription>
        </Alert>
      </div>
    );
  }
};

export default ContactDetailPage;

export const dynamic = "force-dynamic";
