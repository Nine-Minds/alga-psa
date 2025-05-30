/**
 * Tab Extension Slot Component
 * 
 * Renders extension tabs for a specific parent page
 */
'use client';

import React, { useEffect, useState } from 'react';
import { TabExtensionSlotProps, ExtensionTabItem } from './TabExtensionTypes';
import { TabExtensionRenderer } from './TabExtensionRenderer';
import { ReflectionContainer } from '../../../../types/ui-reflection/ReflectionContainer';
import { useAutomationIdAndRegister } from '../../../../types/ui-reflection/useAutomationIdAndRegister';
import { ContainerComponent } from '../../../../types/ui-reflection/types';
import { useExtensionContext } from '../ExtensionProvider';
import { logger } from '../../../../utils/logger';

/**
 * Tab Extension Slot component
 * 
 * Renders extension tabs for a specific parent page
 */
export function TabExtensionSlot({ 
  parentPage, 
  currentTab, 
  onTabChange 
}: TabExtensionSlotProps) {
  const [tabs, setTabs] = useState<ExtensionTabItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const extensionContext = useExtensionContext();
  
  // Register with Alga's UI automation system
  const { automationIdProps } = useAutomationIdAndRegister<ContainerComponent>({
    id: `extension-tabs-${parentPage}`,
    type: 'container',
    label: `Extension Tabs for ${parentPage}`,
    variant: 'default'
  });
  
  // Fetch tab extensions for this parent page
  useEffect(() => {
    const fetchTabs = async () => {
      try {
        // In a real implementation, this would fetch from an API endpoint
        // For example: /api/extensions/tabs?parentPage=${parentPage}
        
        // For now, we'll use a placeholder implementation
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Mock data for demonstration
        const mockTabs: ExtensionTabItem[] = [
          {
            extensionId: 'custom-reports-extension',
            component: 'CustomReportsTab',
            props: {
              id: 'custom-reports',
              parentPage,
              label: 'Custom Reports',
              icon: 'FileTextIcon',
              priority: 50,
              permissions: ['view:reports']
            }
          },
          {
            extensionId: 'billing-analytics-extension',
            component: 'BillingAnalyticsTab',
            props: {
              id: 'billing-analytics',
              parentPage,
              label: 'Analytics',
              icon: 'BarChartIcon',
              priority: 40,
              permissions: ['view:billing']
            }
          }
        ];
        
        // Filter based on permissions
        const filteredTabs = mockTabs.filter(tab => {
          const requiredPermissions = tab.props.permissions || [];
          return requiredPermissions.every(permission => 
            extensionContext.hasPermission(permission)
          );
        });
        
        // Sort by priority (higher values first)
        filteredTabs.sort((a, b) => 
          (b.props.priority || 0) - (a.props.priority || 0)
        );
        
        setTabs(filteredTabs);
        setLoading(false);
      } catch (error) {
        logger.error('Failed to fetch tab extensions', {
          parentPage,
          error
        });
        setError('Failed to load tab extensions');
        setLoading(false);
      }
    };
    
    fetchTabs();
  }, [parentPage, extensionContext]);
  
  // If no tabs or still loading, render nothing
  if (loading || tabs.length === 0) {
    return null;
  }
  
  return (
    <ReflectionContainer id={`extension-tabs-${parentPage}`} label={`Extension Tabs for ${parentPage}`}>
      <div 
        className="extension-tabs"
        {...automationIdProps}
      >
        {/* Tab buttons */}
        <div className="flex">
          {tabs.map(tab => (
            <button
              key={tab.props.id}
              className={`px-4 py-2 border-b-2 ${
                currentTab === tab.props.id 
                  ? 'border-primary-500 text-primary-700 font-medium' 
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
              onClick={() => onTabChange(tab.props.id)}
              data-tab-id={tab.props.id}
              data-automation-id={`tab-${tab.props.id}`}
            >
              {tab.props.label}
            </button>
          ))}
        </div>
        
        {/* Tab content */}
        {tabs.map(tab => (
          <div 
            key={tab.props.id}
            className={currentTab === tab.props.id ? 'block' : 'hidden'}
            data-tab-content={tab.props.id}
          >
            {currentTab === tab.props.id && (
              <TabExtensionRenderer
                extensionId={tab.extensionId}
                component={tab.component}
                props={tab.props}
                isActive={currentTab === tab.props.id}
              />
            )}
          </div>
        ))}
      </div>
    </ReflectionContainer>
  );
}