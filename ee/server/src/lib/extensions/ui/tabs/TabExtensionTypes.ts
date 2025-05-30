/**
 * Tab Extension Types
 */
import { ReactNode } from 'react';
import { TabExtensionProps } from '../../types';

/**
 * Props for the TabExtensionSlot component
 */
export interface TabExtensionSlotProps {
  parentPage: string;  // Which page these tabs belong to (e.g., "billing")
  currentTab: string;  // Currently active tab
  onTabChange: (tabId: string) => void; // Tab change handler
}

/**
 * Props for the TabExtensionRenderer component
 */
export interface TabExtensionRendererProps {
  extensionId: string;
  component: string;
  isActive: boolean;
  props: TabExtensionProps;
}

/**
 * Extension tab item definition for internal use
 */
export interface ExtensionTabItem {
  extensionId: string;
  component: string;
  props: TabExtensionProps;
}