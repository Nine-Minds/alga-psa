// server/src/components/ui/Dialog.tsx
import React, { ReactNode, useEffect } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { Cross2Icon } from '@radix-ui/react-icons';
import { useRegisterUIComponent } from '../../types/ui-reflection/useRegisterUIComponent';
import { DialogComponent } from '../../types/ui-reflection/types';

interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  title?: string;
  /** Unique identifier for UI reflection system */
  id?: string;
  /** Content components for UI reflection */
  content?: DialogComponent['content'];
}

export const Dialog: React.FC<DialogProps> = ({ isOpen, onClose, children, className, title, id, content }) => {
  // Register with UI reflection system if id is provided
  const updateMetadata = id ? useRegisterUIComponent<DialogComponent>({
    type: 'dialog',
    id,
    title: title || '',
    open: isOpen,
    content,
    actions: ['submit', 'cancel']
  }) : undefined;

  // Update metadata when open state changes
  useEffect(() => {
    if (updateMetadata) {
      updateMetadata({ open: isOpen });
    }
  }, [isOpen, updateMetadata]);

  return (
    <RadixDialog.Root open={isOpen} onOpenChange={onClose} data-automation-id={id}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <RadixDialog.Content className={`fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg shadow-lg p-6 w-full max-w-3xl z-50 ${className || ''}`}>
          {title && <RadixDialog.Title className="text-xl font-semibold mb-4">{title}</RadixDialog.Title>}
          {children}
          <RadixDialog.Close asChild>
            <button
              className="absolute top-2 right-2 text-gray-400 hover:text-gray-600"
              aria-label="Close"
            >
              <Cross2Icon />
            </button>
          </RadixDialog.Close>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
};

export const DialogHeader: React.FC<{ children: ReactNode }> = ({ children }) => (
  <div className="mb-4">{children}</div>
);

export const DialogTitle: React.FC<{ children: ReactNode }> = ({ children }) => (
  <RadixDialog.Title className="text-xl font-semibold mb-2">{children}</RadixDialog.Title>
);

export const DialogContent: React.FC<{ children: ReactNode, className?: string }> = ({ children, className }) => (
  <div className={`mt-2 ${className || ''}`}>{children}</div>
);

export const DialogFooter: React.FC<{ children: ReactNode }> = ({ children }) => (
  <div className="mt-6 flex justify-end space-x-2">{children}</div>
);

export const DialogTrigger = RadixDialog.Trigger;

export const DialogDescription: React.FC<{ children: ReactNode }> = ({ children }) => (
  <RadixDialog.Description className="text-sm text-gray-500 mb-4">{children}</RadixDialog.Description>
);
