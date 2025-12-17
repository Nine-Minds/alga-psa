// server/src/components/ui/Dialog.tsx
import React, { ReactNode, useEffect, useState, useRef } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { Cross2Icon } from '@radix-ui/react-icons';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';
import { ReflectionParentContext } from '../../types/ui-reflection/ReflectionParentContext';
import { DialogComponent, AutomationProps } from '../../types/ui-reflection/types';
import { withDataAutomationId } from '../../types/ui-reflection/withDataAutomationId';
import { useAutomationIdAndRegister } from 'server/src/types/ui-reflection/useAutomationIdAndRegister';

interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  title?: string;
  /** Unique identifier for UI reflection system */
  id?: string;
  hideCloseButton?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onOpenAutoFocus?: (event: Event) => void;
  /** Whether the dialog should be draggable */
  draggable?: boolean;
  /** Initial position (defaults to centered) */
  initialPosition?: { x?: number; y?: number };
  /** Whether to constrain dragging within viewport */
  constrainToViewport?: boolean;
  /** Allow content to overflow (for dialogs with dropdowns) */
  allowOverflow?: boolean;
  /** Disable focus trapping to allow interaction with portaled elements outside the dialog */
  disableFocusTrap?: boolean;
}

export const Dialog: React.FC<DialogProps & AutomationProps> = ({
  isOpen,
  onClose,
  children,
  className,
  title = '',
  id = 'dialog',
  hideCloseButton = false,
  onKeyDown,
  onOpenAutoFocus,
  draggable = true,
  initialPosition,
  constrainToViewport = false,
  allowOverflow = false,
  disableFocusTrap = false
}) => {
  const { automationIdProps: updateDialog, updateMetadata } = useAutomationIdAndRegister<DialogComponent>({
    id: `${id}-dialog`,
    type: 'dialog',
    title,
    open: isOpen,
  });

  const dialogRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [dialogSize, setDialogSize] = useState({ width: 0, height: 0 });

  // Prevent background scroll when dialog is open
  useEffect(() => {
    if (typeof document === 'undefined') return;

    if (isOpen) {
      const originalOverflow = document.body.style.overflow;
      const originalPaddingRight = document.body.style.paddingRight;

      // Account for potential layout shift when hiding the scrollbar
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

      document.body.style.overflow = 'hidden';
      if (scrollbarWidth > 0) {
        document.body.style.paddingRight = `${scrollbarWidth}px`;
      }

      return () => {
        document.body.style.overflow = originalOverflow;
        document.body.style.paddingRight = originalPaddingRight;
      };
    }
  }, [isOpen]);

  // Update dialog metadata when props change
  useEffect(() => {
    console.log(`🔍 [DIALOG] ${id}-dialog open state changed:`, isOpen);
    updateMetadata({ open: isOpen, title });
  }, [ isOpen, title, updateMetadata, id ]);

  // Reset position when dialog opens
  useEffect(() => {
    if (isOpen) {
      if (initialPosition) {
        setPosition({
          x: initialPosition.x || 0,
          y: initialPosition.y || 0
        });
      } else {
        setPosition({ x: 0, y: 0 });
      }
    }
  }, [isOpen, initialPosition]);

  // Update dialog size for viewport constraints
  useEffect(() => {
    if (dialogRef.current && isOpen) {
      const rect = dialogRef.current.getBoundingClientRect();
      setDialogSize({ width: rect.width, height: rect.height });
    }
  }, [isOpen]);

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!draggable) return;
    
    // Prevent default to avoid text selection
    e.preventDefault();
    e.stopPropagation();

    setIsDragging(true);
    setDragStart({
      x: e.clientX - position.x,
      y: e.clientY - position.y
    });
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging || !draggable) return;

    const newX = e.clientX - dragStart.x;
    const newY = e.clientY - dragStart.y;

    setPosition({ x: newX, y: newY });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Add global mouse event listeners for dragging
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, dragStart]);

  const dialogStyle: React.CSSProperties = {
    transform: `translate(calc(-50% + ${position.x}px), calc(-50% + ${position.y}px))`,
    cursor: isDragging ? 'move' : 'auto',
  };

  // Handle click outside for dialogs with disabled focus trap
  // We need to detect clicks that are truly outside the dialog AND any portaled content (dropdowns, etc.)
  useEffect(() => {
    if (!isOpen || !disableFocusTrap) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;

      // Check if click is inside the dialog content
      if (dialogRef.current?.contains(target)) return;

      // Check if click is inside any Radix portal content (dropdowns, popovers, etc.)
      // Radix components use various data attributes and roles
      const isInsidePortaledContent =
        // Radix popper/portal wrappers
        target.closest('[data-radix-popper-content-wrapper]') ||
        target.closest('[data-radix-portal]') ||
        // Radix Select
        target.closest('[data-radix-select-content]') ||
        target.closest('[data-radix-select-viewport]') ||
        // Radix Popover
        target.closest('[data-radix-popover-content]') ||
        // Radix Dropdown Menu
        target.closest('[data-radix-dropdown-menu-content]') ||
        // Radix Menu
        target.closest('[data-radix-menu-content]') ||
        // Common roles used by Radix
        target.closest('[role="listbox"]') ||
        target.closest('[role="menu"]') ||
        target.closest('[role="option"]') ||
        // High z-index portaled elements (typically have z-index > 9999)
        target.closest('[style*="z-index: 10"]') ||
        // Check if target itself has Radix data attributes
        target.hasAttribute('data-radix-collection-item');

      if (isInsidePortaledContent) return;

      // Click is truly outside - close the dialog
      onClose();
    };

    // Use mousedown to catch clicks before they propagate
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, disableFocusTrap, onClose]);

  return (
    <RadixDialog.Root open={isOpen} onOpenChange={(open) => { if (!open && !disableFocusTrap) onClose(); }} modal={!disableFocusTrap}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <RadixDialog.Content
          ref={dialogRef}
          {...withDataAutomationId(updateDialog)}
          className={`fixed top-1/2 left-1/2 bg-white rounded-lg shadow-lg w-full ${className || 'max-w-3xl'} z-50 focus-within:ring-2 focus-within:ring-primary-100 focus-within:ring-offset-2 max-h-[90vh] flex flex-col`}
          style={dialogStyle}
          onKeyDown={(e) => {
            // Handle Escape key manually when focus trap is disabled
            if (disableFocusTrap && e.key === 'Escape') {
              onClose();
            }
            onKeyDown?.(e);
          }}
          onOpenAutoFocus={onOpenAutoFocus}
          // When disableFocusTrap is true, we handle closing via our own mousedown listener
          // Don't use onInteractOutside/onPointerDownOutside as they can interfere with nested dropdowns
        >
          {/* Drag handle area - always present for consistent dragging */}
          <div
            data-drag-handle
            className={`${draggable ? 'cursor-move hover:bg-gray-50' : ''} ${title ? 'px-6 pt-6 pb-4' : 'p-2'} ${title ? 'border-b border-gray-100' : ''} rounded-t-lg transition-colors`}
            onMouseDown={handleMouseDown}
          >
            {title ? (
              <RadixDialog.Title className="text-xl font-semibold select-none">{title}</RadixDialog.Title>
            ) : (
              <>
                <VisuallyHidden.Root>
                  <RadixDialog.Title>Dialog</RadixDialog.Title>
                </VisuallyHidden.Root>
                <div className="flex items-center justify-center">
                  <div className="w-12 h-1 bg-gray-300 rounded-full" /> {/* Visual drag indicator */}
                </div>
              </>
            )}
          </div>
          <div className={`px-6 pt-3 pb-6 flex-1 min-h-0 ${allowOverflow ? 'overflow-visible' : 'overflow-y-auto'}`}>
            <ReflectionParentContext.Provider value={updateDialog.id}>
              {children}
            </ReflectionParentContext.Provider>
          </div>
          {!hideCloseButton && (
            disableFocusTrap ? (
              <button
                onClick={onClose}
                className="absolute top-2 right-2 text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 rounded z-10"
                aria-label="Close"
              >
                <Cross2Icon />
              </button>
            ) : (
              <RadixDialog.Close asChild>
                <button
                  className="absolute top-2 right-2 text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 rounded z-10"
                  aria-label="Close"
                >
                  <Cross2Icon />
                </button>
              </RadixDialog.Close>
            )
          )}
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

export const DialogFooter: React.FC<{ children: ReactNode, className?: string }> = ({ children, className }) => (
  <div className={`mt-6 flex justify-end space-x-2 ${className || ''}`}>{children}</div>
);

export const DialogTrigger = RadixDialog.Trigger;

export const DialogDescription: React.FC<{ children: ReactNode }> = ({ children }) => (
  <RadixDialog.Description className="text-sm text-gray-500 mb-4">{children}</RadixDialog.Description>
);
