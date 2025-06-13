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
  const [items, setItems] = useState<ExtensionNavigationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const extensionContext = useExtensionContext();
  
  // Register with Alga's UI automation system
  const { automationIdProps } = useAutomationIdAndRegister<ContainerComponent>({
    id: `extension-navigation`,
    type: 'container',
    label: `Extension Navigation Items`
  });
  
  // Fetch navigation items
  useEffect(() => {
    const fetchNavigationItems = async () => {
      try {
        // Fetch navigation items from the API
        const response = await fetch('/api/extensions/navigation');
        
        if (!response.ok) {
          throw new Error(`Failed to fetch navigation items: ${response.statusText}`);
        }
        
        const data = await response.json();
        const navigationItems: ExtensionNavigationItem[] = data.items || [];
        
        // Filter based on permissions
        const filteredItems = navigationItems.filter(item => {
          const requiredPermissions = item.props.permissions || [];
          return requiredPermissions.every(permission => 
            extensionContext.hasPermission(permission)
          );
        });
        
        // Items are already sorted by priority from the API
        setItems(filteredItems);
        setLoading(false);
      } catch (error) {
        console.error('Failed to fetch navigation items', error);
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