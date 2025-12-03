'use client';

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { ChevronDown, Settings, Globe, UserCog, Users, MessageSquare, Layers, Handshake, Bell, Clock, CreditCard, Download, Mail, Plug, Puzzle } from 'lucide-react';
import { LucideIcon } from 'lucide-react';

interface SettingsMenuItem {
  label: string;
  slug: string;
  icon: LucideIcon;
}

interface SettingsMenuGroup {
  title: string;
  items: SettingsMenuItem[];
}

interface SettingsSidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const settingsMenuGroups: SettingsMenuGroup[] = [
  {
    title: 'Organization & Access',
    items: [
      { label: 'General', slug: 'general', icon: Settings },
      { label: 'Users', slug: 'users', icon: UserCog },
      { label: 'Teams', slug: 'teams', icon: Users },
      { label: 'Client Portal', slug: 'client-portal', icon: Globe },
    ]
  },
  {
    title: 'Work Management',
    items: [
      { label: 'Ticketing', slug: 'ticketing', icon: MessageSquare },
      { label: 'Projects', slug: 'projects', icon: Layers },
      { label: 'Interactions', slug: 'interactions', icon: Handshake },
    ]
  },
  {
    title: 'Time & Billing',
    items: [
      { label: 'Time Entry', slug: 'time-entry', icon: Clock },
      { label: 'Billing', slug: 'billing', icon: CreditCard },
    ]
  },
  {
    title: 'Communication',
    items: [
      { label: 'Notifications', slug: 'notifications', icon: Bell },
      { label: 'Email', slug: 'email', icon: Mail },
    ]
  },
  {
    title: 'Data & Integration',
    items: [
      { label: 'Import/Export', slug: 'import-export', icon: Download },
      { label: 'Integrations', slug: 'integrations', icon: Plug },
      { label: 'Extensions', slug: 'extensions', icon: Puzzle },
    ]
  }
];

const SettingsSidebar: React.FC<SettingsSidebarProps> = ({ activeTab, onTabChange }) => {
  // Track expanded state for each section (default to all expanded)
  const [expandedSections, setExpandedSections] = useState<Record<number, boolean>>(() => {
    return settingsMenuGroups.reduce((acc, _, index) => {
      acc[index] = true;
      return acc;
    }, {} as Record<number, boolean>);
  });

  const toggleSection = useCallback((groupIndex: number) => {
    setExpandedSections(prev => ({
      ...prev,
      [groupIndex]: !prev[groupIndex]
    }));
  }, []);

  // Auto-expand section containing active tab
  useEffect(() => {
    settingsMenuGroups.forEach((group, groupIndex) => {
      if (group.items.some(item => item.label === activeTab)) {
        setExpandedSections(prev => {
          if (prev[groupIndex] === false) {
            return { ...prev, [groupIndex]: true };
          }
          return prev;
        });
      }
    });
  }, [activeTab]);

  return (
    <aside className="w-52 bg-white h-full flex flex-col border-r border-gray-200 shrink-0">
      <nav className="flex-1 py-4 overflow-y-auto">
        {settingsMenuGroups.map((group, groupIndex) => {
          const isExpanded = expandedSections[groupIndex] !== false;
          return (
            <div key={groupIndex} className="mb-2">
              <button
                type="button"
                onClick={() => toggleSection(groupIndex)}
                className="w-full px-4 py-2 flex items-center gap-2 transition-colors hover:bg-gray-50"
              >
                <ChevronDown
                  className={`h-3 w-3 text-primary-600 transition-transform duration-200 ${isExpanded ? '' : '-rotate-90'}`}
                />
                <span className="text-xs font-semibold uppercase tracking-wide text-primary-600">
                  {group.title}
                </span>
              </button>

              {isExpanded && (
                <ul className="mt-1">
                  {group.items.map((item) => {
                    const IconComponent = item.icon;
                    const isActive = activeTab === item.label;
                    return (
                      <li key={item.slug}>
                        <button
                          type="button"
                          onClick={() => onTabChange(item.label)}
                          className={`w-full px-4 py-2 pl-9 flex items-center gap-2 text-sm transition-colors ${
                            isActive
                              ? 'text-primary-600 bg-primary-50 border-l-2 border-primary-500'
                              : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900 border-l-2 border-transparent'
                          }`}
                        >
                          <IconComponent className="h-4 w-4 shrink-0" />
                          {item.label}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
};

export default SettingsSidebar;
