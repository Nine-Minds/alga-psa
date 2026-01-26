'use client';

import React from 'react';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import type { IClient } from '@alga-psa/types';

interface ClientCreatedDialogProps {
  isOpen: boolean;
  onClose: () => void;
  client: IClient | null;
  onViewClient: () => void;
  onAddAnother: () => void;
}

const ClientCreatedDialog: React.FC<ClientCreatedDialogProps> = ({
  isOpen,
  onClose,
  client,
  onViewClient,
  onAddAnother,
}) => {
  const name = client?.client_name || 'Client';
  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="Client Created" id="client-created-dialog">
      <DialogContent>
        <p className="text-center">{`"${name}" has been created successfully.`}</p>
      </DialogContent>
      <DialogFooter>
        <Button id="view-client-btn" onClick={onViewClient}>
          View Client
        </Button>
        <Button id="add-another-client-btn" variant="secondary" onClick={onAddAnother}>
          Add Another
        </Button>
      </DialogFooter>
    </Dialog>
  );
};

export default ClientCreatedDialog;
