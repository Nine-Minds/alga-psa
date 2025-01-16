// server/src/components/ui/CustomTabs.tsx
import React from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { AutomationProps } from '../../types/ui-reflection/types';

export interface TabContent {
  label: string;
  content: React.ReactNode;
}

export interface CustomTabsProps {
  tabs: TabContent[];
  defaultTab?: string;
  onTabChange?: (tabValue: string) => void;
  tabStyles?: {
    root?: string;
    list?: string;
    trigger?: string;
    activeTrigger?: string;
    content?: string;
  };
}

export const CustomTabs: React.FC<CustomTabsProps & AutomationProps> = ({ 
  tabs, 
  defaultTab, 
  onTabChange,
  tabStyles 
}) => {
  const [value, setValue] = React.useState(defaultTab || tabs[0].label);

  React.useEffect(() => {
    if (defaultTab) {
      setValue(defaultTab);
    }
  }, [defaultTab]);

  return (
    <Tabs.Root 
      className={tabStyles?.root || ''} 
      value={value}
      onValueChange={(newValue) => {
        setValue(newValue);
        onTabChange?.(newValue);
      }}
    >
      <Tabs.List className={`flex border-b border-gray-200 mb-4 ${tabStyles?.list || ''}`}>
        {tabs.map((tab): JSX.Element => (
          <Tabs.Trigger
            key={tab.label}
            className={`px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 hover:border-gray-300 focus:outline-none focus:text-gray-700 focus:border-gray-300 border-b-2 border-transparent ${
              tabStyles?.trigger || ''
            } ${
              tabStyles?.activeTrigger || 'data-[state=active]:border-indigo-500 data-[state=active]:text-indigo-600'
            }`}
            value={tab.label}
          >
            {tab.label}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      {tabs.map((tab): JSX.Element => (
        <Tabs.Content 
          key={tab.label} 
          value={tab.label} 
          className={`focus:outline-none ${tabStyles?.content || ''}`}
        >
          {tab.content}
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
};

export default CustomTabs;
