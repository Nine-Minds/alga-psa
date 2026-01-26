'use client';

import * as React from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './DropdownMenu';
import { useDropdownMenuRegister, useMenuItemRegister, DropdownMenuItemConfig } from '../ui-reflection/useDropdownMenuRegister';
import { ReflectionContainer } from '../ui-reflection/ReflectionContainer';

export interface ReflectedDropdownMenuProps {
  /** Unique identifier for the dropdown menu */
  id?: string;
  /** The trigger element */
  trigger: React.ReactNode;
  /** Menu item configurations */
  items: DropdownMenuItemConfig[];
  /** Whether the dropdown is currently open */
  open?: boolean;
  /** Callback when dropdown open state changes */
  onOpenChange?: (open: boolean) => void;
  /** Additional props for the trigger */
  triggerProps?: React.ComponentProps<typeof DropdownMenuTrigger>;
  /** Additional props for the content */
  contentProps?: React.ComponentProps<typeof DropdownMenuContent>;
  /** Label for the trigger (for UI reflection) */
  triggerLabel?: string;
}

/**
 * DropdownMenu component with integrated UI reflection support.
 * This component automatically registers itself and its menu items with the UI reflection system,
 * making them accessible to automation tools.
 */
export const ReflectedDropdownMenu = ({
  id,
  trigger,
  items,
  open: controlledOpen,
  onOpenChange,
  triggerProps,
  contentProps,
  triggerLabel
}: ReflectedDropdownMenuProps) => {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;

  const handleOpenChange = React.useCallback((newOpen: boolean) => {
    if (!isControlled) {
      setInternalOpen(newOpen);
    }
    onOpenChange?.(newOpen);
  }, [isControlled, onOpenChange]);

  const {
    dropdownTriggerProps,
    dropdownContentProps,
    getMenuItemProps,
    handleMenuItemSelect
  } = useDropdownMenuRegister({
    id,
    triggerLabel,
    items,
    open,
    onOpenChange: handleOpenChange
  });

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger 
        asChild
        {...triggerProps}
        {...dropdownTriggerProps}
      >
        {trigger}
      </DropdownMenuTrigger>
      
      <DropdownMenuContent 
        {...contentProps}
        {...dropdownContentProps}
      >
        <ReflectionContainer 
          id={dropdownContentProps['data-automation-id']} 
          data-automation-type="dropdown-content"
        >
          {items.map((item): React.ReactElement => (
            <ReflectedMenuItem
              key={item.id}
              item={item}
              onSelect={handleMenuItemSelect(item.id, item.onSelect)}
            />
          ))}
        </ReflectionContainer>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

interface ReflectedMenuItemProps {
  item: DropdownMenuItemConfig;
  onSelect: () => void;
}

/**
 * Individual menu item component with UI reflection support.
 */
const ReflectedMenuItem = ({
  item,
  onSelect
}: ReflectedMenuItemProps) => {
  const { automationIdProps } = useMenuItemRegister({
    id: item.id,
    text: item.text,
    icon: item.icon,
    variant: item.variant
  });

  return (
    <DropdownMenuItem
      className={`flex items-center px-2 py-1.5 text-sm cursor-pointer hover:bg-gray-100 rounded-[3px] focus:outline-none focus:bg-gray-100 ${
        item.variant === 'destructive' 
          ? 'text-red-600 hover:bg-red-50 hover:text-red-700 focus:bg-red-50 focus:text-red-700' 
          : ''
      }`}
      onSelect={onSelect}
      {...automationIdProps}
    >
      {item.icon && (
        <span className="mr-2" data-automation-type="menu-item-icon">
          {item.icon}
        </span>
      )}
      <span data-automation-type="menu-item-text">
        {item.text}
      </span>
    </DropdownMenuItem>
  );
};

ReflectedDropdownMenu.displayName = 'ReflectedDropdownMenu';
