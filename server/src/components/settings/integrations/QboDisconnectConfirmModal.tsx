'use client';

import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter
} from '../../ui/Dialog'; // Use relative path
import { Button } from '../../ui/Button'; // Use relative path
import { AlertTriangle } from 'lucide-react'; // Icons
import LoadingIndicator from '../../ui/LoadingIndicator'; // Use relative path

interface QboDisconnectConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isDisconnecting: boolean;
}

const QboDisconnectConfirmModal: React.FC<QboDisconnectConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  isDisconnecting,
}) => {
  if (!isOpen) {
    return null;
  }

  return (
    <Dialog isOpen={isOpen} onClose={onClose} id="qbo-disconnect-confirm-dialog" title="Confirm Disconnection">
      <DialogContent>
        <div className="flex flex-row items-center space-x-2 mb-4">
          <AlertTriangle className="h-5 w-5 text-yellow-500 flex-shrink-0" /> {/* Warning Icon */}
          <h2 className="text-lg font-semibold">Confirm Disconnection</h2>
        </div>
        <DialogDescription>
          Are you sure you want to disconnect from QuickBooks Online? This will stop all automatic data synchronization for invoices and customers. You can reconnect at any time.
        </DialogDescription>
        <DialogFooter>
           {/* Removed DialogClose wrapper, Button calls onClose directly */}
           <Button
             variant="outline"
             onClick={onClose} // Calls the onClose prop passed to the component
             disabled={isDisconnecting}
             id="qbo-disconnect-cancel-button" // Added ID
           >
             Cancel
           </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isDisconnecting}
            id="qbo-disconnect-confirm-button" // Added ID
          >
            {isDisconnecting ? (
              <LoadingIndicator spinnerProps={{ size: 'sm' }} text="Confirm Disconnect" className="mr-2" />
            ) : (
              'Confirm Disconnect'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default QboDisconnectConfirmModal;