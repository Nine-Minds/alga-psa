'use client';

import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { Button } from './Button';
import styles from '../editor/TicketDetails.module.css';

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
}

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
}: ContentCardProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

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

  if (collapsible && title) {
    return (
      <div id={id} className={`${styles['card']} p-6 space-y-4 ${className}`}>
        <div className="@container grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <Button
            id={`${id || 'content-card'}-toggle`}
            variant="ghost"
            size="sm"
            className="flex items-center gap-1 p-0 h-auto min-w-0 w-full justify-start hover:bg-transparent"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? (
              <ChevronDown className="w-4 h-4 text-gray-500 flex-shrink-0" />
            ) : (
              <ChevronRight className="w-4 h-4 text-gray-500 flex-shrink-0" />
            )}
            <h2 className={`${styles['panel-header']} flex items-center min-w-0`}>
              {headerIcon && <span className="mr-2 inline-flex flex-shrink-0">{headerIcon}</span>}
              <span className="truncate">{title}</span>
            </h2>
            {!isExpanded && count != null && count > 0 && (
              <span className="ml-2 text-xs bg-gray-100 text-gray-600 rounded-full px-2 py-0.5 flex-shrink-0">
                {count}
              </span>
            )}
          </Button>
          {addButton && (
            <Button
              id={addButton.id}
              variant="outline"
              size="sm"
              className="flex-shrink-0 whitespace-nowrap"
              title={addButton.label || 'Add'}
              aria-label={addButton.label || 'Add'}
              onClick={() => {
                addButton.onClick();
                if (!isExpanded) setIsExpanded(true);
              }}
            >
              <Plus className="w-4 h-4 @sm:mr-1 flex-shrink-0" />
              <span className="hidden @sm:inline">{addButton.label || 'Add'}</span>
            </Button>
          )}
        </div>
        {isExpanded && children}
      </div>
    );
  }

  return (
    <div id={id} className={`${styles['card']} p-6 space-y-4 ${className}`}>
      {children}
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
