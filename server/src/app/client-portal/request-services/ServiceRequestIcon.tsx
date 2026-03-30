import React from 'react';
import * as LucideIcons from 'lucide-react';
import { FileText, type LucideIcon } from 'lucide-react';

interface ServiceRequestIconProps {
  iconName?: string | null;
  className?: string;
}

function toLucideExportName(iconName: string): string {
  return iconName
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join('');
}

export function ServiceRequestIcon({
  iconName,
  className = 'h-4 w-4',
}: ServiceRequestIconProps) {
  const iconExports = LucideIcons as unknown as Record<string, LucideIcon>;
  const normalizedName =
    typeof iconName === 'string' && iconName.trim().length > 0
      ? toLucideExportName(iconName.trim())
      : '';
  const IconComponent =
    (normalizedName && iconExports[normalizedName]) ||
    FileText;

  return <IconComponent className={className} aria-hidden={true} />;
}
