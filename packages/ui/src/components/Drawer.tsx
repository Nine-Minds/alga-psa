// server/src/components/ui/Drawer.tsx
import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { Theme } from '@radix-ui/themes';

import { useRegisterUIComponent } from "../ui-reflection/useRegisterUIComponent";
import { DrawerComponent, UIComponent, AutomationProps } from "../ui-reflection/types";
import { withDataAutomationId } from "../ui-reflection/withDataAutomationId";
import { InsideDialogContext, InsideDrawerContext, useInsideDialog, useInsideDrawer } from './ModalityContext';
import { useRadixEscapeOwner } from '../keyboard-shortcuts';

export interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Action row pinned to the bottom of the panel, outside the scrollable body */
  footer?: React.ReactNode;
  isInDrawer?: boolean;
  /** Unique identifier for UI reflection system */
  id?: string;
  /** Child components for UI reflection */
  reflectionChildren?: UIComponent[];
  hideCloseButton?: boolean;
  drawerVariant?: string;
  /** Width of the drawer (e.g., '50vw', '50%', '600px'). Defaults to responsive fixed widths */
  width?: string;
}

type DrawerComponentProps = DrawerProps & AutomationProps;

const Drawer = ({
  isOpen,
  onClose,
  children,
  footer,
  isInDrawer = false,
  id,
  reflectionChildren,
  hideCloseButton = false,
  drawerVariant,
  width
}: DrawerComponentProps): React.ReactElement => {
  const contentRef = React.useRef<HTMLDivElement | null>(null);

  useRadixEscapeOwner(isOpen);

  React.useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handle = window.setTimeout(() => {
      contentRef.current?.focus();
    }, 0);

    return () => window.clearTimeout(handle);
  }, [isOpen]);

  // Determine width classes and styles based on width prop or default behavior
  const widthClasses = width
    ? '' // Use inline style when width is specified
    : `w-fit max-w-[60vw]`;

  const widthStyle = width
    ? { width: width, maxWidth: width }
    : undefined;

  // Detect when this Drawer is nested inside another Drawer or Dialog.
  // Two modal Radix Dialogs cause FocusScope conflicts, so the nested one
  // must use modal={false}.
  const isInsideDialog = useInsideDialog();

  // Always register drawer when mounted, but track open state
  const updateMetadata = useRegisterUIComponent<DrawerComponent>({
    type: 'drawer',
    id: id || '__skip_registration_drawer',
    open: isOpen,
    width: width || (isInDrawer ? '40%' : '50%'),
    children: reflectionChildren
  });

  return (
    <Dialog.Root modal={!isInsideDialog} open={isOpen} onOpenChange={(open) => {
      if (!open) onClose(); // Ensure onClose is called when dialog is closed
    }}>
      <Dialog.Portal>
        {/* In non-modal mode (nested inside another Dialog), Radix does not render
            Dialog.Overlay. We add a custom overlay to block interaction with content
            behind the drawer. The Radix overlay is kept for modal (non-nested) mode. */}
        {isInsideDialog ? (
          <div
            className={`fixed inset-0 bg-black/50 ${isInDrawer ? 'z-[60]' : 'z-50'}`}
            onClick={onClose}
            aria-hidden="true"
          />
        ) : (
          <Dialog.Overlay
            className={`fixed inset-0 bg-black/50 transition-opacity duration-300 data-[state=closed]:opacity-0 data-[state=open]:opacity-100 ${isInDrawer ? 'z-[60]' : 'z-50'}`}
          />
        )}
        <Dialog.Content
          ref={contentRef}
          className={`fixed inset-y-0 right-0 ${widthClasses} bg-[rgb(var(--color-card))] shadow-lg focus:outline-none ${footer ? '' : 'overflow-y-auto'} flex flex-col transform transition-all duration-300 ease-in-out will-change-transform data-[state=open]:translate-x-0 data-[state=closed]:translate-x-full data-[state=closed]:opacity-0 data-[state=open]:opacity-100 ${drawerVariant === 'document' ? 'ticket-document-drawer' : ''} ${isInDrawer ? 'z-[61]' : 'z-50'}`}
          style={isInsideDialog ? { ...widthStyle, pointerEvents: 'auto' } : widthStyle}
          onOpenAutoFocus={(e) => {
            // Prevent Radix from auto-focusing the first tabbable child element.
            // This avoids unwanted focus rings (e.g. on the avatar edit button) when
            // the drawer opens. The Dialog.Content itself receives focus instead
            // (styled with focus:outline-none).
            e.preventDefault();
          }}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onEscapeKeyDown={isInsideDialog ? (e) => e.stopPropagation() : undefined}
          onInteractOutside={isInsideDialog ? (e) => e.preventDefault() : undefined}
        >
          {/* Visually hidden title for accessibility */}
          <Dialog.Title className="sr-only">
            Dialog Content
          </Dialog.Title>
          <InsideDialogContext.Provider value={true}>
            <InsideDrawerContext.Provider value={true}>
              {/* Flex items with a definite height, so content sized
                  `h-full` (e.g. a calendar) fills the panel exactly instead
                  of overflowing it by the padding; auto-height content still
                  scrolls the panel as before. */}
              <Theme className="flex-1 min-h-0 flex flex-col">
                <div className={`p-6 flex-1 min-h-0 ${footer ? 'overflow-y-auto' : ''}`}>
                  {children}
                </div>
              </Theme>
            </InsideDrawerContext.Provider>
          </InsideDialogContext.Provider>
          {/* Pinned footer — rendered outside the scrollable body */}
          {footer && (
            <div className="flex flex-shrink-0 justify-end gap-2 border-t border-[rgb(var(--color-border-100))] bg-[rgb(var(--color-card))] px-6 py-4">
              {footer}
            </div>
          )}
          {!hideCloseButton && (
            <button
              className="absolute top-4 right-4 text-muted-foreground hover:text-[rgb(var(--color-text-600))]"
              aria-label="Close"
              onClick={onClose}
            >
              <X />
            </button>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export interface DrawerFooterProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Trailing action row for drawer content. Inside a drawer it sticks to the
 * bottom of the scroll container so Save stays reachable without scrolling;
 * anywhere else (e.g. the same form rendered in a wizard) it renders as a
 * plain trailing row.
 */
export const DrawerFooter = ({ children, className }: DrawerFooterProps): React.ReactElement => {
  const insideDrawer = useInsideDrawer();

  return (
    <div
      className={`mt-6 flex justify-end gap-2 ${insideDrawer ? 'sticky bottom-0 z-10 border-t border-[rgb(var(--color-border-100))] bg-[rgb(var(--color-card))] py-4' : ''} ${className || ''}`}
    >
      {children}
    </div>
  );
};

export default Drawer;
