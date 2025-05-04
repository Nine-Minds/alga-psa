'use client';

import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  // Removed DialogClose import
} from '../../ui/Dialog'; // Use relative path
import { Button } from '../../ui/Button'; // Use relative path
import { Loader2, AlertTriangle } from 'lucide-react'; // Icons

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
    // Moved ID here, using the correct prop names 'isOpen' and 'onClose' from DialogProps
    <Dialog isOpen={isOpen} onClose={onClose} id="qbo-disconnect-confirm-dialog">
      {/* Removed DialogContent wrapper, content goes directly in Dialog */}
        {/* Removed className from DialogHeader */}
        <DialogHeader>
          {/* Added a div inside DialogHeader for flex layout */}
          <div className="flex flex-row items-center space-x-2">
            <AlertTriangle className="h-5 w-5 text-yellow-500 flex-shrink-0" /> {/* Warning Icon */}
            <DialogTitle>Confirm Disconnection</DialogTitle>
          </div>
        </DialogHeader>
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
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Confirm Disconnect
          </Button>
        </DialogFooter>
      {/* Removed closing DialogContent tag */}
    </Dialog>
  );
};

export default QboDisconnectConfirmModal;