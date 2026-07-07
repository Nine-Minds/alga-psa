import { cache } from 'react';
import { notFound } from 'next/navigation';
import { ContactBentoLayout } from '@alga-psa/clients';
import type { IDocument } from '@alga-psa/types';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { getDocumentsByEntity } from '@alga-psa/documents/actions/documentActions';
import { isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import {
  getContactByContactNameId,
  getContactPortalSummary,
  getContactRelatedWork,
  getContactStats,
  getContactTicketsSummary,
  getInteractionsForEntity,
} from '@alga-psa/clients/actions';
import { getAllClients } from '@alga-psa/clients/actions';
import { getContactPortalPermissions } from '@alga-psa/auth/actions';
import { buildCreateTicketHref } from '@alga-psa/tickets/lib/createTicketRoute';
import { findTagsByEntityIds } from '@alga-psa/tags/actions';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { AIChatContextBoundary } from '@product/chat/context';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { getCurrentTenantProduct } from '@/lib/productAccess';
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
}

async function settledValue<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    console.error('[contact-bento] Optional data fetch failed:', error);
    return fallback;
  }
}

const ContactDetailPage = async ({ params }: ContactDetailPageProps) => {
  const { id } = await params;
  const { t } = await getServerTranslation(undefined, 'common');
  const isAlgaDesk = (await getCurrentTenantProduct()) === 'algadesk';

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

    const [clients, permissions, documentsResponse, interactions, tags, stats, ticketsSummary, relatedWork, portalSummary] = await Promise.all([
      getAllClients(),
      getContactPortalPermissions(),
      isAlgaDesk ? Promise.resolve([]) : settledValue(getDocumentsByEntity(id, 'contact'), [] as any),
      settledValue(getInteractionsForEntity(id, 'contact'), []),
      settledValue(findTagsByEntityIds([id], 'contact'), []),
      settledValue(getContactStats(id), null),
      settledValue(getContactTicketsSummary(id), null),
      settledValue(getContactRelatedWork(id), null),
      settledValue(getContactPortalSummary(id), null),
    ]);

    let documents: IDocument[] = [];
    if (!isActionPermissionError(documentsResponse)) {
      documents = Array.isArray(documentsResponse)
        ? documentsResponse
        : documentsResponse.documents || [];
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
          <ContactBentoLayout
            contact={contact}
            clients={clients}
            documents={documents}
            showDocuments={!isAlgaDesk}
            interactions={interactions}
            tags={tags}
            stats={stats}
            ticketsSummary={ticketsSummary}
            relatedWork={relatedWork}
            portalSummary={portalSummary}
            newTicketHref={buildCreateTicketHref({
              contact: { id: contact.contact_name_id, name: contact.full_name },
              ...(contact.client_id
                ? {
                    client: {
                      id: contact.client_id,
                      name: clients.find((client) => client.client_id === contact.client_id)?.client_name ?? '',
                    },
                  }
                : {}),
            })}
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
