// server/src/components/GenericDialog.tsx
import React, { ReactNode, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Cross2Icon } from '@radix-ui/react-icons';
import { useRegisterUIComponent } from '../../types/ui-reflection/useRegisterUIComponent';
import { DialogComponent, UIComponent } from '../../types/ui-reflection/types';
import { withDataAutomationId } from '../../types/ui-reflection/withDataAutomationId';

interface GenericDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Unique identifier for UI reflection system */
  id?: string;
  /** Child components for UI reflection */
  reflectionChildren?: UIComponent[];
}

const GenericDialog: React.FC<GenericDialogProps> = ({ 
  isOpen, 
  onClose, 
  title, 
  children,
  id,
  reflectionChildren
}) => {
  // Register with UI reflection system if id is provided
  const updateMetadata = id ? useRegisterUIComponent<DialogComponent>({
    type: 'dialog',
    id,
    title,
    open: isOpen,
    children: reflectionChildren
  }) : undefined;

  // Update metadata when dialog state changes
  useEffect(() => {
    if (updateMetadata) {
      updateMetadata({ 
        open: isOpen,
        children: reflectionChildren
      });
    }
  }, [isOpen, reflectionChildren, updateMetadata]);

  return (
    <Dialog.Root open={isOpen} onOpenChange={onClose}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50" />
        <Dialog.Content 
          className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg shadow-lg p-6 w-full max-w-md"
          {...withDataAutomationId({ id })}
        >
          <Dialog.Title className="text-xl font-semibold mb-4">{title}</Dialog.Title>
          {children}
          <Dialog.Close asChild>
            <button
              className="absolute top-2 right-2 text-gray-400 hover:text-gray-600"
              aria-label="Close"
              {...withDataAutomationId({ id: id ? `${id}-close` : undefined })}
            >
              <Cross2Icon />
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export default GenericDialog;
