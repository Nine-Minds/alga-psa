// server/src/components/integrations/qbo/QboMappingManager.tsx
'use client'; // This component will manage state and potentially fetch data client-side

// server/src/components/integrations/qbo/QboMappingManager.tsx
'use client';

import React from 'react';
import CustomTabs, { TabContent } from 'server/src/components/ui/CustomTabs'; // Import CustomTabs and its TabContent interface
// Placeholder imports for the specific mapping tables - these will be created next
import { QboItemMappingTable, QboItemMappingTableOverrides } from './QboItemMappingTable';
import { QboTaxCodeMappingTable } from './QboTaxCodeMappingTable';
import { QboTermMappingTable } from './QboTermMappingTable';

interface QboMappingManagerProps {
  realmId: string;
  // Removed tenantId prop
}

export function QboMappingManager({ realmId }: QboMappingManagerProps) {
  const mappingOverrides =
    typeof window !== 'undefined'
      ? (
          window as typeof window & {
            __ALGA_PLAYWRIGHT_QBO__?: {
              itemMappingOverrides?: QboItemMappingTableOverrides;
            };
          }
        ).__ALGA_PLAYWRIGHT_QBO__?.itemMappingOverrides
      : undefined;

  // Define the tabs according to the TabContent interface
  const mappingTabs: TabContent[] = [
    {
      label: 'Items / Services', // Label used as value and display text
      content: <QboItemMappingTable realmId={realmId} overrides={mappingOverrides} />, // Removed tenantId
    },
    {
      label: 'Tax Codes',
      content: <QboTaxCodeMappingTable realmId={realmId} />, // Removed tenantId
    },
    {
      label: 'Payment Terms',
      content: <QboTermMappingTable realmId={realmId} />, // Removed tenantId
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
