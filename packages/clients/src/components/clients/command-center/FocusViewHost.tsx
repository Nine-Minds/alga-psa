'use client';

import React from 'react';
import Drawer from '@alga-psa/ui/components/Drawer';
import type { TabContent } from '@alga-psa/ui/components/CustomTabs';

interface FocusViewHostProps {
  idPrefix: string;
  tabs: TabContent[];
  activeTabId: string | null;
  onClose: () => void;
}

/**
 * Full-height slide-over hosting a legacy client tab's content unchanged (D2).
 * One focus view at a time; the tab registry entry supplies both title and body.
 */
export default function FocusViewHost({ idPrefix, tabs, activeTabId, onClose }: FocusViewHostProps) {
  const activeTab = activeTabId ? tabs.find((tab) => tab.id === activeTabId) ?? null : null;

  return (
    <Drawer
      id={`${idPrefix}-focus-drawer`}
      isOpen={!!activeTab}
      onClose={onClose}
      width="92vw"
      hideCloseButton
    >
      {activeTab && (
        <div className="flex flex-col h-full min-w-0">
          <div className="flex items-center justify-between pb-3 mb-4 border-b border-gray-200">
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
          <div className="flex-1 overflow-y-auto min-w-0 pr-1">
            {activeTab.content}
          </div>
        </div>
      )}
    </Drawer>
  );
}
