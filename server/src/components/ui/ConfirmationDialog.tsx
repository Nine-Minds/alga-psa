import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './Dialog';
import { Button } from './Button';
import { useRegisterUIComponent } from '../../types/ui-reflection/useRegisterUIComponent';
import { DialogComponent, ButtonComponent } from '../../types/ui-reflection/types';
import { withDataAutomationId } from '../../types/ui-reflection/withDataAutomationId';

interface ConfirmationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isConfirming?: boolean;
  /** Unique identifier for UI reflection system */
  id?: string;
}

export const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  isConfirming,
  id
}) => {
  const [isProcessing, setIsProcessing] = useState(false);

  const handleConfirm = async () => {
    setIsProcessing(true);
    try {
      await onConfirm();
    } finally {
      setIsProcessing(false);
    }
  };

  // Only register dialog and its children with UI reflection system when open
  const updateDialog = id && isOpen ? useRegisterUIComponent<DialogComponent>({
    type: 'dialog',
    id,
    title,
    open: true
  }) : undefined;

  // Only register confirm button when dialog is open
  const updateConfirmButton = id && isOpen ? useRegisterUIComponent<ButtonComponent>({
    type: 'button',
    id: `${id}-confirm`,
    label: confirmLabel,
    disabled: isConfirming || isProcessing,
    actions: ['click'],
    parentId: id
  }) : undefined;

  // Only register cancel button when dialog is open
  const updateCancelButton = id && isOpen ? useRegisterUIComponent<ButtonComponent>({
    type: 'button',
    id: `${id}-cancel`,
    label: cancelLabel,
    disabled: isProcessing,
    actions: ['click'],
    parentId: id
  }) : undefined;

  // Update button states when processing state changes
  useEffect(() => {
    if (updateConfirmButton) {
      updateConfirmButton({ disabled: isConfirming || isProcessing });
    }
    if (updateCancelButton) {
      updateCancelButton({ disabled: isProcessing });
    }
  }, [isConfirming, isProcessing, updateConfirmButton, updateCancelButton]);

  return (
    <Dialog 
      isOpen={isOpen} 
      onClose={onClose}
      id={id}
      title={title}
    >
      <DialogContent>
        <p className="text-gray-600">{message}</p>
        <DialogFooter>
          <Button 
            variant="outline" 
            onClick={onClose}
            id={id ? `${id}-cancel` : undefined}
          >
            {cancelLabel}
          </Button>
          <Button 
            onClick={handleConfirm}
            disabled={isConfirming || isProcessing}
            id={id ? `${id}-confirm` : undefined}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
