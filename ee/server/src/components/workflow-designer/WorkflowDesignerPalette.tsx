import React from 'react';
import { Search } from 'lucide-react';
import type { DroppableProvidedProps } from '@hello-pangea/dnd';
import { CollapseToggleButton } from '@alga-psa/ui/components/CollapseToggleButton';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import styles from './WorkflowDesignerPalette.module.css';
import { PaletteLayoutContext } from './PaletteItemWithTooltip';

export type WorkflowDesignerPaletteItem = {
  id: string;
  label: string;
  description: string;
};

type WorkflowDesignerPaletteProps<TItem extends WorkflowDesignerPaletteItem> = {
  visible: boolean;
  style?: React.CSSProperties;
  layout?: 'floating' | 'stacked';
  className?: string;
  search: string;
  onSearchChange: (value: string) => void;
  registryError: boolean;
  draggingFromPalette: boolean;
  groupedPaletteItems: Record<string, TItem[]>;
  renderItem: (item: TItem, category: string, itemIndex: number) => React.ReactNode;
  scrollContainerRef?: React.Ref<HTMLDivElement>;
  scrollContainerProps?: DroppableProvidedProps;
  scrollContainerFooter?: React.ReactNode;
  /** Names where a clicked palette item will be added. */
  insertionHint?: React.ReactNode;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  expandedWidth?: number;
  collapsedWidth?: number;
};

export function WorkflowDesignerPalette<TItem extends WorkflowDesignerPaletteItem>({
  visible,
  style,
  layout = 'floating',
  className,
  search,
  onSearchChange,
  registryError,
  draggingFromPalette,
  groupedPaletteItems,
  renderItem,
  scrollContainerRef,
  scrollContainerProps,
  scrollContainerFooter,
  insertionHint,
  isCollapsed = false,
  onToggleCollapse,
  expandedWidth = 280,
  collapsedWidth = 32,
}: WorkflowDesignerPaletteProps<TItem>): React.ReactElement {
  const { t } = useTranslation('msp/workflows');
  let paletteIndex = 0;
  // While searching, results are a ranked list with full names instead of a tile grid.
  const itemLayout: 'grid' | 'list' = search.trim() ? 'list' : 'grid';

  const outerWidth = isCollapsed ? collapsedWidth : expandedWidth;
  const isStacked = layout === 'stacked';
  const containerStyle: React.CSSProperties | undefined = visible
    ? isStacked
      ? style
      : {
          ...(style || {}),
          width: outerWidth,
          minWidth: outerWidth,
          maxWidth: outerWidth,
        }
    : undefined;

  const cardSizingStyle: React.CSSProperties = isCollapsed
    ? {}
    : isStacked
      ? {
          width: '100%',
          minWidth: 0,
          maxWidth: 'none',
        }
      : {
          width: expandedWidth,
          minWidth: expandedWidth,
          maxWidth: expandedWidth,
        };

  return (
    <aside
      className={`pointer-events-auto flex flex-col max-h-[calc(100vh-220px)] min-h-0 z-40 ${styles.container} ${isStacked ? styles.stackedContainer : ''} ${className ?? ''} ${visible ? '' : 'hidden'}`}
      style={containerStyle}
    >
      {onToggleCollapse ? (
        <CollapseToggleButton
          id="workflow-designer-palette-toggle"
          isCollapsed={isCollapsed}
          collapsedLabel={t('designer.palette.showPalette', { defaultValue: 'Show palette' })}
          expandedLabel={t('designer.palette.hidePalette', { defaultValue: 'Hide palette' })}
          expandDirection="right"
          className={styles.paletteToggle}
          onClick={onToggleCollapse}
        />
      ) : null}

      <div className={styles.clipper}>
      <div
        className={`${styles.card} ${isCollapsed ? styles.cardHidden : styles.cardVisible} bg-white/95 dark:bg-[rgb(var(--color-card))]/95 backdrop-blur`}
        style={cardSizingStyle}
        inert={isCollapsed}
      >
        <div className="p-3 border-b">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              id="workflow-designer-search"
              type="text"
              placeholder={t('designer.palette.searchPlaceholder', { defaultValue: 'Search' })}
              value={search}
              disabled={registryError}
              onChange={(event) => onSearchChange(event.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>
        </div>
        {insertionHint && !draggingFromPalette ? (
          <div
            id="workflow-designer-palette-insertion-hint"
            className="px-3 py-1.5 border-b text-xs text-[rgb(var(--color-text-600))]"
            role="status"
            aria-live="polite"
          >
            {insertionHint}
          </div>
        ) : null}
        {draggingFromPalette ? (
          <div className="px-3 py-1.5 bg-primary-50 border-b text-xs text-primary-700">
            {t('designer.palette.dragHint', { defaultValue: 'Drop on pipeline to add' })}
          </div>
        ) : null}
        <div
          id="workflow-designer-palette-scroll"
          ref={scrollContainerRef}
          {...scrollContainerProps}
          className={`${styles.scrollArea} flex-1 min-h-0 overflow-y-auto pl-3 pr-2 py-3 space-y-4`}
          style={{ scrollbarGutter: 'stable' }}
        >
          <PaletteLayoutContext.Provider value={itemLayout}>
          {search.trim() && Object.keys(groupedPaletteItems).length === 0 ? (
            <div id="workflow-designer-palette-no-matches" className="space-y-2 px-1 py-2 text-xs text-[rgb(var(--color-text-600))]" role="status">
              <p className="font-medium text-[rgb(var(--color-text-800))]">
                {t('designer.palette.noMatches.title', { defaultValue: 'No matches for “{{query}}”', query: search.trim() })}
              </p>
              <ul className="list-disc space-y-1 pl-4">
                <li>{t('designer.palette.noMatches.tipWords', { defaultValue: 'Try a shorter or different word, such as “ticket”, “email”, or “wait”.' })}</li>
                <li>{t('designer.palette.noMatches.tipVerb', { defaultValue: 'Search by what the step does: create, find, update, notify.' })}</li>
                <li>{t('designer.palette.noMatches.tipBrowse', { defaultValue: 'Clear the search to browse every category.' })}</li>
              </ul>
              <button
                id="workflow-designer-palette-clear-search"
                type="button"
                className="text-primary-600 hover:underline dark:text-primary-300"
                onClick={() => onSearchChange('')}
              >
                {t('designer.palette.noMatches.clear', { defaultValue: 'Clear search' })}
              </button>
            </div>
          ) : null}
          {Object.entries(groupedPaletteItems).map(([category, items]) => (
            <div key={category}>
              <div className="text-[10px] font-semibold uppercase text-gray-400 tracking-wider mb-2">
                {t(`designer.palette.categories.${category}`, { defaultValue: category })}
              </div>
              <div
                className={itemLayout === 'list'
                  ? styles.itemList
                  : `${styles.itemGrid} ${isStacked ? styles.itemGridStacked : styles.itemGridFloating}`}
              >
                {items.map((item) => {
                  const currentPaletteIndex = paletteIndex;
                  paletteIndex += 1;
                  return renderItem(item, category, currentPaletteIndex);
                })}
              </div>
            </div>
          ))}
          </PaletteLayoutContext.Provider>
          {scrollContainerFooter}
        </div>
      </div>
      </div>
    </aside>
  );
}
