'use client';

import React, { useEffect, useCallback, useRef } from 'react';
import { DropdownMenuComponent, MenuItemComponent } from './types';
import { useAutomationIdAndRegister } from './useAutomationIdAndRegister';
import { CommonActions } from './actionBuilders';

export interface DropdownMenuItemConfig {
  id: string;
  text: string;
  icon?: React.ReactNode;
  variant?: string;
  onSelect?: () => void;
}

export interface UseDropdownMenuRegisterConfig {
  /** Unique identifier for the dropdown menu */
  id?: string;
  /** Label for the trigger button */
  triggerLabel?: string;
  /** Menu item configurations */
  items: DropdownMenuItemConfig[];
  /** Whether the dropdown is currently open */
  open: boolean;
  /** Callback when dropdown open state changes */
  onOpenChange?: (open: boolean) => void;
}

/**
 * Custom hook for registering dropdown menus with UI reflection system.
 * This hook handles registration of both the dropdown container and individual menu items.
 */
export function useDropdownMenuRegister(config: UseDropdownMenuRegisterConfig) {
  const { id, triggerLabel, items, open, onOpenChange } = config;
  
  // Register the main dropdown menu component
  const { automationIdProps: dropdownProps, updateMetadata: updateDropdownMetadata } = 
    useAutomationIdAndRegister<DropdownMenuComponent>({
      type: 'dropdownMenu',
      id,
      label: triggerLabel,
      open,
      triggerLabel
    }, () => [
      CommonActions.open('Open dropdown menu'),
      CommonActions.close('Close dropdown menu'),
      { 
        type: 'toggle', 
        available: true, 
        description: 'Toggle dropdown menu open/closed', 
        parameters: [] 
      }
    ]);

  // Track registered menu items to update their state
  const registeredItemsRef = useRef<{ [itemId: string]: (partial: Partial<MenuItemComponent>) => void }>({});
  
  // Register each menu item when the dropdown is open
  useEffect(() => {
    if (open) {
      // Clear previous registrations
      registeredItemsRef.current = {};
      
      // Menu items will be registered individually when they render
    }
  }, [open, items, dropdownProps.id]);

  // Update dropdown metadata when state changes
  useEffect(() => {
    updateDropdownMetadata({
      open,
      triggerLabel
    });
  }, [open, triggerLabel, updateDropdownMetadata]);

  // Helper function to get menu item props
  const getMenuItemProps = useCallback((itemId: string) => {
    const fullItemId = `${dropdownProps.id}-${itemId}`;
    return {
      id: fullItemId,
      'data-automation-id': fullItemId,
    };
  }, [dropdownProps.id]);

  // Helper function to handle menu item selection
  const handleMenuItemSelect = useCallback((_itemId: string, onSelect?: () => void) => {
    return () => {
      onSelect?.();
      onOpenChange?.(false);
    };
  }, [onOpenChange]);

  return {
    // Props for the dropdown trigger
    dropdownTriggerProps: dropdownProps,
    
    // Props for the dropdown content container
    dropdownContentProps: {
      'data-automation-id': `${dropdownProps.id}-content`,
    },
    
    // Function to get props for individual menu items
    getMenuItemProps,
    
    // Enhanced onSelect handler that includes UI state management
    handleMenuItemSelect,
    
    // Manual registration function for menu items (to be called when items are rendered)
    registerMenuItem: useCallback((_item: DropdownMenuItemConfig) => {
      // This will be implemented to manually register menu items
      // when they are actually rendered in the DOM
    }, [])
  };
}

/**
 * Simplified hook for menu items that can be used within dropdown content.
 * This should be called for each menu item when it's rendered.
 */
export function useMenuItemRegister(config: {
  id: string;
  text: string;
  icon?: React.ReactNode;
  variant?: string;
  disabled?: boolean;
}) {
  // Convert React node icon to string representation for UI reflection
  const iconString = React.isValidElement(config.icon) 
    ? (config.icon.type as any)?.displayName || (config.icon.type as any)?.name || 'icon'
    : typeof config.icon === 'string' 
    ? config.icon 
    : undefined;

  const { automationIdProps, updateMetadata } = useAutomationIdAndRegister<MenuItemComponent>({
    type: 'menuItem',
    id: config.id,
    label: config.text,
    text: config.text,
    icon: iconString,
    variant: config.variant || 'default',
    disabled: config.disabled
  }, () => [
    CommonActions.click(`Click ${config.text}`)
  ]);

  // Update metadata when config changes
  useEffect(() => {
    updateMetadata({
      text: config.text,
      icon: iconString,
      variant: config.variant || 'default',
      disabled: config.disabled
    });
  }, [config.text, iconString, config.variant, config.disabled, updateMetadata]);

  return {
    automationIdProps,
    updateMetadata
  };
}