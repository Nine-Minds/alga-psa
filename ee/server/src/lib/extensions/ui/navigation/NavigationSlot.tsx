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
import logger from '@/utils/logger';

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
        // In a real implementation, this would fetch from an API endpoint
        // For example: /api/extensions/navigation
        
        // For now, we'll use a placeholder implementation
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Mock data for demonstration
        const mockItems: ExtensionNavigationItem[] = [
          {
            extensionId: 'sample-extension-1',
            component: 'NavItem',
            props: {
              id: 'sample-nav-1',
              label: 'Custom Reports',
              icon: 'BarChartIcon',
              path: '/msp/extensions/reports',
              priority: 80,
              permissions: ['view:reports']
            }
          },
          {
            extensionId: 'sample-extension-2',
            component: undefined, // Some items may not need a custom component
            props: {
              id: 'sample-nav-2',
              label: 'Asset Tracking',
              icon: 'BoxIcon',
              path: '/msp/extensions/assets',
              priority: 70,
              permissions: ['view:assets']
            }
          }
        ];
        
        // Filter based on permissions
        const filteredItems = mockItems.filter(item => {
          const requiredPermissions = item.props.permissions || [];
          return requiredPermissions.every(permission => 
            extensionContext.hasPermission(permission)
          );
        });
        
        // Sort by priority (higher values first)
        filteredItems.sort((a, b) => 
          (b.props.priority || 0) - (a.props.priority || 0)
        );
        
        setItems(filteredItems);
        setLoading(false);
      } catch (error) {
        logger.error('Failed to fetch navigation items', { error });
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