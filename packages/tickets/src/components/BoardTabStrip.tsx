'use client';

import React from 'react';
import CustomTabs, { type TabContent } from '@alga-psa/ui/components/CustomTabs';
import type { BoardTabDescriptor } from '../lib/boardTabs';

interface BoardTabStripProps {
  id?: string;
  tabs: BoardTabDescriptor[];
  /** Active tab id (see boardTabId()). */
  value: string;
  onChange: (tabId: string) => void;
}

/**
 * Board tab strip for the ticket list.
 *
 * Uses CustomTabs purely as chrome: every tab's content is empty and the ticket
 * list renders *below* the strip. Hanging the list off Tabs.Content would remount
 * it on every tab change (Radix unmounts inactive content), throwing away table
 * state and flashing an empty list between the click and the refetch.
 */
export const BoardTabStrip: React.FC<BoardTabStripProps> = ({
  id = 'board-tab-strip',
  tabs,
  value,
  onChange,
}) => {
  const customTabs = React.useMemo<TabContent[]>(
    () =>
      tabs.map(tab => ({
        id: tab.id,
        label: (
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            <span className={tab.isInactive ? 'italic' : undefined}>{tab.label}</span>
            {tab.openTicketCount !== null && (
              <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[rgb(var(--color-border-100))] px-1.5 text-[11px] font-semibold text-[rgb(var(--color-text-600))]">
                {tab.openTicketCount}
              </span>
            )}
          </span>
        ),
        content: null,
      })),
    [tabs]
  );

  return (
    <CustomTabs
      idPrefix={id}
      tabs={customTabs}
      value={value}
      onTabChange={onChange}
      tabStyles={{
        // Many boards must stay reachable, so the strip scrolls horizontally
        // instead of wrapping into a tall block above the list.
        list: 'overflow-x-auto overflow-y-hidden',
        trigger: 'shrink-0 text-sm',
        content: 'hidden',
      }}
    />
  );
};

export default BoardTabStrip;
