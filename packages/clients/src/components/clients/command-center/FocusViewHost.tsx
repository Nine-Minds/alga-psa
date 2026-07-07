'use client';

import React from 'react';
import Drawer from '@alga-psa/ui/components/Drawer';
import type { TabContent } from '@alga-psa/ui/components/CustomTabs';

type TFn = (key: string, options?: Record<string, unknown>) => string;

interface FocusViewHostProps {
  idPrefix: string;
  tabs: TabContent[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onClose: () => void;
  t: TFn;
}

/**
 * Rail groups mirror the pulse cards for scent. Tabs the map doesn't know
 * (future or EE-only) still render, under "More" — every registry entry must
 * stay reachable (this rail replaced the "All views" menu as the guarantee).
 */
const RAIL_GROUP_BY_TAB: Record<string, string> = {
  details: '',
  tickets: 'service',
  interactions: 'service',
  billing: 'money',
  'billing-dashboard': 'money',
  'tax-settings': 'money',
  equipment: 'installBase',
  assets: 'installBase',
  contacts: 'records',
  documents: 'records',
  notes: 'records',
  'additional-info': 'records',
};

const RAIL_GROUP_ORDER = ['', 'service', 'money', 'installBase', 'records', 'more'];

/**
 * Full-height slide-over hosting a legacy client tab's content unchanged (D2),
 * with a view rail listing every registry tab — open anything, see everything,
 * and switch views in place.
 */
export default function FocusViewHost({ idPrefix, tabs, activeTabId, onSelectTab, onClose, t }: FocusViewHostProps) {
  const activeTab = activeTabId ? tabs.find((tab) => tab.id === activeTabId) ?? null : null;

  const groups = RAIL_GROUP_ORDER
    .map((key) => ({
      key,
      tabs: tabs.filter((tab) => (RAIL_GROUP_BY_TAB[tab.id] ?? 'more') === key),
    }))
    .filter((group) => group.tabs.length > 0);

  const groupLabel = (key: string): string | null => {
    switch (key) {
      case 'service': return t('clientCommandCenter.rail.service', { defaultValue: 'Service' });
      case 'money': return t('clientCommandCenter.rail.money', { defaultValue: 'Money' });
      case 'installBase': return t('clientCommandCenter.rail.installBase', { defaultValue: 'Install base' });
      case 'records': return t('clientCommandCenter.rail.records', { defaultValue: 'Records' });
      case 'more': return t('clientCommandCenter.rail.more', { defaultValue: 'More' });
      default: return null;
    }
  };

  return (
    <Drawer
      id={`${idPrefix}-focus-drawer`}
      isOpen={!!activeTab}
      onClose={onClose}
      width="min(1200px, 88vw)"
      hideCloseButton
    >
      {activeTab && (
        <div className="flex flex-col h-full min-w-0">
          <div className="flex items-center justify-between pb-3 mb-0 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">{activeTab.label}</h2>
            <button
              id={`${idPrefix}-focus-close`}
              type="button"
              onClick={onClose}
              className="text-sm font-medium text-gray-500 hover:text-gray-800 px-2 py-1 rounded"
            >
              ✕
            </button>
          </div>
          <div className="flex flex-1 min-h-0 min-w-0">
            <nav
              id={`${idPrefix}-focus-rail`}
              className="w-44 shrink-0 border-r border-gray-200 overflow-y-auto py-3 pr-2"
              aria-label={t('clientCommandCenter.rail.label', { defaultValue: 'Client views' })}
            >
              {groups.map((group) => (
                <div key={group.key || 'top'} className="mb-1.5">
                  {groupLabel(group.key) && (
                    <div className="px-2.5 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                      {groupLabel(group.key)}
                    </div>
                  )}
                  {group.tabs.map((tab) => (
                    <button
                      key={tab.id}
                      id={`${idPrefix}-focus-rail-${tab.id}`}
                      type="button"
                      onClick={() => { if (tab.id !== activeTab.id) onSelectTab(tab.id); }}
                      className={`block w-full text-left rounded-lg px-2.5 py-1.5 text-[13px] truncate ${
                        tab.id === activeTab.id
                          ? 'bg-primary-50 text-primary-800 font-semibold'
                          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              ))}
            </nav>
            <div className="flex-1 overflow-y-auto min-w-0 pl-4 pr-1 pt-4">
              {activeTab.content}
            </div>
          </div>
        </div>
      )}
    </Drawer>
  );
}
