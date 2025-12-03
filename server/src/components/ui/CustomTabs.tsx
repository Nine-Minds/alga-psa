'use client';

import React from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { AutomationProps } from '../../types/ui-reflection/types';
import { LucideIcon, ChevronDown } from 'lucide-react';

export interface TabContent {
  label: string;
  content: React.ReactNode;
  icon?: LucideIcon;
}

export interface TabGroup {
  title?: string;
  tabs: TabContent[];
}

export interface CustomTabsProps {
  tabs?: TabContent[];
  groups?: TabGroup[];
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
  groups,
  defaultTab,
  onTabChange,
  tabStyles,
  extraContent,
  idPrefix,
  orientation = 'horizontal',
}) => {
  // Use groups if provided, otherwise fall back to flat tabs
  const allTabs = React.useMemo(() => {
    if (groups && groups.length > 0) {
      return groups.flatMap(group => group.tabs);
    }
    return tabs || [];
  }, [tabs, groups]);

  const [value, setValue] = React.useState(defaultTab || allTabs[0]?.label || '');
  const generatedId = React.useId();
  const prefix = React.useMemo(() => idPrefix || `tabs-${generatedId}`, [idPrefix, generatedId]);

  // Track expanded state for each section (default to all expanded)
  const [expandedSections, setExpandedSections] = React.useState<Record<number, boolean>>(() => {
    if (groups && groups.length > 0) {
      return groups.reduce((acc, _, index) => {
        acc[index] = true; // Default to expanded
        return acc;
      }, {} as Record<number, boolean>);
    }
    return {};
  });

  const toggleSection = React.useCallback((groupIndex: number) => {
    setExpandedSections(prev => ({
      ...prev,
      [groupIndex]: !prev[groupIndex]
    }));
  }, []);

  React.useEffect(() => {
    if (defaultTab) {
      setValue(defaultTab);
      // Auto-expand the section containing the default tab
      if (groups && groups.length > 0) {
        groups.forEach((group, groupIndex) => {
          if (group.tabs.some(tab => tab.label === defaultTab)) {
            setExpandedSections(prev => ({
              ...prev,
              [groupIndex]: true
            }));
          }
        });
      }
    }
  }, [defaultTab, groups]);

  // Auto-expand section when a tab within it becomes active
  React.useEffect(() => {
    if (groups && groups.length > 0 && value) {
      groups.forEach((group, groupIndex) => {
        if (group.tabs.some(tab => tab.label === value)) {
          setExpandedSections(prev => {
            if (prev[groupIndex] === false) {
              return { ...prev, [groupIndex]: true };
            }
            return prev;
          });
        }
      });
    }
  }, [value, groups]);

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

  // Render grouped tabs if groups are provided and orientation is vertical
  const renderGroupedTabs = groups && groups.length > 0 && orientation === 'vertical';

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
        {renderGroupedTabs ? (
          groups.map((group, groupIndex) => {
            const isExpanded = expandedSections[groupIndex] !== false; // Default to true
            return (
              <div key={groupIndex} className="space-y-1">
                {group.title && (
                  <button
                    type="button"
                    onClick={() => toggleSection(groupIndex)}
                    className="w-full px-3 pt-4 pb-2 first:pt-0 flex items-center gap-2 group transition-opacity"
                  >
                    <ChevronDown 
                      className={`h-3 w-3 text-primary-600 group-hover:text-yellow-500 transition-all duration-200 ${isExpanded ? '' : '-rotate-90'}`}
                    />
                    <p className="text-xs font-semibold uppercase tracking-wide text-primary-600 group-hover:text-yellow-500 transition-colors duration-200">
                      {group.title}
                    </p>
                  </button>
                )}
                {isExpanded && group.tabs.map((tab, tabIndex): JSX.Element => {
                  const IconComponent = tab.icon;
                  const hasIcon = !!IconComponent;
                  const iconClassName = hasIcon ? 'flex items-center gap-2' : '';
                  const globalIndex = groups.slice(0, groupIndex).reduce((acc, g) => acc + g.tabs.length, 0) + tabIndex;
                  return (
                    <Tabs.Trigger
                      key={tab.label}
                      id={`${prefix}-trigger-${globalIndex}`}
                      className={`${defaultTriggerClass} ${iconClassName} ml-4 ${tabStyles?.trigger || ''} ${tabStyles?.activeTrigger || defaultActiveTriggerClass}`}
                      value={tab.label}
                    >
                      {IconComponent && <IconComponent className="h-4 w-4 shrink-0" />}
                      {tab.label}
                    </Tabs.Trigger>
                  );
                })}
              </div>
            );
          })
        ) : (
          allTabs.map((tab, index): JSX.Element => {
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
          })
        )}
        {extraContent}
      </Tabs.List>
      {allTabs.map((tab, index): JSX.Element => (
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
