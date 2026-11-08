'use client';

import React, { useCallback } from 'react';
import type { IContact } from '@alga-psa/types';
import { useDrawer } from '@alga-psa/ui';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getContactByContactNameId } from '@alga-psa/clients/actions';
import ContactDetailsEdit from '../ContactDetailsEdit';

/**
 * Open a contact's edit form in the shared drawer from just an id.
 *
 * The change-client picker in ContactDetailsEdit searches the whole tenant on the server,
 * so no client list is loaded or threaded in here. That keeps the alga0002338 guarantee
 * (the picker offers every tenant client, never a page-scoped list) by construction.
 */
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
      const contact = await getContactByContactNameId(contactId);

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
