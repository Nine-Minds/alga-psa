import React from 'react';
import { cn } from '../lib/utils';
import { Button } from './Button';

export interface ViewSwitcherOption<T extends string> {
  value: T;
  label: string;
  icon?: React.ComponentType<{ size?: number | string; className?: string }>;
  disabled?: boolean;
  id?: string;
}

interface ViewSwitcherProps<T extends string> {
  currentView: T;
  onChange: (view: T) => void;
  options: ViewSwitcherOption<T>[];
  className?: string;
  /** `sm` is the compact variant for inline use inside a record body. */
  size?: 'default' | 'sm';
  'aria-label'?: string;
}

const ViewSwitcher = <T extends string>({
  currentView,
  onChange,
  options,
  className,
  size = 'default',
  'aria-label': ariaLabel,
}: ViewSwitcherProps<T>) => {
  const isCompact = size === 'sm';
  return (
    <div
      className={cn(
        'flex items-center border border-[rgb(var(--color-border-200))] rounded-md overflow-hidden',
        isCompact ? 'h-7' : 'h-9',
        className
      )}
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((option) => {
        const isActive = currentView === option.value;
        const IconComponent = option.icon;
        return (
          <Button
            key={option.value}
            id={option.id ?? `${option.value}-view-btn`}
            // Inline (sm) switchers sit inside record bodies, so they stay quiet:
            // a filled primary there competes with the screen's real primary action.
            variant={isActive ? (isCompact ? 'soft' : 'default') : (isCompact ? 'ghost' : 'outline')}
            size={isCompact ? 'xs' : 'sm'}
            onClick={() => onChange(option.value)}
            className="rounded-none border-0 h-full"
            aria-pressed={isActive}
            disabled={option.disabled}
          >
            {IconComponent && (
              <IconComponent className={isCompact ? 'h-3.5 w-3.5 mr-1' : 'h-4 w-4 mr-2'} />
            )}
            {option.label}
          </Button>
        );
      })}
    </div>
  );
};

export default ViewSwitcher;