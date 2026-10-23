'use client';

import React, { useCallback, useLayoutEffect, useRef } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from './Button';
import { cn } from '../lib/utils';

export interface ListDetailLayoutProps {
  /** Root element id; children get `${id}-list`, `${id}-detail` and `${id}-back`. */
  id: string;
  list: React.ReactNode;
  /** null/undefined means nothing is selected: only the list renders. */
  detail?: React.ReactNode | null;
  /** Stacked-mode Back control; callers normally pass the same handler as their Close. */
  onBack: () => void;
  /** Translated by the caller so this package stays namespace-agnostic. */
  backLabel: string;
  className?: string;
}

/**
 * List/detail layout driven by the width of its own container (not the viewport).
 *
 * - Container >= 56rem: list and detail side by side.
 * - Narrower: the detail replaces the list (the list stays mounted, hidden with
 *   display:none) and a Back button appears above the detail.
 *
 * Pure CSS; the `@[56rem]` breakpoint below is the single place it is defined.
 */
export function ListDetailLayout({ id, list, detail, onBack, backLabel, className }: ListDetailLayoutProps) {
  const hasDetail = detail !== null && detail !== undefined && detail !== false;
  const listRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const returnFocusToList = useRef(false);
  const hadDetail = useRef(false);

  // Focus handling for stacked mode only. Back is visible (offsetParent !== null)
  // exactly when the layout is stacked, so no width measurement is needed.
  useLayoutEffect(() => {
    if (hasDetail && !hadDetail.current) {
      const back = backRef.current;
      if (back && back.offsetParent !== null) {
        back.focus();
      }
    } else if (!hasDetail && hadDetail.current && returnFocusToList.current) {
      listRef.current?.focus();
    }
    if (!hasDetail) {
      returnFocusToList.current = false;
    }
    hadDetail.current = hasDetail;
  }, [hasDetail]);

  const handleBack = useCallback(() => {
    returnFocusToList.current = true;
    onBack();
  }, [onBack]);

  return (
    <div id={id} className={cn('@container h-full min-h-0 min-w-0', className)}>
      <div className="flex h-full min-h-0 gap-4">
        <div
          id={`${id}-list`}
          ref={listRef}
          tabIndex={-1}
          className={cn(
            'min-h-0 min-w-0 flex-1 flex-col outline-none',
            hasDetail ? 'hidden @[56rem]:flex' : 'flex'
          )}
        >
          {list}
        </div>
        {hasDetail && (
          <div
            id={`${id}-detail`}
            className="flex min-h-0 min-w-0 flex-1 flex-col @[56rem]:w-[clamp(22.5rem,38%,30rem)] @[56rem]:flex-none"
          >
            <Button
              id={`${id}-back`}
              ref={backRef}
              variant="ghost"
              size="sm"
              onClick={handleBack}
              className="mb-2 self-start @[56rem]:hidden"
            >
              <ArrowLeft className="h-4 w-4" />
              {backLabel}
            </Button>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">{detail}</div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ListDetailLayout;
