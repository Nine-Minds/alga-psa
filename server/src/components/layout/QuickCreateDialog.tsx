'use client';

import React, { useState, useEffect } from 'react';
import { QuickAddAsset } from 'server/src/components/assets/QuickAddAsset';
import { QuickAddTicket } from 'server/src/components/tickets/QuickAddTicket';
import QuickAddClient from 'server/src/components/clients/QuickAddClient';
import QuickAddContact from 'server/src/components/contacts/QuickAddContact';
import ProjectQuickAdd from 'server/src/components/projects/ProjectQuickAdd';
import { Dialog, DialogContent } from 'server/src/components/ui/Dialog';
import { ITicket, IClient, IContact, IProject } from 'server/src/interfaces';
import { getAllClients } from 'server/src/lib/actions/client-actions/clientActions';
import { toast } from 'react-hot-toast';

export type QuickCreateType = 'ticket' | 'client' | 'contact' | 'project' | 'asset' | null;

interface QuickCreateDialogProps {
  type: QuickCreateType;
  onClose: () => void;
}

export function QuickCreateDialog({ type, onClose }: QuickCreateDialogProps) {
  const [clients, setClients] = useState<IClient[]>([]);
  const [isLoadingClients, setIsLoadingClients] = useState(false);

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

  const handleAssetAdded = () => {
    toast.success('Asset created successfully');
    onClose();
  };

  const handleTicketAdded = (ticket: ITicket) => {
    toast.success(`Ticket #${ticket.ticket_number} created successfully`);
    onClose();
  };

  const handleClientAdded = (client: IClient) => {
    toast.success(`Client "${client.client_name}" created successfully`);
    onClose();
  };

  const handleContactAdded = (contact: IContact) => {
    const contactName = `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || 'Contact';
    toast.success(`${contactName} added successfully`);
    onClose();
  };

  const handleProjectAdded = (project: IProject) => {
    toast.success(`Project "${project.project_name}" created successfully`);
    onClose();
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
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
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
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
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

  return null;
}