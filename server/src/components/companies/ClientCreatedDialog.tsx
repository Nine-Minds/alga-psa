'use client';

import React from 'react';
import { Dialog, DialogContent, DialogFooter } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { ICompany } from 'server/src/interfaces/company.interfaces';

interface ClientCreatedDialogProps {
  isOpen: boolean;
  onClose: () => void;
  company: ICompany | null;
  onViewClient: () => void;
  onAddAnother: () => void;
}

const ClientCreatedDialog: React.FC<ClientCreatedDialogProps> = ({
  isOpen,
  onClose,
  company,
  onViewClient,
  onAddAnother,
}) => {
  const name = company?.company_name || 'Client';
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
