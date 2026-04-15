import React from 'react';
import { Search } from 'lucide-react';
import type { DroppableProvidedProps } from '@hello-pangea/dnd';

export type WorkflowDesignerPaletteItem = {
  id: string;
  label: string;
  description: string;
};

type WorkflowDesignerPaletteProps<TItem extends WorkflowDesignerPaletteItem> = {
  visible: boolean;
  style?: React.CSSProperties;
  search: string;
  onSearchChange: (value: string) => void;
  registryError: boolean;
  draggingFromPalette: boolean;
  groupedPaletteItems: Record<string, TItem[]>;
  renderItem: (item: TItem, category: string, itemIndex: number) => React.ReactNode;
  scrollContainerRef?: React.Ref<HTMLDivElement>;
  scrollContainerProps?: DroppableProvidedProps;
  scrollContainerFooter?: React.ReactNode;
};

export function WorkflowDesignerPalette<TItem extends WorkflowDesignerPaletteItem>({
  visible,
  style,
  search,
  onSearchChange,
  registryError,
  draggingFromPalette,
  groupedPaletteItems,
  renderItem,
  scrollContainerRef,
  scrollContainerProps,
  scrollContainerFooter,
}: WorkflowDesignerPaletteProps<TItem>): React.ReactElement {
  let paletteIndex = 0;

  return (
    <aside
      className={`pointer-events-auto w-56 max-h-[calc(100vh-220px)] bg-white/95 dark:bg-[rgb(var(--color-card))]/95 backdrop-blur border border-gray-200 dark:border-[rgb(var(--color-border-200))] rounded-lg shadow-lg overflow-hidden flex flex-col min-h-0 z-40 ${visible ? '' : 'hidden'}`}
      style={visible ? style : undefined}
    >
      <div className="p-3 border-b">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            id="workflow-designer-search"
            type="text"
            placeholder="Search"
            value={search}
            disabled={registryError}
            onChange={(event) => onSearchChange(event.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
          />
        </div>
      </div>
      {draggingFromPalette ? (
        <div className="px-3 py-1.5 bg-primary-50 border-b text-xs text-primary-700">
          Drop on pipeline to add
        </div>
      ) : null}
      <div
        id="workflow-designer-palette-scroll"
        ref={scrollContainerRef}
        {...scrollContainerProps}
        className="flex-1 min-h-0 overflow-y-auto pl-3 pr-5 py-3 space-y-4"
        style={{ scrollbarGutter: 'stable' }}
      >
        {Object.entries(groupedPaletteItems).map(([category, items]) => (
          <div key={category}>
            <div className="text-[10px] font-semibold uppercase text-gray-400 tracking-wider mb-2">
              {category}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {items.map((item) => {
                const currentPaletteIndex = paletteIndex;
                paletteIndex += 1;
                return renderItem(item, category, currentPaletteIndex);
              })}
            </div>
          </div>
        ))}
        {scrollContainerFooter}
      </div>
    </aside>
  );
}
