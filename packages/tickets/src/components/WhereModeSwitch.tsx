'use client';

import React from 'react';
import ViewSwitcher from '@alga-psa/ui/components/ViewSwitcher';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { WhereTagMode, WhereTagSelection } from '../lib/ticketWhereFilters';

interface WhereModeSwitchProps {
  /** `${id}-mode-in` / `${id}-mode-not_in` are the two buttons' DOM ids. */
  id: string;
  selection: WhereTagSelection | null;
  onChange: (selection: WhereTagSelection) => void;
  className?: string;
}

/**
 * The "Any of" / "None of" switch of a `where` filter. It lives inside the filter's popover, below
 * the ticked values, so the toolbar shows one plain picker per filter and exclusion is one step
 * further in for the people who need it. Switching keeps the selected ids. Nothing renders until
 * something is selected.
 */
export function WhereModeSwitch({ id, selection, onChange, className }: WhereModeSwitchProps) {
  const { t } = useTranslation('features/tickets');
  if (!selection) return null;
  const label = t('filters.matchMode', 'Match');
  return (
    <div className={`flex items-center gap-2 ${className ?? ''}`}>
      <span className="text-xs text-[rgb(var(--color-text-500))]">{label}</span>
      <ViewSwitcher<WhereTagMode>
        size="sm"
        aria-label={label}
        currentView={selection.mode}
        onChange={(mode) => {
          if (mode !== selection.mode) onChange({ mode, ids: selection.ids });
        }}
        options={[
          { value: 'in', id: `${id}-mode-in`, label: t('filters.tagModeAny', 'Any of') },
          { value: 'not_in', id: `${id}-mode-not_in`, label: t('filters.tagModeNone', 'None of') },
        ]}
      />
    </div>
  );
}

/** Trigger text for a selection: unchanged for "Any of", marked for "None of". */
export function useWhereSelectionLabel() {
  const { t } = useTranslation('features/tickets');
  return (selection: WhereTagSelection | null, label: string): string =>
    selection?.mode === 'not_in' ? t('filters.excludingLabel', { label, defaultValue: 'Excluding {{label}}' }) : label;
}
