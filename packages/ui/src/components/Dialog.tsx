// server/src/components/ui/Dialog.tsx
import React, { ReactNode, useEffect, useState, useRef } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { Cross2Icon } from '@radix-ui/react-icons';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';
import { ReflectionParentContext } from '../ui-reflection/ReflectionParentContext';
import { ModalityContext } from './ModalityContext';
import { DialogComponent, AutomationProps } from '../ui-reflection/types';
import { withDataAutomationId } from '../ui-reflection/withDataAutomationId';
import { useAutomationIdAndRegister } from '../ui-reflection/useAutomationIdAndRegister';

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

export function Dialog({
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
}: DialogProps & AutomationProps): React.ReactElement {
  const { automationIdProps: updateDialog, updateMetadata } = useAutomationIdAndRegister<DialogComponent>({
    id: `${id}-dialog`,
    type: 'dialog',
    title,
    open: isOpen,
  });

  const dialogRef = useRef<HTMLDivElement>(null);
  const preventCloseRef = useRef(false);
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
    updateMetadata({ open: isOpen, title });
  }, [ isOpen, title, updateMetadata, id, disableFocusTrap ]);

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

  // Handle click outside for dialogs with disabled focus trap.
  // Use pointerdown + capture so we can reliably detect portaled content before it unmounts.
  useEffect(() => {
    if (!isOpen || !disableFocusTrap) return;

    // Track if a select dropdown was recently closed to prevent dialog from closing
    let selectCloseTimeout: NodeJS.Timeout | null = null;

    const handlePointerDownOutside = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      const path = (typeof e.composedPath === 'function' ? e.composedPath() : []) as EventTarget[];
      
      const isComboboxTrigger = (element: HTMLElement | null): boolean => {
        if (!element) return false;
        if (element.getAttribute('role') === 'combobox') return true;
        
        let current: HTMLElement | null = element;
        while (current && current !== document.body) {
          if (current.getAttribute('role') === 'combobox') return true;
          if (current.hasAttribute('data-radix-select-trigger')) return true;
          current = current.parentElement;
        }
        
        return path.some((node) => {
          if (!(node instanceof HTMLElement)) return false;
          return node.getAttribute('role') === 'combobox' || node.hasAttribute('data-radix-select-trigger');
        });
      };

      const hadOpenSelect = document.querySelector('[data-radix-select-content]') !== null;

      if (isComboboxTrigger(target)) {
        const trigger = path.find((node) => {
          if (!(node instanceof HTMLElement)) return false;
          return node.getAttribute('role') === 'combobox' || node.hasAttribute('data-radix-select-trigger');
        }) as HTMLElement | undefined;

        if (
          (target && dialogRef.current?.contains(target)) ||
          (trigger && (trigger.getAttribute('data-state') === 'open' || trigger.getAttribute('aria-expanded') === 'true') && hadOpenSelect)
        ) {
          preventCloseRef.current = true;
          if (selectCloseTimeout) clearTimeout(selectCloseTimeout);
          selectCloseTimeout = setTimeout(() => {
            preventCloseRef.current = false;
          }, 200);
          return;
        }
        return;
      }

      const selectJustClosedAttr = document.body.getAttribute('data-radix-select-just-closed') === 'true';
      
      const isInsideDialogRect = () => {
        if (!dialogRef.current) return false;
        const rect = dialogRef.current.getBoundingClientRect();
        return (
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom
        );
      };

      if (preventCloseRef.current || selectJustClosedAttr || isInsideDialogRect()) {
        return;
      }

      if (target && dialogRef.current?.contains(target)) {
        return;
      }

      const openSelectContent = document.querySelector('[data-radix-select-content]');
      if (openSelectContent && dialogRef.current) {
        const isSelectRelated = 
          (target && (
            target.closest('[data-radix-select-content]') !== null ||
            target.closest('[data-radix-select-viewport]') !== null
          )) ||
          path.some((node) => {
            if (!(node instanceof HTMLElement)) return false;
            return node.hasAttribute('data-radix-select-content') ||
                   node.hasAttribute('data-radix-select-viewport');
          });
        
        if (isSelectRelated) return;
      }

      const isInsidePortaledContent = path.some((node) => {
        if (!(node instanceof HTMLElement)) return false;

        if (node.hasAttribute('data-radix-portal')) return true;
        if (node.hasAttribute('data-radix-popper-content-wrapper')) return true;
        if (node.hasAttribute('data-radix-select-content')) return true;
        if (node.hasAttribute('data-radix-select-viewport')) return true;
        if (node.hasAttribute('data-radix-popover-content')) return true;
        if (node.hasAttribute('data-radix-dropdown-menu-content')) return true;
        if (node.hasAttribute('data-radix-menu-content')) return true;
        if (node.hasAttribute('data-radix-collection-item')) return true;

        const role = node.getAttribute('role');
        return role === 'listbox' || role === 'menu' || role === 'option';
      });

      if (isInsidePortaledContent) return;

      onClose();
    };

    const handleMouseDownOutside = (e: MouseEvent) => {
      handlePointerDownOutside(e as unknown as PointerEvent);
    };

    document.addEventListener('pointerdown', handlePointerDownOutside, true);
    document.addEventListener('mousedown', handleMouseDownOutside, true);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDownOutside, true);
      document.removeEventListener('mousedown', handleMouseDownOutside, true);
      if (selectCloseTimeout) clearTimeout(selectCloseTimeout);
    };
  }, [isOpen, disableFocusTrap, onClose]);

  return (
    <RadixDialog.Root 
      open={isOpen} 
      onOpenChange={(open) => { 
        // Don't close if it's due to a select interaction
        if (!open && !disableFocusTrap && !preventCloseRef.current) {
          onClose();
        }
        // Reset the flag after a brief moment
        if (!open && preventCloseRef.current) {
          setTimeout(() => {
            preventCloseRef.current = false;
          }, 0);
        }
      }} 
      modal={!disableFocusTrap}
    >
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
          onInteractOutside={(e) => {
            // Prevent closing dialog when interacting with Radix Select components
            const target = e.target as HTMLElement;
            if (target) {
              // Check if click is on a combobox trigger
              if (target.getAttribute('role') === 'combobox' || 
                  target.closest('[role="combobox"]') !== null) {
                e.preventDefault();
                return;
              }
              // Check if click is inside select content (portal)
              if (target.closest('[data-radix-select-content]') !== null ||
                  target.closest('[data-radix-select-viewport]') !== null) {
                e.preventDefault();
                return;
              }
            }
            // When disableFocusTrap is true, we handle closing via our own mousedown listener
            // But we still need to prevent Radix Dialog's default behavior for select interactions
            if (disableFocusTrap) {
              e.preventDefault();
            }
          }}
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
              <ModalityContext.Provider value={{ modal: !disableFocusTrap }}>
                {children}
              </ModalityContext.Provider>
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
}

export function DialogHeader({ children }: { children: ReactNode }): React.ReactElement {
  return <div className="mb-4">{children}</div>;
}

export function DialogTitle({ children }: { children: ReactNode }): React.ReactElement {
  return <RadixDialog.Title className="text-xl font-semibold mb-2">{children}</RadixDialog.Title>;
}

export function DialogContent({ children, className }: { children: ReactNode; className?: string }): React.ReactElement {
  return <div className={`mt-2 ${className || ''}`}>{children}</div>;
}

export function DialogFooter({ children, className }: { children: ReactNode; className?: string }): React.ReactElement {
  return <div className={`mt-6 flex justify-end space-x-2 ${className || ''}`}>{children}</div>;
}

export const DialogTrigger = RadixDialog.Trigger;

export function DialogDescription({ children }: { children: ReactNode }): React.ReactElement {
  return (
    <RadixDialog.Description className="text-sm text-gray-500 mb-4">{children}</RadixDialog.Description>
  );
}
