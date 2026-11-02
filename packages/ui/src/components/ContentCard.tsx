'use client';

import React, { useState, useEffect, useRef, useContext } from 'react';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { Button } from './Button';
import styles from '../editor/TicketDetails.module.css';
import { useTranslation } from '../lib/i18n/client';
import { useReportBoardSlotEmpty, useBentoBoardSlot, BentoShelfChip } from './bento/BentoTile';

export type ContentCardVariant = 'default' | 'bento';

/**
 * Lets a container (e.g. the ticket "Grid" bento layout) restyle every
 * ContentCard in its subtree to match the compact bento tiles, without
 * threading a `variant` prop through intermediate/injected components.
 */
const ContentCardVariantContext = React.createContext<ContentCardVariant>('default');

export function ContentCardVariantProvider({
  variant,
  children,
}: {
  variant: ContentCardVariant;
  children: React.ReactNode;
}) {
  return (
    <ContentCardVariantContext.Provider value={variant}>{children}</ContentCardVariantContext.Provider>
  );
}

/**
 * Read the surrounding card variant. Lets hand-rolled card panels (that don't
 * use ContentCard) adapt to the bento layout the same way ContentCard does.
 */
export function useContentCardVariant(): ContentCardVariant {
  return useContext(ContentCardVariantContext);
}

/**
 * Lets a host append actions to an injected ContentCard it does not own (e.g.
 * the ticket Grid adds "Receive equipment" under the injected Assets card).
 * Consumed by the nearest ContentCard only; nested cards see no footer.
 */
const ContentCardFooterContext = React.createContext<React.ReactNode>(null);

export function ContentCardFooter({ footer, children }: { footer: React.ReactNode; children: React.ReactNode }) {
  return <ContentCardFooterContext.Provider value={footer}>{children}</ContentCardFooterContext.Provider>;
}

interface ContentCardProps {
  id?: string;
  children: React.ReactNode;
  className?: string;
  /** Enable collapsible behavior. Requires `title`. */
  collapsible?: boolean;
  /** Initial expanded state (default: true). Only used when collapsible is true. */
  defaultExpanded?: boolean;
  /** Card title shown in the collapsible header. */
  title?: string;
  /** Icon element rendered before the title. */
  headerIcon?: React.ReactNode;
  /** Badge count shown next to the title when collapsed. */
  count?: number;
  /** Render an "Add" button in the header row. */
  addButton?: {
    id: string;
    label?: string;
    onClick: () => void;
  };
  /**
   * Visual variant. Defaults to the surrounding
   * ContentCardVariantProvider (or 'default'). 'bento' matches the compact
   * tile styling used in the ticket Grid layout.
   */
  variant?: ContentCardVariant;
}

const BENTO_SHELL = 'rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] card-elevated p-4 space-y-3 min-w-0';
const BENTO_HEADER = 'text-sm font-semibold text-[rgb(var(--color-text-800))] flex items-center min-w-0';

interface ContentCardHeaderProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * A consistent white card container used across the application.
 *
 * **Non-collapsible** (original API):
 * ```
 * <ContentCard>
 *   <ContentCard.Header>
 *     <Icon className="w-5 h-5 mr-2" />
 *     Card Title
 *   </ContentCard.Header>
 *   <div>Card content here</div>
 * </ContentCard>
 * ```
 *
 * **Collapsible** (collapsed when empty, expanded when has content):
 * ```
 * <ContentCard
 *   collapsible
 *   defaultExpanded={items.length > 0}
 *   title="Materials"
 *   headerIcon={<Package className="w-5 h-5" />}
 *   count={items.length}
 *   addButton={{ id: "add-btn", onClick: handleAdd }}
 * >
 *   {content}
 * </ContentCard>
 * ```
 */
export function ContentCard({
  id,
  children,
  className = '',
  collapsible = false,
  defaultExpanded = true,
  title,
  headerIcon,
  count,
  addButton,
  variant,
}: ContentCardProps) {
  const { t } = useTranslation('common');
  const contextVariant = useContext(ContentCardVariantContext);
  const hostFooter = useContext(ContentCardFooterContext);
  const footerNode = hostFooter ? (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">{hostFooter}</div>
  ) : null;
  const resolvedVariant = variant ?? contextVariant;
  const isBento = resolvedVariant === 'bento';
  const shellClass = isBento ? BENTO_SHELL : `${styles['card']} p-6 space-y-4`;
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  // A collapsible card with nothing in it counts as an empty board section.
  useReportBoardSlotEmpty(collapsible && count === 0);
  const slot = useBentoBoardSlot();

  // Auto-expand when count transitions from 0/undefined to >0 (async-loaded data)
  const prevCountRef = useRef(count);
  useEffect(() => {
    if (
      collapsible &&
      (prevCountRef.current == null || prevCountRef.current === 0) &&
      count != null &&
      count > 0
    ) {
      setIsExpanded(true);
    }
    prevCountRef.current = count;
  }, [count, collapsible]);

  if (slot?.shelved && collapsible && title) {
    return (
      <BentoShelfChip
        id={id ?? 'content-card'}
        icon={headerIcon}
        title={title}
        onOpen={() => {
          setIsExpanded(true);
          slot.open();
        }}
        action={
          addButton ? (
            <Button
              id={addButton.id}
              variant="ghost"
              size="sm"
              title={addButton.label || t('actions.add')}
              aria-label={addButton.label || t('actions.add')}
              onClick={() => {
                addButton.onClick();
                setIsExpanded(true);
                slot.open();
              }}
            >
              <Plus className="w-3.5 h-3.5" />
            </Button>
          ) : undefined
        }
      />
    );
  }

  if (collapsible && title) {
    return (
      <div id={id} className={`${shellClass} ${className}`}>
        <div className="@container grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <Button
            id={`${id || 'content-card'}-toggle`}
            variant="ghost"
            size="sm"
            className="flex items-center gap-1 p-0 h-auto min-w-0 w-full justify-start hover:bg-transparent"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? (
              <ChevronDown className={`${isBento ? 'w-3.5 h-3.5' : 'w-4 h-4'} text-gray-500 dark:text-[rgb(var(--color-text-400))] flex-shrink-0`} />
            ) : (
              <ChevronRight className={`${isBento ? 'w-3.5 h-3.5' : 'w-4 h-4'} text-gray-500 dark:text-[rgb(var(--color-text-400))] flex-shrink-0`} />
            )}
            <h2 className={isBento ? BENTO_HEADER : `${styles['panel-header']} flex items-center min-w-0`}>
              {headerIcon && (
                <span className={`mr-2 inline-flex flex-shrink-0 ${isBento ? 'text-[rgb(var(--color-primary-500))] [&_svg]:w-4 [&_svg]:h-4' : ''}`}>
                  {headerIcon}
                </span>
              )}
              <span className="truncate">{title}</span>
            </h2>
            {!isExpanded && count != null && count > 0 && (
              <span className="ml-2 text-xs bg-gray-100 dark:bg-[rgb(var(--color-border-100))] text-gray-600 dark:text-[rgb(var(--color-text-500))] rounded-full px-2 py-0.5 flex-shrink-0">
                {count}
              </span>
            )}
          </Button>
          {addButton && (
            <Button
              id={addButton.id}
              variant={isBento ? 'ghost' : 'outline'}
              size="sm"
              className="flex-shrink-0 whitespace-nowrap"
              title={addButton.label || t('actions.add')}
              aria-label={addButton.label || t('actions.add')}
              onClick={() => {
                addButton.onClick();
                if (!isExpanded) setIsExpanded(true);
              }}
            >
              <Plus className={`w-4 h-4 flex-shrink-0 ${isBento ? '' : '@sm:mr-1'}`} />
              {/* Bento tiles use the shared icon-only header add affordance. */}
              {!isBento ? <span className="hidden @sm:inline">{addButton.label || t('actions.add')}</span> : null}
            </Button>
          )}
        </div>
        <ContentCardFooterContext.Provider value={null}>{isExpanded && children}</ContentCardFooterContext.Provider>
        {footerNode}
      </div>
    );
  }

  return (
    <div id={id} className={`${shellClass} ${className}`}>
      <ContentCardFooterContext.Provider value={null}>{children}</ContentCardFooterContext.Provider>
      {footerNode}
    </div>
  );
}

/**
 * Header component for ContentCard with consistent styling.
 */
function ContentCardHeader({ children, className = '' }: ContentCardHeaderProps) {
  return (
    <h2 className={`${styles['panel-header']} flex items-center ${className}`}>
      {children}
    </h2>
  );
}

ContentCard.Header = ContentCardHeader;

export default ContentCard;
