'use client';

// App shell: quick-create modal used in the MSP header.

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { QuickAddAsset } from '@alga-psa/assets/components/QuickAddAsset';
import { buildCreateTicketHref } from '@alga-psa/tickets/lib/createTicketRoute';
import QuickAddClient from '@alga-psa/clients/components/clients/QuickAddClient';
import QuickAddContact from '@alga-psa/clients/components/contacts/QuickAddContact';
import ProjectQuickAdd from '@alga-psa/projects/components/ProjectQuickAdd';
import { QuickAddProduct } from '@alga-psa/billing/components/settings/billing/QuickAddProduct';
import { QuickAddService } from '@alga-psa/billing/components/settings/billing/QuickAddService';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { IClient, IContact, IProject } from '@alga-psa/types';
import { getAllClients } from '@alga-psa/clients/actions/queryActions';
import { getServiceTypesForSelection } from '@alga-psa/billing/actions/serviceActions';
import { toast } from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export type QuickCreateType = 'ticket' | 'client' | 'contact' | 'project' | 'asset' | 'service' | 'product' | null;

interface QuickCreateDialogProps {
  type: QuickCreateType;
  onClose: () => void;
}

export function QuickCreateDialog({ type, onClose }: QuickCreateDialogProps) {
  const { t } = useTranslation('msp/core');
  const router = useRouter();
  const [clients, setClients] = useState<IClient[]>([]);
  const [isLoadingClients, setIsLoadingClients] = useState(false);
  const [serviceTypes, setServiceTypes] = useState<{ id: string; name: string; is_standard?: boolean }[]>([]);
  const [isLoadingServiceTypes, setIsLoadingServiceTypes] = useState(false);

  // Load clients when needed for projects and contacts
  useEffect(() => {
    if ((type === 'project' || type === 'contact') && clients.length === 0) {
      setIsLoadingClients(true);
      getAllClients(false)
        .then(setClients)
        .catch((error) => {
          handleError(
            error,
            t('quickCreate.errors.loadClients', { defaultValue: 'Failed to load clients' })
          );
        })
        .finally(() => setIsLoadingClients(false));
    }
  }, [type, clients.length, t]);

  // Load service types when needed for services
  useEffect(() => {
    if (type === 'service') {
      setIsLoadingServiceTypes(true);
      getServiceTypesForSelection()
        .then(setServiceTypes)
        .catch((error) => {
          handleError(
            error,
            t('quickCreate.errors.loadServiceTypes', {
              defaultValue: 'Failed to load service types',
            })
          );
        })
        .finally(() => setIsLoadingServiceTypes(false));
    }
  }, [type, t]);

  const handleAssetAdded = () => {
    toast.success(
      t('quickCreate.success.asset', { defaultValue: 'Asset created successfully' })
    );
    onClose();
    // Refresh the page to update any list that might be showing assets
    router.refresh();
  };

  // Ticket creation is a routed modal now, so the heavy rich-text editor (pulled in by
  // QuickAddTicket) stays out of the app-shell bundle. Navigate to the create-ticket route
  // and close this dispatcher; the route renders the dialog (intercepted as an overlay).
  useEffect(() => {
    if (type === 'ticket') {
      router.push(buildCreateTicketHref());
      onClose();
    }
  }, [type, router, onClose]);

  const handleClientAdded = (client: IClient) => {
    toast.success(
      t('quickCreate.success.client', {
        defaultValue: 'Client "{{name}}" created successfully',
        name: client.client_name,
      })
    );
    onClose();
    // Refresh the page to update any list that might be showing clients
    router.refresh();
    // The clients/contacts list pages fetch their own data client-side and don't react to
    // router.refresh(), so notify them to re-fetch. Event name is mirrored in
    // Clients.tsx / Contacts.tsx listeners.
    window.dispatchEvent(new CustomEvent('alga:quick-create:created', { detail: { entity: 'client' } }));
  };

  const handleContactAdded = (contact: IContact) => {
    const contactName = `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || 'Contact';
    toast.success(
      t('quickCreate.success.contact', {
        defaultValue: '{{name}} added successfully',
        name: contactName,
      })
    );
    onClose();
    // Refresh the page to update any list that might be showing contacts
    router.refresh();
    // See note in handleClientAdded — notify the client-side contacts list to re-fetch.
    window.dispatchEvent(new CustomEvent('alga:quick-create:created', { detail: { entity: 'contact' } }));
  };

  const handleProjectAdded = (project: IProject) => {
    toast.success(
      t('quickCreate.success.project', {
        defaultValue: 'Project "{{name}}" created successfully',
        name: project.project_name,
      })
    );
    onClose();
    // Refresh the page to update any list that might be showing projects
    router.refresh();
  };

  const handleServiceAdded = () => {
    toast.success(
      t('quickCreate.success.service', { defaultValue: 'Service created successfully' })
    );
    onClose();
    // Refresh the page to update any list that might be showing services
    router.refresh();
  };

  const handleProductAdded = () => {
    toast.success(
      t('quickCreate.success.product', { defaultValue: 'Product created successfully' })
    );
    onClose();
    // Refresh the page to update any list that might be showing products
    router.refresh();
  };

  const handleServiceTypesChange = () => {
    // Refresh service types after inline create/update/delete
    getServiceTypesForSelection()
      .then(setServiceTypes)
      .catch((error) => {
        console.error('Failed to refresh service types:', error);
      });
  };

  // Handle QuickAddAsset which uses a different dialog pattern
  if (type === 'asset') {
    return (
      <QuickAddAsset
        onAssetAdded={handleAssetAdded}
        onClose={onClose}
        defaultOpen={true}
      />
    );
  }

  // Ticket creation is handled by navigation (see effect above) — nothing to render here.
  if (type === 'ticket') {
    return null;
  }

  // Handle QuickAddClient
  if (type === 'client') {
    return (
      <QuickAddClient
        open={true}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        onClientAdded={handleClientAdded}
      />
    );
  }

  // Handle QuickAddContact
  if (type === 'contact') {
    if (isLoadingClients) {
      return (
        <Dialog isOpen={true} onClose={onClose} title={t('quickCreate.dialogTitles.contact', { defaultValue: 'Add New Contact' })}>
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
        onClose={onClose}
        onContactAdded={handleContactAdded}
        clients={clients}
      />
    );
  }

  // Handle ProjectQuickAdd (has its own dialog wrapper)
  if (type === 'project') {
    if (isLoadingClients) {
      return (
        <Dialog isOpen={true} onClose={onClose} title={t('quickCreate.dialogTitles.project', { defaultValue: 'Add New Project' })}>
          <DialogContent className="max-w-2xl">
            <div className="flex justify-center items-center p-8">
              <LoadingIndicator />
            </div>
          </DialogContent>
        </Dialog>
      );
    }

    return (
      <ProjectQuickAdd
        onClose={onClose}
        onProjectAdded={handleProjectAdded}
        clients={clients}
      />
    );
  }

  // Handle QuickAddService
  if (type === 'service') {
    if (isLoadingServiceTypes) {
      return (
        <Dialog isOpen={true} onClose={onClose} title={t('quickCreate.dialogTitles.service', { defaultValue: 'Add New Service' })}>
          <DialogContent className="max-w-2xl">
            <div className="flex justify-center items-center p-8">
              <LoadingIndicator />
            </div>
          </DialogContent>
        </Dialog>
      );
    }

    return (
      <QuickAddService
        isOpen={true}
        onClose={onClose}
        onServiceAdded={handleServiceAdded}
        allServiceTypes={serviceTypes}
        onServiceTypesChange={handleServiceTypesChange}
      />
    );
  }

  // Handle QuickAddProduct
  if (type === 'product') {
    return (
      <QuickAddProduct
        isOpen={true}
        onClose={onClose}
        onProductAdded={handleProductAdded}
      />
    );
  }

  return null;
}
