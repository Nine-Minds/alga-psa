'use client';

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
  extraContent?: React.ReactNode;
}

export const CustomTabs: React.FC<CustomTabsProps & AutomationProps> = ({ 
  tabs, 
  defaultTab, 
  onTabChange,
  tabStyles,
  extraContent
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
      <Tabs.List className={`flex items-center border-b border-gray-200 mb-4 ${tabStyles?.list || ''}`}>
        {tabs.map((tab): JSX.Element => (
          <Tabs.Trigger
            key={tab.label}
            className={`px-4 py-2 focus:outline-none transition-colors text-gray-500 hover:text-gray-700 border-b-2 border-transparent ${
              tabStyles?.trigger || ''
            } ${
              tabStyles?.activeTrigger || 'data-[state=active]:text-blue-600 data-[state=active]:border-b-2 data-[state=active]:border-blue-600'
            }`}
            value={tab.label}
          >
            {tab.label}
          </Tabs.Trigger>
        ))}
        {extraContent}
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
