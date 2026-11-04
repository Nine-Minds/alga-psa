'use client';

import { toast } from 'react-hot-toast';
import type { IContact } from '@alga-psa/types';
import QuickAddContact from '@alga-psa/clients/components/contacts/QuickAddContact';
import type { CreateContactPrefill } from '@alga-psa/clients/lib/createContactRoute';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  type QuickCreateRouteCloseMode,
  useQuickCreateRouteClose,
} from './useQuickCreateRouteClose';

interface CreateContactRouteClientProps {
  closeMode: QuickCreateRouteCloseMode;
  prefill?: CreateContactPrefill;
}

export default function CreateContactRouteClient({ closeMode, prefill }: CreateContactRouteClientProps) {
  const { t } = useTranslation('msp/core');
  const { close, router } = useQuickCreateRouteClose(closeMode, '/msp/contacts');
  const handleContactAdded = (contact: IContact) => {
    const contactName = `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || 'Contact';
    toast.success(
      t('quickCreate.success.contact', {
        defaultValue: '{{name}} added successfully',
        name: contactName,
      }),
    );
    router.refresh();
    window.dispatchEvent(new CustomEvent('alga:quick-create:created', { detail: { entity: 'contact' } }));
    close();
  };

  return (
    <QuickAddContact
      isOpen={true}
      onClose={close}
      onContactAdded={handleContactAdded}
      selectedClientId={prefill?.clientId ?? null}
      initialPhoneNumber={prefill?.phone ?? null}
    />
  );
}
