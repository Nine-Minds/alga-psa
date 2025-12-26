// server/src/components/ui/Drawer.tsx
import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { Theme } from '@radix-ui/themes';

import { useRegisterUIComponent } from "server/src/types/ui-reflection/useRegisterUIComponent";
import { DrawerComponent, UIComponent, AutomationProps } from "server/src/types/ui-reflection/types";
import { withDataAutomationId } from "server/src/types/ui-reflection/withDataAutomationId";

export interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
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

const Drawer: React.FC<DrawerProps & AutomationProps> = ({
  isOpen,
  onClose,
  children,
  isInDrawer = false,
  id,
  reflectionChildren,
  hideCloseButton = false,
  drawerVariant,
  width
}) => {
  // Determine width classes and styles based on width prop or default behavior
  const widthClasses = width 
    ? '' // Use inline style when width is specified
    : `w-[90vw] sm:w-[520px] lg:w-[560px] max-w-[90vw] sm:max-w-[60vw]`;
  
  const widthStyle = width 
    ? { width: width, maxWidth: width }
    : undefined;

  // Always register drawer when mounted, but track open state
  const updateMetadata = useRegisterUIComponent<DrawerComponent>({
    type: 'drawer',
    id: id || '__skip_registration_drawer',
    open: isOpen,
    width: width || (isInDrawer ? '40%' : '50%'),
    children: reflectionChildren
  });
  return (
    <Dialog.Root modal open={isOpen} onOpenChange={(open) => {
      if (!open) onClose(); // Ensure onClose is called when dialog is closed
    }}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={`fixed inset-0 bg-black/50 transition-opacity duration-300 data-[state=closed]:opacity-0 data-[state=open]:opacity-100 ${isInDrawer ? 'z-[60]' : 'z-50'}`}
          onClick={() => onClose()} // Explicitly handle overlay clicks
        />
        <Dialog.Content 
          className={`fixed inset-y-0 right-0 ${widthClasses} bg-white shadow-lg focus:outline-none overflow-y-auto transform transition-all duration-300 ease-in-out will-change-transform data-[state=open]:translate-x-0 data-[state=closed]:translate-x-full data-[state=closed]:opacity-0 data-[state=open]:opacity-100 ${drawerVariant === 'document' ? 'ticket-document-drawer' : ''} ${isInDrawer ? 'z-[61]' : 'z-50'}`}
          style={widthStyle}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          {/* Visually hidden title for accessibility */}
          <Dialog.Title className="sr-only">
            Dialog Content
          </Dialog.Title>
          <Theme>
            <div className="p-6">
              {children}
            </div>
          </Theme>
          {!hideCloseButton && (
            <button
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
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

export default Drawer;
