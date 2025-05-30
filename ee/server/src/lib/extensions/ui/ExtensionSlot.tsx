/**
 * Extension Slot Component
 * 
 * Defines extension points in the UI where extensions can render components
 */
'use client';

import React, { useEffect, useState } from 'react';
import { ExtensionSlotProps } from './types';
import { ExtensionRenderer } from './ExtensionRenderer';
import { ReflectionContainer } from '../../../../../../server/src/types/ui-reflection/ReflectionContainer';
import { useAutomationIdAndRegister } from '../../../../../../server/src/types/ui-reflection/useAutomationIdAndRegister';
import { ContainerComponent } from '../../../../../../server/src/types/ui-reflection/types';
import logger from '../../../../../../server/src/utils/logger';
import { useExtensionContext } from './ExtensionProvider';

/**
 * Extension Slot component
 * 
 * Renders extension components registered for a specific slot.
 */
export function ExtensionSlot({ name, filter, props = {} }: ExtensionSlotProps) {
  const [components, setComponents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const extensionContext = useExtensionContext();
  
  // Register with Alga's UI automation system
  const { automationIdProps } = useAutomationIdAndRegister<ContainerComponent>({
    id: `extension-slot-${name}`,
    type: 'container',
    label: `Extension Slot: ${name}`
  });
  
  // Fetch components for this slot
  useEffect(() => {
    const fetchComponents = async () => {
      try {
        // In a real implementation, this would fetch from an API endpoint
        // For example: /api/extensions/components?slot=name
        
        // For now, we'll use a placeholder implementation
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Mock data for demonstration
        const mockComponents = [
          {
            extensionId: 'sample-extension-1',
            type: 'dashboard-widget',
            slot: name,
            component: 'SampleWidget',
            props: {
              id: 'sample-widget-1',
              title: 'Sample Widget 1',
              size: 'medium',
              permissions: ['view:dashboard']
            }
          },
          {
            extensionId: 'sample-extension-2',
            type: 'dashboard-widget',
            slot: name,
            component: 'AnotherWidget',
            props: {
              id: 'sample-widget-2',
              title: 'Sample Widget 2',
              size: 'small',
              permissions: ['view:dashboard']
            }
          }
        ];
        
        // Filter out components based on permissions
        const filteredComponents = mockComponents.filter(component => {
          const requiredPermissions = component.props?.permissions || [];
          return requiredPermissions.every(permission => 
            extensionContext.hasPermission(permission)
          );
        });
        
        setComponents(filteredComponents);
        setLoading(false);
      } catch (error) {
        logger.error('Failed to fetch extension components', {
          slot: name,
          error
        });
        setError('Failed to load extensions');
        setLoading(false);
      }
    };
    
    fetchComponents();
  }, [name, extensionContext]);
  
  // Apply custom filter if provided
  const displayComponents = filter 
    ? components.filter(filter)
    : components;
  
  // If no components after filtering, render nothing
  if (!loading && displayComponents.length === 0) {
    return null;
  }
  
  return (
    <ReflectionContainer id={`extension-slot-${name}`} label={`Extension Slot: ${name}`}>
      <div 
        className="extension-slot" 
        data-slot-name={name}
        {...automationIdProps}
      >
        {loading && (
          <div className="text-sm text-gray-500 p-2">Loading extensions...</div>
        )}
        
        {error && (
          <div className="text-sm text-red-500 p-2">{error}</div>
        )}
        
        {!loading && !error && displayComponents.map(component => (
          <div 
            key={`${component.extensionId}-${component.component}`}
            className="extension-component mb-4"
          >
            <ExtensionRenderer
              extensionId={component.extensionId}
              componentPath={component.component}
              slotProps={props}
              defaultProps={component.props}
              onRender={(time) => {
                logger.debug('Extension rendered', {
                  extensionId: component.extensionId,
                  component: component.component,
                  slot: name,
                  renderTime: time
                });
              }}
              onError={(error) => {
                logger.error('Extension render error', {
                  extensionId: component.extensionId,
                  component: component.component,
                  slot: name,
                  error
                });
              }}
            />
          </div>
        ))}
      </div>
    </ReflectionContainer>
  );
}