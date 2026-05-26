'use client';

import * as React from 'react';
import { Button } from './Button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from './DropdownMenu';
import { MoreHorizontal, X } from 'lucide-react';

export interface BulkActionBarAction {
  id: string;
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  destructive?: boolean;
}

export interface BulkActionBarProps {
  count: number;
  selectedLabel: string;
  actions?: BulkActionBarAction[];
  overflowActions?: BulkActionBarAction[];
  overflowLabel?: string;
  onClear?: () => void;
  clearLabel?: string;
  idPrefix?: string;
  className?: string;
}

export function BulkActionBar({
  count,
  selectedLabel,
  actions = [],
  overflowActions = [],
  overflowLabel = 'More',
  onClear,
  clearLabel = 'Clear',
  idPrefix = 'bulk-action-bar',
  className,
}: BulkActionBarProps) {
  if (count === 0) return null;

  const wrapperClass = [
    'fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3',
    'bg-white dark:bg-[rgb(var(--color-card))]',
    'border border-gray-200 dark:border-[rgb(var(--color-border-200))]',
    'rounded-lg shadow-lg px-4 py-2.5',
    className ?? '',
  ].filter(Boolean).join(' ');

  return (
    <div className={wrapperClass} data-bulk-action-bar={idPrefix}>
      <span className="text-sm font-medium text-gray-700 dark:text-[rgb(var(--color-text-200))] whitespace-nowrap">
        {selectedLabel}
      </span>
      <div className="h-5 w-px bg-gray-200 dark:bg-[rgb(var(--color-border-200))]" />
      {actions.map((action) => (
        <Button
          key={action.id}
          id={`${idPrefix}-${action.id}-button`}
          variant="outline"
          size="sm"
          onClick={action.onClick}
          disabled={action.disabled}
          title={action.title}
          className={
            action.destructive
              ? 'whitespace-nowrap text-destructive hover:text-destructive'
              : 'whitespace-nowrap'
          }
        >
          {action.icon ? <span className="mr-1.5 flex h-4 w-4 items-center">{action.icon}</span> : null}
          {action.label}
        </Button>
      ))}
      {overflowActions.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id={`${idPrefix}-more-button`}
              variant="outline"
              size="sm"
              className="whitespace-nowrap"
            >
              <MoreHorizontal className="h-4 w-4 mr-1.5" />
              {overflowLabel}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[10rem]">
            {overflowActions.map((action) => (
              <DropdownMenuItem
                key={action.id}
                id={`${idPrefix}-${action.id}-menu-item`}
                disabled={action.disabled}
                title={action.title}
                onSelect={() => {
                  if (action.disabled) return;
                  action.onClick();
                }}
                className={action.destructive ? 'text-destructive' : undefined}
              >
                {action.icon ? <span className="mr-2 flex h-4 w-4 items-center">{action.icon}</span> : null}
                {action.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {onClear && (
        <>
          <div className="h-5 w-px bg-gray-200 dark:bg-[rgb(var(--color-border-200))]" />
          <Button
            id={`${idPrefix}-clear-button`}
            variant="ghost"
            size="sm"
            onClick={onClear}
            className="whitespace-nowrap"
          >
            <X className="h-4 w-4 mr-1.5" />
            {clearLabel}
          </Button>
        </>
      )}
    </div>
  );
}

export default BulkActionBar;
