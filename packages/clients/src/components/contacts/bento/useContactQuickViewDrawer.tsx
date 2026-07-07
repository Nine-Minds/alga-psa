'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type { IClient, IContact, IDocument } from '@alga-psa/types';
import { useDrawer } from '@alga-psa/ui';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { useDocumentsCrossFeature } from '@alga-psa/core/context/DocumentsCrossFeatureContext';
import { getContactByContactNameId, getAllClients } from '@alga-psa/clients/actions';
import { getCurrentUserAsync } from '../../../lib/usersHelpers';
import ContactQuickView from './ContactQuickView';

/**
 * Documents load (and reload after upload) inside the drawer, so the quick
 * view never renders against a list captured before the drawer opened.
 */
function ContactQuickViewWithDocuments({
  contact,
  clients,
  userId,
  onChangesSaved,
}: {
  contact: IContact;
  clients: IClient[];
  userId: string;
  onChangesSaved?: () => void;
}) {
  const { getDocumentsByEntity } = useDocumentsCrossFeature();
  const [documents, setDocuments] = useState<IDocument[]>([]);

  const loadDocuments = useCallback(async () => {
    try {
      const response = await getDocumentsByEntity(contact.contact_name_id, 'contact');
      if (!isActionPermissionError(response)) {
        setDocuments(Array.isArray(response) ? response : response.documents || []);
      }
    } catch (error) {
      console.error('Error fetching contact documents:', error);
    }
  }, [getDocumentsByEntity, contact.contact_name_id]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  return (
    <ContactQuickView
      contact={contact}
      clients={clients}
      documents={documents}
      userId={userId}
      onDocumentCreated={loadDocuments}
      onChangesSaved={onChangesSaved}
    />
  );
}

/**
 * Open a contact's quick view in the shared drawer from just an id — one hop
 * to full contact details instead of contacts-list → row → quick view.
 * (Contacts.tsx and ClientContactsList still inline this shape with their
 * own list-refresh concerns; they're candidates to converge on this hook.)
 */
export function useContactQuickViewDrawer(): (
  contactId: string,
  options?: { onChangesSaved?: () => void },
) => Promise<void> {
  const { openDrawer, replaceDrawer } = useDrawer();
  const { t } = useTranslation('msp/clients');

  return useCallback(async (contactId, options) => {
    openDrawer(
      <div className="p-4 text-sm text-gray-600">
        {t('contacts.quickView.loading', { defaultValue: 'Loading contact...' })}
      </div>
    );
    try {
      const [contact, clients, currentUser] = await Promise.all([
        getContactByContactNameId(contactId),
        getAllClients(true),
        getCurrentUserAsync(),
      ]);

      if (!contact || !currentUser) {
        replaceDrawer(
          <div className="p-4 text-sm text-gray-600">
            {t('contacts.quickView.notFound', { defaultValue: 'Contact not found.' })}
          </div>
        );
        return;
      }

      replaceDrawer(
        <ContactQuickViewWithDocuments
          contact={contact}
          clients={clients}
          userId={currentUser.user_id}
          onChangesSaved={options?.onChangesSaved}
        />
      );
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : t('contacts.quickView.loadFailed', { defaultValue: 'Failed to load contact.' });
      replaceDrawer(<div className="p-4 text-sm text-red-600">{message}</div>);
    }
  }, [openDrawer, replaceDrawer, t]);
}
