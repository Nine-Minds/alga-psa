'use client';

import React from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { AutomationProps } from '../../types/ui-reflection/types';
import { LucideIcon } from 'lucide-react';

export interface TabContent {
  label: string;
  content: React.ReactNode;
  icon?: LucideIcon;
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
  /**
   * Optional prefix applied to tab trigger ids to satisfy unique id requirements
   */
  idPrefix?: string;
  orientation?: 'horizontal' | 'vertical';
}

export const CustomTabs: React.FC<CustomTabsProps & AutomationProps> = ({
  tabs,
  defaultTab,
  onTabChange,
  tabStyles,
  extraContent,
  idPrefix,
  orientation = 'horizontal',
}) => {
  const [value, setValue] = React.useState(defaultTab || tabs[0].label);
  const generatedId = React.useId();
  const prefix = React.useMemo(() => idPrefix || `tabs-${generatedId}`, [idPrefix, generatedId]);

  React.useEffect(() => {
    if (defaultTab) {
      setValue(defaultTab);
    }
  }, [defaultTab]);

  const defaultRootClass = orientation === 'vertical'
    ? 'md:grid md:grid-cols-[220px_minmax(0,1fr)] gap-6'
    : '';

  const defaultListClass = orientation === 'vertical'
    ? 'flex flex-col border-r border-border/60 dark:border-border/40 space-y-1 pr-4'
    : 'flex items-center border-b border-gray-200 mb-4';

  const defaultTriggerClass = orientation === 'vertical'
    ? 'w-full justify-start px-3 py-2 text-left text-sm text-muted-foreground hover:text-foreground border-l-2 border-transparent data-[state=active]:border-primary-500 data-[state=active]:text-primary-600'
    : 'px-4 py-2 focus:outline-none transition-colors text-gray-500 hover:text-gray-700 border-b-2 border-transparent';

  const defaultActiveTriggerClass = orientation === 'vertical'
    ? ''
    : 'data-[state=active]:text-blue-600 data-[state=active]:border-b-2 data-[state=active]:border-blue-600';

  return (
    <Tabs.Root 
      className={`${defaultRootClass} ${tabStyles?.root || ''}`} 
      value={value}
      orientation={orientation}
      onValueChange={(newValue) => {
        setValue(newValue);
        onTabChange?.(newValue);
      }}
    >
      <Tabs.List className={`${defaultListClass} ${tabStyles?.list || ''}`}>
        {tabs.map((tab, index): JSX.Element => {
          const IconComponent = tab.icon;
          const hasIcon = !!IconComponent;
          const iconClassName = hasIcon 
            ? (orientation === 'vertical' ? 'flex items-center gap-2' : 'flex items-center gap-1.5')
            : '';
          return (
            <Tabs.Trigger
              key={tab.label}
              id={`${prefix}-trigger-${index}`}
              className={`${defaultTriggerClass} ${iconClassName} ${tabStyles?.trigger || ''} ${tabStyles?.activeTrigger || defaultActiveTriggerClass}`}
              value={tab.label}
            >
              {IconComponent && <IconComponent className="h-4 w-4 shrink-0" />}
              {tab.label}
            </Tabs.Trigger>
          );
        })}
        {extraContent}
      </Tabs.List>
      {tabs.map((tab, index): JSX.Element => (
        <Tabs.Content 
          key={tab.label}
          id={`${prefix}-content-${index}`}
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
