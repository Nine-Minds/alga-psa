import * as React from 'react';
import { cn } from '../lib/utils';

interface EmptyStateProps {
  /** Main heading/title */
  title: string;
  /** Description text below the title */
  description?: string;
  /** Icon to display (React node, e.g. Lucide icon) */
  icon?: React.ReactNode;
  /** Call-to-action button or other content below the description */
  action?: React.ReactNode;
  /** Additional class name */
  className?: string;
}

function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center py-12 px-4',
        className
      )}
    >
      {icon && (
        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-[rgb(var(--color-primary-50))] mb-2">
          <span className="text-[rgb(var(--color-primary-500))]">{icon}</span>
        </div>
      )}
      <h3 className="text-base font-medium text-[rgb(var(--color-text-900))]">
        {title}
      </h3>
      {description && (
        <p className="text-sm text-muted-foreground max-w-sm text-center mt-1">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export { EmptyState };
export type { EmptyStateProps };
