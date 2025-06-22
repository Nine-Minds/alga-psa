/**
 * Navigation Extension Slot Component
 * 
 * Renders extension navigation items
 */
'use client';

import React, { useEffect, useState } from 'react';
import { NavigationSlotProps, ExtensionNavigationItem } from './NavigationTypes';
import { NavItemRenderer } from './NavItemRenderer';
import { ReflectionContainer } from '@/types/ui-reflection/ReflectionContainer';
import { useAutomationIdAndRegister } from '@/types/ui-reflection/useAutomationIdAndRegister';
import { ContainerComponent } from '@/types/ui-reflection/types';
import { useExtensionContext } from '../ExtensionProvider';
import { getExtensionNavigationItems } from '@/lib/actions/extension-actions';

/**
 * Navigation Slot component
 * 
 * Renders extension navigation items
 */
export function NavigationSlot({
  collapsible = true,
  collapsed = false,
  filter,
}: NavigationSlotProps) {
  console.log('[NavigationSlot] Component rendering');
  
  const [items, setItems] = useState<ExtensionNavigationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const extensionContext = useExtensionContext();
  
  console.log('[NavigationSlot] Initial state:', { loading, itemsCount: items.length, error });
  
  // Register with Alga's UI automation system
  const { automationIdProps } = useAutomationIdAndRegister<ContainerComponent>({
    id: `extension-navigation`,
    type: 'container',
    label: `Extension Navigation Items`
  });
  
  // Fetch navigation items
  useEffect(() => {
    const fetchNavigationItems = async () => {
      console.log('[NavigationSlot] Fetching navigation items...');
      try {
        // Use server action to fetch navigation items
        const navigationItems = await getExtensionNavigationItems();
        console.log('[NavigationSlot] Received navigation items:', navigationItems);
        
        // Filter based on permissions
        const filteredItems = navigationItems.filter(item => {
          const requiredPermissions = item.props.permissions || [];
          const hasPermissions = requiredPermissions.every(permission => 
            extensionContext.hasPermission(permission)
          );
          console.log('[NavigationSlot] Checking permissions for item:', {
            item: item.props.id,
            requiredPermissions,
            hasPermissions
          });
          return hasPermissions;
        });
        
        console.log('[NavigationSlot] Filtered items:', filteredItems);
        
        // Log detailed item info for debugging
        filteredItems.forEach(item => {
          console.log('[NavigationSlot] Navigation item detail:', {
            extensionId: item.extensionId,
            extensionName: item.extensionName,
            component: item.component,
            props: item.props
          });
        });
        
        // Items are already sorted by priority from the server action
        setItems(filteredItems);
        setLoading(false);
      } catch (error) {
        console.error('[NavigationSlot] Failed to fetch navigation items', error);
        setError('Failed to load navigation extensions');
        setLoading(false);
      }
    };
    
    fetchNavigationItems();
  }, [extensionContext]);
  
  // Apply custom filter if provided
  const displayItems = filter ? items.filter(filter) : items;
  
  // If no items or still loading, render nothing
  if (loading || displayItems.length === 0) {
    return null;
  }
  
  return (
    <ReflectionContainer id="extension-navigation" label="Extension Navigation Items">
      <ul 
        className="space-y-1" 
        {...automationIdProps}
      >
        {displayItems.map(item => (
          <li key={`${item.extensionId}-${item.props.id}`}>
            <NavItemRenderer
              extensionId={item.extensionId}
              component={item.component}
              props={item.props}
              collapsed={collapsed}
            />
          </li>
        ))}
      </ul>
    </ReflectionContainer>
  );
}