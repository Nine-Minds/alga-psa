'use client';

import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import type { IClient, IContact } from '@alga-psa/types';
import QuickAddContact from '@alga-psa/clients/components/contacts/QuickAddContact';
import { getAllClients } from '@alga-psa/clients/actions/queryActions';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  type QuickCreateRouteCloseMode,
  useQuickCreateRouteClose,
} from './useQuickCreateRouteClose';

interface CreateContactRouteClientProps {
  closeMode: QuickCreateRouteCloseMode;
}

export default function CreateContactRouteClient({ closeMode }: CreateContactRouteClientProps) {
  const { t } = useTranslation('msp/core');
  const { close, router } = useQuickCreateRouteClose(closeMode, '/msp/contacts');
  const [clients, setClients] = useState<IClient[]>([]);
  const [isLoadingClients, setIsLoadingClients] = useState(true);

  useEffect(() => {
    getAllClients(false)
      .then(setClients)
      .catch((error) => {
        handleError(
          error,
          t('quickCreate.errors.loadClients', { defaultValue: 'Failed to load clients' }),
        );
      })
      .finally(() => setIsLoadingClients(false));
  }, [t]);

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

  if (isLoadingClients) {
    return (
      <Dialog isOpen={true} onClose={close} title={t('quickCreate.dialogTitles.contact', { defaultValue: 'Add New Contact' })}>
        <DialogContent className="max-w-2xl">
          <div className="flex justify-center items-center p-8">
            <LoadingIndicator />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <QuickAddContact
      isOpen={true}
      onClose={close}
      onContactAdded={handleContactAdded}
      clients={clients}
    />
  );
}
