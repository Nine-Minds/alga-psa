import React from 'react';
import { ServiceRequestIcon } from './ServiceRequestIcon';

interface ServiceRequestCardProps {
  title: string;
  description?: string | null;
  icon?: string | null;
  categoryLabel?: string | null;
  fallbackCategory?: string;
  noDescription?: string;
}

export function ServiceRequestCard({
  title,
  description,
  icon,
  categoryLabel,
  fallbackCategory = 'Service',
  noDescription = 'No description provided',
}: ServiceRequestCardProps) {
  return (
    <div className="group h-full rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-4 shadow-sm transition-all hover:border-[rgb(var(--color-primary-300))] hover:shadow-md">
      <div className="mb-1 flex items-center gap-2 text-[rgb(var(--color-text-500))]">
        <ServiceRequestIcon iconName={icon} className="h-4 w-4" />
        <span className="text-xs uppercase tracking-wide">
          {categoryLabel ?? fallbackCategory}
        </span>
      </div>
      <div className="text-base font-semibold text-[rgb(var(--color-text-900))] group-hover:text-[rgb(var(--color-primary-600))]">
        {title}
      </div>
      <p className="mt-1 text-sm text-[rgb(var(--color-text-700))]">
        {description ?? noDescription}
      </p>
    </div>
  );
}
