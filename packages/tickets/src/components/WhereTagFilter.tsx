'use client';

import React from 'react';
import type { ITag } from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import { TagFilter } from '@alga-psa/ui/components/tags/TagFilter';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { WhereTagMode, WhereTagSelection } from '../lib/ticketWhereFilters';

interface WhereTagFilterProps {
  id: string;
  label: string;
  /** Tag definitions to offer (their `tag_id` is the definition id the predicate stores). */
  definitions: ITag[];
  selection: WhereTagSelection | null;
  onChange: (selection: WhereTagSelection | null) => void;
}

/**
 * Toolbar control for a `where` tag filter: pick tags, then choose "any of" (has any) or "none of"
 * (has none). The predicate stores definition ids; the picker works on tag text, so the two are
 * mapped here.
 */
export function WhereTagFilter({ id, label, definitions, selection, onChange }: WhereTagFilterProps) {
  const { t } = useTranslation('features/tickets');
  const mode: WhereTagMode = selection?.mode ?? 'in';
  const idByText = new Map(definitions.map((d) => [d.tag_text, d.tag_id as string]));
  const textById = new Map(definitions.map((d) => [d.tag_id as string, d.tag_text]));
  const selectedTexts = (selection?.ids ?? []).map((tagId) => textById.get(tagId)).filter((x): x is string => Boolean(x));

  const emit = (nextMode: WhereTagMode, texts: string[]) => {
    const ids = texts.map((text) => idByText.get(text)).filter((x): x is string => Boolean(x));
    onChange(ids.length > 0 ? { mode: nextMode, ids } : null);
  };

  return (
    <div id={id} className="inline-flex items-center gap-1">
      <TagFilter
        id={`${id}-tags`}
        tags={definitions}
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
