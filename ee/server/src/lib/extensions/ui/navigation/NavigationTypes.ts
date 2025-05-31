/**
 * Navigation Extension Types
 */
import { ReactNode } from 'react';
import { NavigationItemProps } from '../../types';

/**
 * Props for the NavigationSlot component
 */
export interface NavigationSlotProps {
  collapsible?: boolean;
  collapsed?: boolean;
  filter?: (item: ExtensionNavigationItem) => boolean;
}

/**
 * Props for the NavItemRenderer component
 */
export interface NavItemRendererProps {
  extensionId: string;
  component?: string;
  props: NavigationItemProps;
  collapsed: boolean;
}

/**
 * Extension navigation item definition for internal use
 */
export interface ExtensionNavigationItem {
  extensionId: string;
  component?: string;
  props: NavigationItemProps;
}