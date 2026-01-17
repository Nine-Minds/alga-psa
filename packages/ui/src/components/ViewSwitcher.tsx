import React from 'react';
import { cn } from '../lib/utils';
import { Button } from './Button';

export interface ViewSwitcherOption<T extends string> {
  value: T;
  label: string;
  icon?: React.ComponentType<{ size?: number | string; className?: string }>;
}

interface ViewSwitcherProps<T extends string> {
  currentView: T;
  onChange: (view: T) => void;
  options: ViewSwitcherOption<T>[];
  className?: string;
}

const ViewSwitcher = <T extends string>({
  currentView,
  onChange,
  options,
  className,
}: ViewSwitcherProps<T>) => {
  return (
    <div className={cn('flex items-center border rounded-md overflow-hidden h-9', className)}>
      {options.map((option) => {
        const isActive = currentView === option.value;
        const IconComponent = option.icon;
        return (
          <Button
            key={option.value}
            id={`${option.value}-view-btn`}
            variant={isActive ? 'default' : 'outline'}
            size="sm"
            onClick={() => onChange(option.value)}
            className="rounded-none border-0 h-full"
            aria-pressed={isActive}
            title={`Switch to ${option.label} view`}
          >
            {IconComponent && <IconComponent className="h-4 w-4 mr-2" />}
            {option.label}
          </Button>
        );
      })}
    </div>
  );
};

export default ViewSwitcher;