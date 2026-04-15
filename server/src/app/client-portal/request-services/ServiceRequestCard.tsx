import React from 'react';
import { ServiceRequestIcon } from './ServiceRequestIcon';

interface ServiceRequestCardProps {
  title: string;
  description?: string | null;
  icon?: string | null;
  categoryLabel?: string | null;
}

export function ServiceRequestCard({
  title,
  description,
  icon,
  categoryLabel,
}: ServiceRequestCardProps) {
  return (
    <div className="rounded border p-4 bg-[rgb(var(--color-background-100))]">
      <div className="mb-1 flex items-center gap-2 text-[rgb(var(--color-text-500))]">
        <ServiceRequestIcon iconName={icon} className="h-4 w-4" />
        <span className="text-xs uppercase tracking-wide">
          {categoryLabel ?? 'Service'}
        </span>
      </div>
      <div className="text-base font-semibold">{title}</div>
      <p className="mt-1 text-sm text-[rgb(var(--color-text-700))]">
        {description ?? 'No description provided'}
      </p>
    </div>
  );
}
