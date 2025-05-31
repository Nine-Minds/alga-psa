/**
 * Navigation Item Renderer Component
 * 
 * Renders a navigation item with proper styling and behavior
 */
'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as Tooltip from '@radix-ui/react-tooltip';
import * as RadixIcons from '@radix-ui/react-icons';
import { NavItemRendererProps } from './NavigationTypes';
import { ExtensionRenderer } from '../ExtensionRenderer';
import logger from '../../../../../../../server/src/utils/logger';

/**
 * Navigation Item Renderer component
 * 
 * Renders a navigation item with proper styling and behavior
 */
export function NavItemRenderer({
  extensionId,
  component,
  props,
  collapsed
}: NavItemRendererProps) {
  const { id, label, icon, path } = props;
  const pathname = usePathname();
  
  // Check if this item is active
  const isActive = pathname === path;
  
  // If a custom component is provided, render it with ExtensionRenderer
  if (component) {
    return (
      <ExtensionRenderer
        extensionId={extensionId}
        componentPath={component}
        slotProps={{ isActive, collapsed }}
        defaultProps={props}
        onRender={(time) => {
          logger.debug('Navigation item rendered', {
            extensionId,
            component,
            itemId: id,
            renderTime: time
          });
        }}
        onError={(error) => {
          logger.error('Navigation item render error', {
            extensionId,
            component,
            itemId: id,
            error
          });
        }}
      />
    );
  }
  
  // Otherwise, render a standard navigation item
  // Find icon component - this would get the appropriate icon from Radix or other libraries
  let IconComponent: React.ElementType | null = null;
  if (icon) {
    if (icon in RadixIcons) {
      IconComponent = (RadixIcons as any)[icon];
    }
  }
  
  // Default icon if not found or not specified
  if (!IconComponent) {
    IconComponent = RadixIcons.DashboardIcon;
  }
  
  const navItemContent = (
    <Link
      href={path}
      className={`flex items-center py-2 px-3 rounded-md transition-colors ${
        isActive 
          ? 'bg-[#2a2b32] text-white' 
          : 'text-gray-300 hover:bg-[#2a2b32] hover:text-white'
      }`}
      data-automation-id={`nav-item-${id}`}
    >
      {IconComponent && (
        <span className="mr-3">
          <IconComponent className="h-5 w-5" />
        </span>
      )}
      {!collapsed && <span className="text-sm">{label}</span>}
    </Link>
  );
  
  // If sidebar is collapsed, wrap with tooltip
  if (collapsed) {
    return (
      <Tooltip.Provider delayDuration={300}>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            {navItemContent}
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              className="bg-gray-800 text-white px-2 py-1 rounded-md text-sm"
              side="right"
              sideOffset={5}
            >
              {label}
              <Tooltip.Arrow style={{ fill: '#1f2937' }} />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </Tooltip.Provider>
    );
  }
  
  return navItemContent;
}