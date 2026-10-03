import React, { useMemo, useState } from 'react';
import { Languages } from 'lucide-react';
import { Input } from '@alga-psa/ui/components/Input';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { STANDARD_DOCUMENT_LABELS } from '../../../../lib/invoice-template-ast/standardDocumentLabels';
import type { TranslatableRef } from '../../utils/translatableText';

type Props = {
  domId: string;
  /** The label's translation while it is still the standard text; null for fixed text. */
  translation: TranslatableRef | null;
  onUseStandardLabel: (ref: TranslatableRef) => void;
  onUseFixedText: () => void;
};

// "labels.invoiceTitle" -> "Invoice title": tells apart labels whose text only differs by case.
const describeLabelKey = (i18nKey: string): string => {
  const words = i18nKey.replace(/^labels\./, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/**
 * The other half of a text input: whether the text is a standard label rendered
 * in each recipient's language, and the way to switch between that and fixed text.
 */
export const StandardLabelControl: React.FC<Props> = ({ domId, translation, onUseStandardLabel, onUseFixedText }) => {
  const { t } = useTranslation('msp/invoicing');
  const [isPicking, setIsPicking] = useState(false);
  const [query, setQuery] = useState('');

  const options = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return [...STANDARD_DOCUMENT_LABELS]
      .map((label) => ({ ...label, description: describeLabelKey(label.i18nKey) }))
      .filter(
        (label) =>
          normalized.length === 0 ||
          label.defaultValue.toLowerCase().includes(normalized) ||
          label.description.toLowerCase().includes(normalized)
      )
      .sort((left, right) => left.defaultValue.localeCompare(right.defaultValue));
  }, [query]);

  if (translation) {
    return (
      <div
        className="mt-1 flex items-center justify-between gap-2 rounded border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-900/30 px-2 py-1 text-[11px] text-sky-700 dark:text-sky-300"
        data-automation-id={`${domId}-translated`}
      >
        <span className="inline-flex items-center gap-1">
          <Languages aria-hidden className="h-3 w-3 shrink-0" />
          {t('designer.translation.translatedAs', {
            defaultValue: 'Standard label "{{name}}", translated for each recipient',
            name: describeLabelKey(translation.i18nKey),
          })}
        </span>
        <button
          type="button"
          id={`${domId}-use-fixed`}
          className="shrink-0 underline hover:no-underline"
          onClick={onUseFixedText}
        >
          {t('designer.translation.useFixedText', { defaultValue: 'Use fixed text' })}
        </button>
      </div>
    );
  }

  if (!isPicking) {
    return (
      <button
        type="button"
        id={domId}
        className="mt-1 inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 underline hover:no-underline"
        onClick={() => setIsPicking(true)}
      >
        <Languages aria-hidden className="h-3 w-3" />
        {t('designer.translation.pickStandardLabel', { defaultValue: 'Fixed text. Translate automatically…' })}
      </button>
    );
  }

  return (
    <div
      className="mt-1 space-y-1 rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-[rgb(var(--color-card))] p-1.5"
      data-automation-id={`${domId}-picker`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          setIsPicking(false);
        }
      }}
    >
      <Input
        id={`${domId}-search`}
        autoFocus
        value={query}
        placeholder={t('designer.translation.searchStandardLabels', { defaultValue: 'Search standard labels…' })}
        onChange={(event) => setQuery(event.target.value)}
        className="text-xs"
      />
      <div className="max-h-48 overflow-y-auto" role="listbox" aria-label={t('designer.translation.standardLabels', { defaultValue: 'Standard labels' })}>
        {options.length === 0 ? (
          <p className="px-1 py-1 text-[11px] text-slate-500">
            {t('designer.translation.noMatches', { defaultValue: 'No standard label matches.' })}
          </p>
        ) : (
          options.map((label) => (
            <button
              key={label.i18nKey}
              type="button"
              role="option"
              aria-selected={false}
              id={`${domId}-option-${label.i18nKey.replace(/[^a-zA-Z0-9]+/g, '-')}`}
              className="flex w-full items-baseline justify-between gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
              onClick={() => {
                setIsPicking(false);
                setQuery('');
                onUseStandardLabel(label);
              }}
            >
              <span className="font-medium text-slate-800 dark:text-slate-200">{label.defaultValue}</span>
              <span className="shrink-0 text-[10px] text-slate-400">{label.description}</span>
            </button>
          ))
        )}
      </div>
      <button
        type="button"
        id={`${domId}-cancel`}
        className="text-[11px] text-slate-500 underline hover:no-underline"
        onClick={() => setIsPicking(false)}
      >
        {t('designer.translation.cancel', { defaultValue: 'Cancel' })}
      </button>
    </div>
  );
};
