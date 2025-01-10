'use client';

import React, { ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Cross2Icon } from '@radix-ui/react-icons';
import { useAutomationIdAndRegister } from '../../types/ui-reflection/useAutomationIdAndRegister';
import { DialogComponent, ButtonComponent } from '../../types/ui-reflection/types';
import { ReflectionContainer } from '../../types/ui-reflection/ReflectionContainer';

interface GenericDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Unique identifier for UI reflection system */
  id?: string; // Made required since it's needed for reflection registration
}

const GenericDialog: React.FC<GenericDialogProps> = ({ 
  isOpen, 
  onClose, 
  title, 
  children,
  id = 'dialog'
}) => {
  // Register dialog with UI reflection system
  const { automationIdProps: dialogProps } = useAutomationIdAndRegister<DialogComponent>({
    id,
    type: 'dialog',
    title,
    open: isOpen
  });

  // Register close button
  const { automationIdProps: closeButtonProps } = useAutomationIdAndRegister<ButtonComponent>({
    id: `${id}-close`,
    type: 'button',
    label: 'Close Dialog',
    actions: ['click']
  });

  return (
    <Dialog.Root open={isOpen} onOpenChange={onClose}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50" />
        <Dialog.Content 
          {...dialogProps}
          className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg shadow-lg p-6 w-full max-w-md"
        >
          <ReflectionContainer id={`${id}-content`} label={title}>
            <Dialog.Title className="text-xl font-semibold mb-4">{title}</Dialog.Title>
            {children}
            <Dialog.Close asChild>
              <button
                {...closeButtonProps}
                className="absolute top-2 right-2 text-gray-400 hover:text-gray-600"
                aria-label="Close"
              >
                <Cross2Icon />
              </button>
            </Dialog.Close>
          </ReflectionContainer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export default GenericDialog;
