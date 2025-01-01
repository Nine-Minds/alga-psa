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

  // Register dialog with UI reflection system if id is provided
  const updateDialog = id ? useRegisterUIComponent<DialogComponent>({
    type: 'dialog',
    id,
    title,
    open: isOpen
  }) : undefined;

  // Register confirm button as child of dialog
  const updateConfirmButton = id ? useRegisterUIComponent<ButtonComponent>({
    type: 'button',
    id: `${id}-confirm`,
    label: confirmLabel,
    disabled: isConfirming || isProcessing,
    actions: ['click'],
    parentId: id
  }) : undefined;

  // Register cancel button as child of dialog
  const updateCancelButton = id ? useRegisterUIComponent<ButtonComponent>({
    type: 'button',
    id: `${id}-cancel`,
    label: cancelLabel,
    disabled: isProcessing,
    actions: ['click'],
    parentId: id
  }) : undefined;

  // Update metadata when dialog state changes
  useEffect(() => {
    if (updateDialog) {
      updateDialog({ open: isOpen });
    }
    if (updateConfirmButton) {
      updateConfirmButton({ disabled: isConfirming || isProcessing });
    }
    if (updateCancelButton) {
      updateCancelButton({ disabled: isProcessing });
    }
  }, [isOpen, isConfirming, isProcessing, updateDialog, updateConfirmButton, updateCancelButton]);

  return (
    <Dialog 
      isOpen={isOpen} 
      onClose={onClose}
      id={id}
      title={title}
    >
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
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
