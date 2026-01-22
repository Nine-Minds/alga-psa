'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card } from '@alga-psa/ui/components/Card';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import CustomTabs from '@alga-psa/ui/components/CustomTabs';
import { LayoutTemplate, Code2, Bell, History } from 'lucide-react';

// Import tab content components
import TemplateLibrary from './TemplateLibrary';
import Workflows from './Workflows';
import EventsCatalogV2 from './EventsCatalogV2';
import LogsHistory from './LogsHistory';

export default function AutomationHub() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  // Get current tab from URL or default to template-library
  const currentTab = searchParams?.get('tab') || 'template-library';
  
  // Get execution ID for logs history if present
  const executionId = searchParams?.get('executionId');
  
  // Get workflow ID if present
  const workflowId = searchParams?.get('workflowId');
  
  const handleTabChange = (value: string) => {
    // Preserve other query parameters like executionId and workflowId
    const params = new URLSearchParams(searchParams?.toString() || '');
    params.set('tab', value);
    
    // If switching away from logs-history tab, remove executionId
    if (value !== 'logs-history') {
      params.delete('executionId');
    }
    
    // If switching away from workflows tab, remove workflowId
    if (value !== 'workflows') {
      params.delete('workflowId');
    }
    
    router.push(`/msp/automation-hub?${params.toString()}`);
  };

  // Define the tabs for the navigation
  const tabs = [
    {
      label: 'Template Library',
      content: <TemplateLibrary />
    },
    {
      label: 'Workflows',
      content: <Workflows workflowId={workflowId} />
    },
    {
      label: 'Events Catalog',
      content: <EventsCatalogV2 />
    },
    {
      label: 'Logs & History',
      content: <LogsHistory />,
    },
  ];

  // Map tab labels to their respective URL parameter values
  const tabValues: Record<string, string> = {
    'Template Library': 'template-library',
    'Workflows': 'workflows',
    'Events Catalog': 'events-catalog',
    'Logs & History': 'logs-history',
  };

  // Map URL parameter values to tab labels
  const valueToLabel: Record<string, string> = {
    'template-library': 'Template Library',
    'workflows': 'Workflows',
    'events-catalog': 'Events Catalog',
    'logs-history': 'Logs & History',
  };

  // Get the active tab label based on the URL parameter
  const getActiveTab = () => {
    return valueToLabel[currentTab] || 'Template Library';
  };

  // Update URLs in components to use the new tab-based navigation
  useEffect(() => {
    // Update any links in the document that point to the old URLs
    const updateLinks = () => {
      const links = document.querySelectorAll('a[href^="/msp/automation-hub/"]');
      links.forEach(link => {
        const href = link.getAttribute('href');
        if (href) {
          // Extract the section from the URL
          const section = href.split('/').pop();
          if (section && ['template-library', 'workflows', 'events-catalog', 'logs-history'].includes(section)) {
            link.setAttribute('href', `/msp/automation-hub?tab=${section}`);
          }
        }
      });
    };
    
    // Run after render
    setTimeout(updateLinks, 100);
  }, [currentTab]);

  return (
    <ReflectionContainer id="automation-hub-container" label="Automation Hub">
      <div className="flex flex-col h-full">
        <Card className="p-6 mb-6">
          <h1 className="text-2xl font-bold mb-4 text-gray-900">Automation Hub</h1>
          <p className="text-gray-600 mb-6">
            Create, manage, and monitor TypeScript-based workflows with event-based triggers
          </p>
          
          <CustomTabs
            tabs={tabs}
            defaultTab={getActiveTab()}
            onTabChange={(tabLabel) => {
              const tabValue = tabValues[tabLabel];
              if (tabValue) {
                handleTabChange(tabValue);
              }
            }}
            tabStyles={{
              root: "flex flex-col h-full",
              list: "-mb-px",
              trigger: "whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm",
              activeTrigger: "data-[state=active]:border-primary-500 data-[state=active]:text-primary-600",
              content: "flex-1 overflow-auto mt-4", // Style the content properly
            }}
          />
        </Card>
      </div>
    </ReflectionContainer>
  );
}
