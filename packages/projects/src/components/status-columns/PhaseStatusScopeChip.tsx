'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Columns3 } from 'lucide-react';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';

export interface PhaseStatusScopeChipProps {
  /** Phase-scoped status column count; 0 means the phase inherits project defaults. */
  customStatusCount?: number | null;
  /** Extra classes appended to the chip's own styling. */
  className?: string;
  id?: string;
}

/**
 * Always-visible marker for whether a phase inherits the project default status
 * columns or has forked onto its own set. Without it the only way to tell is to
 * open every phase's Configure dialog.
 */
export function PhaseStatusScopeChip({
  customStatusCount,
  className,
  id,
}: PhaseStatusScopeChipProps): React.ReactElement | null {
  const { t } = useTranslation('features/projects');

  if (customStatusCount === undefined || customStatusCount === null) {
    return null;
  }

  const isCustom = customStatusCount > 0;
  const label = isCustom
    ? t('phases.statusColumnsCustom', { count: customStatusCount })
    : t('phases.statusColumnsProjectDefaults');

  // min-w-0/max-w-full plus a truncating label keep the chip from forcing its
  // row wider than the container — in the 250px phase panel an unshrinkable
  // chip crushed the phase name down to one character per line.
  const chipClassName = `inline-flex min-w-0 max-w-full items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${
    isCustom
      ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300'
      : 'bg-gray-100 text-gray-600 dark:bg-[rgb(var(--color-border-100))] dark:text-gray-300'
  }`;

  return (
    <Tooltip content={`${t('phases.statusColumns')}: ${label}`}>
      <span
        id={id}
        className={className ? `${chipClassName} ${className}` : chipClassName}
      >
        <Columns3 className="h-3 w-3 shrink-0" />
        <span className="truncate">{label}</span>
      </span>
    </Tooltip>
  );
}

export default PhaseStatusScopeChip;
