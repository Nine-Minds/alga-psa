'use client';

import React, { useCallback } from 'react';
import type { IContact } from '@alga-psa/types';
import { useDrawer } from '@alga-psa/ui';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getContactByContactNameId, getAllClients } from '@alga-psa/clients/actions';
import ContactDetailsEdit from '../ContactDetailsEdit';

/**
 * Open a contact's edit form in the shared drawer from just an id.
 *
 * Drawer content is fixed when the drawer opens, so the client list has to be
 * complete at that moment: it is loaded here (every client, including inactive)
 * rather than threaded in from the page. There is deliberately no fallback to a
 * page-scoped list — a shortened list is the alga0002338 bug (the change-client
 * picker offered only the client being viewed) — so a failed load shows an error.
 */
// LEVERAGE: pattern contact-drawer-loader — open loading drawer → load contact + getAllClients(true) → replaceDrawer
export function useContactEditDrawer(): (
  contactId: string,
  options?: { onSaved?: (contact: IContact) => void },
) => Promise<void> {
  const { openDrawer, replaceDrawer, closeDrawer } = useDrawer();
  const { t } = useTranslation('msp/clients');

  return useCallback(async (contactId, options) => {
    openDrawer(
      <div className="p-4 text-sm text-gray-600">
        {t('contacts.quickView.loading', { defaultValue: 'Loading contact...' })}
      </div>
    );
    try {
      const [contact, clients] = await Promise.all([
        getContactByContactNameId(contactId),
        getAllClients(true),
      ]);

      if (!contact) {
        replaceDrawer(
          <div className="p-4 text-sm text-gray-600">
            {t('contacts.quickView.notFound', { defaultValue: 'Contact not found.' })}
          </div>
        );
        return;
      }

      replaceDrawer(
        <ContactDetailsEdit
          id="client-contact-edit"
          initialContact={contact}
          clients={clients}
          isInDrawer={true}
          onSave={(updatedContact) => {
            options?.onSaved?.(updatedContact);
            closeDrawer();
          }}
          onCancel={() => closeDrawer()}
        />
      );
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : t('contacts.quickView.loadFailed', { defaultValue: 'Failed to load contact.' });
      replaceDrawer(<div className="p-4 text-sm text-red-600">{message}</div>);
    }
  }, [openDrawer, replaceDrawer, closeDrawer, t]);
}
