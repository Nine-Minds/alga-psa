'use client';

import React from 'react';
import type { ITag } from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import { TagFilter } from '@alga-psa/ui/components/tags/TagFilter';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { WhereTagMode, WhereTagSelection } from '../lib/ticketWhereFilters';

export interface WhereLocationOption {
  location_id: string;
  location_name: string;
  /** Prefixed to the label when the list spans clients, so two "Head office" rows are tellable apart. */
  client_name?: string | null;
}

interface WhereLocationFilterProps {
  id: string;
  label: string;
  options: WhereLocationOption[];
  selection: WhereTagSelection | null;
  onChange: (selection: WhereTagSelection | null) => void;
}

export function locationFilterLabel(option: WhereLocationOption): string {
  return option.client_name ? `${option.client_name} · ${option.location_name}` : option.location_name;
}

/**
 * Toolbar control for a `where` location filter: pick locations, then choose "any of" / "none of".
 * Same popover-plus-mode shape as the tag control (it reuses it), so the toolbar reads as one
 * family of `where` filters. The predicate stores location ids, never names, so renaming a location
 * leaves a saved view working.
 */
export function WhereLocationFilter({ id, label, options, selection, onChange }: WhereLocationFilterProps) {
  const { t } = useTranslation('features/tickets');
  const mode: WhereTagMode = selection?.mode ?? 'in';

  // TagFilter is a checkbox popover keyed on display text, so the mapping lives here and nowhere else.
  const asTags: ITag[] = options.map((option) => ({
    tag_id: option.location_id,
    tag_text: locationFilterLabel(option),
  } as ITag));
  const idByText = new Map(asTags.map((tag) => [tag.tag_text, tag.tag_id as string]));
  const textById = new Map(asTags.map((tag) => [tag.tag_id as string, tag.tag_text]));
  const selectedTexts = (selection?.ids ?? [])
    .map((locationId) => textById.get(locationId))
    .filter((text): text is string => Boolean(text));

  const emit = (nextMode: WhereTagMode, texts: string[]) => {
    const ids = texts.map((text) => idByText.get(text)).filter((id): id is string => Boolean(id));
    onChange(ids.length > 0 ? { mode: nextMode, ids } : null);
  };

  return (
    <div id={id} className="inline-flex items-center gap-1">
      <TagFilter
        id={`${id}-locations`}
        tags={asTags}
        selectedTags={selectedTexts}
        triggerLabel={label}
        selectedLabel={`${label}: ${selectedTexts.length}`}
        onToggleTag={(text: string) =>
          emit(mode, selectedTexts.includes(text) ? selectedTexts.filter((x) => x !== text) : [...selectedTexts, text])
        }
        onClearTags={() => onChange(null)}
      />
      {selection && (
        <Button
          id={`${id}-mode`}
          variant="outline"
          size="sm"
          className="h-9 whitespace-nowrap"
          onClick={() => emit(mode === 'in' ? 'not_in' : 'in', selectedTexts)}
        >
          {mode === 'in'
            ? t('filters.tagModeAny', 'Any of')
            : t('filters.tagModeNone', 'None of')}
        </Button>
      )}
    </div>
  );
}
