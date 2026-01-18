'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { QuickAddAsset } from '@alga-psa/assets/components/QuickAddAsset';
import { QuickAddTicket } from '@alga-psa/tickets/components';
import QuickAddClient from '@alga-psa/clients/components/clients/QuickAddClient';
import QuickAddContact from '@alga-psa/clients/components/contacts/QuickAddContact';
import ProjectQuickAdd from '@alga-psa/projects/components/ProjectQuickAdd';
import { QuickAddProduct, QuickAddService } from '@alga-psa/billing/components';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { ITicket, IClient, IContact, IProject } from 'server/src/interfaces';
import { getAllClients } from '@alga-psa/clients/actions';
import { getServiceTypesForSelection } from 'server/src/lib/actions/serviceActions';
import { toast } from 'react-hot-toast';

export type QuickCreateType = 'ticket' | 'client' | 'contact' | 'project' | 'asset' | 'service' | 'product' | null;

interface QuickCreateDialogProps {
  type: QuickCreateType;
  onClose: () => void;
}

export function QuickCreateDialog({ type, onClose }: QuickCreateDialogProps) {
  const router = useRouter();
  const [clients, setClients] = useState<IClient[]>([]);
  const [isLoadingClients, setIsLoadingClients] = useState(false);
  const [serviceTypes, setServiceTypes] = useState<{ id: string; name: string; billing_method: 'fixed' | 'hourly' | 'usage' | 'per_unit'; is_standard?: boolean }[]>([]);
  const [isLoadingServiceTypes, setIsLoadingServiceTypes] = useState(false);

  // Load clients when needed for projects and contacts
  useEffect(() => {
    if ((type === 'project' || type === 'contact') && clients.length === 0) {
      setIsLoadingClients(true);
      getAllClients(false)
        .then(setClients)
        .catch((error) => {
          console.error('Failed to load clients:', error);
          toast.error('Failed to load clients');
        })
        .finally(() => setIsLoadingClients(false));
    }
  }, [type, clients.length]);

  // Load service types when needed for services
  useEffect(() => {
    if (type === 'service') {
      setIsLoadingServiceTypes(true);
      getServiceTypesForSelection()
        .then(setServiceTypes)
        .catch((error) => {
          console.error('Failed to load service types:', error);
          toast.error('Failed to load service types');
        })
        .finally(() => setIsLoadingServiceTypes(false));
    }
  }, [type]);

  const handleAssetAdded = () => {
    toast.success('Asset created successfully');
    onClose();
    // Refresh the page to update any list that might be showing assets
    router.refresh();
  };

  const handleTicketAdded = (ticket: ITicket) => {
    toast.success(`Ticket #${ticket.ticket_number} created successfully`);
    onClose();
    // Refresh the page to update any list that might be showing tickets
    router.refresh();
  };

  const handleClientAdded = (client: IClient) => {
    toast.success(`Client "${client.client_name}" created successfully`);
    onClose();
    // Refresh the page to update any list that might be showing clients
    router.refresh();
  };

  const handleContactAdded = (contact: IContact) => {
    const contactName = `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || 'Contact';
    toast.success(`${contactName} added successfully`);
    onClose();
    // Refresh the page to update any list that might be showing contacts
    router.refresh();
  };

  const handleProjectAdded = (project: IProject) => {
    toast.success(`Project "${project.project_name}" created successfully`);
    onClose();
    // Refresh the page to update any list that might be showing projects
    router.refresh();
  };

  const handleServiceAdded = () => {
    toast.success('Service created successfully');
    onClose();
    // Refresh the page to update any list that might be showing services
    router.refresh();
  };

  const handleProductAdded = () => {
    toast.success('Product created successfully');
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

  // Handle QuickAddTicket
  if (type === 'ticket') {
    return (
      <QuickAddTicket
        open={true}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        onTicketAdded={handleTicketAdded}
      />
    );
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
        <Dialog isOpen={true} onClose={onClose} title="Add New Contact">
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
        <Dialog isOpen={true} onClose={onClose} title="Add New Project">
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
        <Dialog isOpen={true} onClose={onClose} title="Add New Service">
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
