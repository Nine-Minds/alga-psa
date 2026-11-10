'use client';

import React from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { flipWhereMode, type WhereTagSelection } from '../lib/ticketWhereFilters';

interface WhereModeButtonProps {
  /** `${id}-mode` is the button's DOM id. */
  id: string;
  selection: WhereTagSelection | null;
  onChange: (selection: WhereTagSelection) => void;
}

/**
 * The "Any of" / "None of" button of a `where` filter. Pressing it flips the operator and keeps the
 * selected ids. It only appears once something is selected.
 */
export function WhereModeButton({ id, selection, onChange }: WhereModeButtonProps) {
  const { t } = useTranslation('features/tickets');
  if (!selection) return null;
  return (
    <Button
      id={`${id}-mode`}
      variant="outline"
      size="sm"
      className="h-9 whitespace-nowrap"
      onClick={() => onChange(flipWhereMode(selection))}
    >
      {selection.mode === 'in'
        ? t('filters.tagModeAny', 'Any of')
        : t('filters.tagModeNone', 'None of')}
    </Button>
  );
}
