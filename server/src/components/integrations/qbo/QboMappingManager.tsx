// server/src/components/integrations/qbo/QboMappingManager.tsx
'use client'; // This component will manage state and potentially fetch data client-side

// server/src/components/integrations/qbo/QboMappingManager.tsx
'use client';

import React from 'react';
import CustomTabs, { TabContent } from 'server/src/components/ui/CustomTabs'; // Import CustomTabs and its TabContent interface
// Placeholder imports for the specific mapping tables - these will be created next
import { QboItemMappingTable } from './QboItemMappingTable';
import { QboTaxCodeMappingTable } from './QboTaxCodeMappingTable';
import { QboTermMappingTable } from './QboTermMappingTable';

interface QboMappingManagerProps {
  realmId: string;
  tenantId: string;
}

export function QboMappingManager({ realmId, tenantId }: QboMappingManagerProps) {
  // Define the tabs according to the TabContent interface
  const mappingTabs: TabContent[] = [
    {
      label: 'Items / Services', // Label used as value and display text
      content: <QboItemMappingTable realmId={realmId} tenantId={tenantId} />,
    },
    {
      label: 'Tax Codes',
      content: <QboTaxCodeMappingTable realmId={realmId} tenantId={tenantId} />,
    },
    {
      label: 'Payment Terms',
      content: <QboTermMappingTable realmId={realmId} tenantId={tenantId} />,
    },
  ];

  // Define custom styles to make the tabs fill the width
  const tabStyles = {
    list: 'grid w-full grid-cols-3', // Apply grid styles to the list
    trigger: 'data-[state=active]:shadow-none', // Optional: remove default active shadow if needed
  };

  return (
    <CustomTabs
      tabs={mappingTabs}
      defaultTab={mappingTabs[0].label} // Use the label as the default tab identifier
      tabStyles={tabStyles}
      // Add component ID for testing/automation
      data-automation-type="qbo-mapping-tabs"
    />
  );
}