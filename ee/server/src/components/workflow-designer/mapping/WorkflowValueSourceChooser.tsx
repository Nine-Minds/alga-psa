'use client';

import React, { useMemo } from 'react';

import type { SelectOption as SearchableSelectOption } from '@alga-psa/ui/components/SearchableSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

import { rankSourcesForTarget, type AutoMappingSource, type AutoMappingTarget, type RankedSource } from './autoMappingSuggestions';
import { WorkflowFieldPicker, stripOptionDecorations, type WorkflowPickableField } from './WorkflowFieldPicker';
import { humanizeWorkflowRecordKind, takesAnArticle } from '../workflowFieldNames';

export const CHOOSER_FIXED_VALUE = '__workflow-value-source:fixed';
export const CHOOSER_EXPRESSION_VALUE = '__workflow-value-source:expression';

export type WorkflowValueSourceMode = 'fixed' | 'reference' | 'expression';

const humanizeKind = humanizeWorkflowRecordKind;

/**
 * The one control that says where an input's value comes from, and so which editor shows below it:
 * - a field from the trigger or an earlier step (best fits first under "Suggested", then grouped by
 *   source): the input reads that field;
 * - "Choose a specific …" / "Type text…" / "Enter a fixed value…": the picker, text or value editor;
 * - "Write an expression…": the expression editor.
 * Closed, it shows the current source compactly ("Find Ticket › Board", "Specific board", "Text").
 */
export const WorkflowValueSourceChooser: React.FC<{
  idPrefix: string;
  target: AutoMappingTarget;
  fields: WorkflowPickableField[];
  mode: WorkflowValueSourceMode;
  /** Path of the current reference, if the value is a field reference. */
  selectedPath: string | null;
  isPlainText: boolean;
  onChooseField: (path: string, expression: string) => void;
  onChooseMode: (mode: Exclude<WorkflowValueSourceMode, 'reference'>) => void;
  disabled?: boolean;
}> = ({ idPrefix, target, fields, mode, selectedPath, isPlainText, onChooseField, onChooseMode, disabled }) => {
  const { t } = useTranslation('msp/workflows');
  const pickerKind = target.editor?.picker?.resource ?? target.picker?.kind;

  const ranked = useMemo(
    () => rankSourcesForTarget(target, fields.map((field): AutoMappingSource => ({ path: field.path, type: field.type, kind: field.kind }))),
    [fields, target]
  );
  const rankByPath = useMemo(() => new Map(ranked.map((entry) => [entry.source.path, entry])), [ranked]);
  const fieldByPath = useMemo(() => new Map(fields.map((field) => [field.path, field])), [fields]);

  // Fitting fields, best first. A current reference that isn't among them (a list item, or a field
  // that no longer fits) is still listed so the control can show it.
  const rankedFields = useMemo<WorkflowPickableField[]>(() => {
    const list = ranked.map((entry) => fieldByPath.get(entry.source.path)!).filter(Boolean);
    if (mode === 'reference' && selectedPath && !rankByPath.has(selectedPath)) {
      list.unshift(fieldByPath.get(selectedPath) ?? {
        path: selectedPath,
        label: stripOptionDecorations(selectedPath),
        sourceName: '',
      });
    }
    return list;
  }, [fieldByPath, mode, rankByPath, ranked, selectedPath]);

  const suggestedGroup = t('valueSourceChooser.groupSuggested', { defaultValue: 'Suggested' });
  const groupOf = useMemo(
    () => (field: WorkflowPickableField) => {
      const tier = rankByPath.get(field.path)?.tier;
      return tier !== undefined && tier <= 1 ? suggestedGroup : field.sourceName || undefined;
    },
    [rankByPath, suggestedGroup]
  );
  const secondaryOf = useMemo(() => {
    const tierHint = (tier: RankedSource['tier'] | undefined): string | undefined => {
      switch (tier) {
        case 0:
          return t('valueSourceChooser.tierSameName', { defaultValue: 'Same name' });
        case 1:
          // "Also a contact": the field holds the same kind of record this input asks for.
          return pickerKind
            ? takesAnArticle(humanizeKind(pickerKind))
              ? t('valueSourceChooser.tierSameKindAn', { defaultValue: 'Also an {{kind}}', kind: humanizeKind(pickerKind) })
              : t('valueSourceChooser.tierSameKindA', { defaultValue: 'Also a {{kind}}', kind: humanizeKind(pickerKind) })
            : t('valueSourceChooser.tierSameKind', { defaultValue: 'The same kind of record' });
        case 4:
          return t('valueSourceChooser.tierActor', { defaultValue: 'Who did it, not the record itself' });
        default:
          return undefined;
      }
    };
    return (field: WorkflowPickableField) => {
      const tier = rankByPath.get(field.path)?.tier;
      const hint = tierHint(tier);
      // In "Suggested" the step name isn't the heading, so say where the field comes from.
      const origin = tier !== undefined && tier <= 1 && field.sourceName ? `${field.sourceName} · ` : '';
      return `${origin}${field.path}${hint ? ` · ${hint}` : ''}`;
    };
  }, [pickerKind, rankByPath, t]);

  const leadingOptions = useMemo<SearchableSelectOption[]>(() => [{
    value: CHOOSER_FIXED_VALUE,
    label: pickerKind
      ? t('valueSourceChooser.chooseSpecific', { defaultValue: 'Choose a specific {{entity}}…', entity: humanizeKind(pickerKind) })
      : isPlainText
        ? t('valueSourceChooser.typeText', { defaultValue: 'Type text (insert fields as you go)…' })
        : t('valueSourceChooser.enterValue', { defaultValue: 'Enter a fixed value…' }),
    triggerLabel: pickerKind
      ? t('valueSourceChooser.currentSpecific', { defaultValue: 'A specific {{entity}}', entity: humanizeKind(pickerKind) })
      : isPlainText
        ? t('valueSourceChooser.currentText', { defaultValue: 'Text' })
        : t('valueSourceChooser.currentFixed', { defaultValue: 'Fixed value' }),
  }], [isPlainText, pickerKind, t]);
  const trailingOptions = useMemo<SearchableSelectOption[]>(() => [{
    value: CHOOSER_EXPRESSION_VALUE,
    label: t('valueSourceChooser.writeExpression', { defaultValue: 'Write an expression…' }),
    triggerLabel: t('valueSourceChooser.currentExpression', { defaultValue: 'Expression' }),
  }], [t]);

  const value = mode === 'fixed'
    ? CHOOSER_FIXED_VALUE
    : mode === 'expression'
      ? CHOOSER_EXPRESSION_VALUE
      : selectedPath ?? '';

  return (
    <div className="flex items-center gap-2" id={`${idPrefix}-value-source-row`}>
      <span className="shrink-0 text-xs text-[rgb(var(--color-text-500))]">
        {t('valueSourceChooser.label', { defaultValue: 'Value from' })}
      </span>
      <div className="min-w-0 flex-1">
        <WorkflowFieldPicker
          id={`${idPrefix}-value-source`}
          fields={rankedFields}
          value={value}
          onChange={(next) => {
            if (next === CHOOSER_FIXED_VALUE) {
              onChooseMode('fixed');
              return;
            }
            if (next === CHOOSER_EXPRESSION_VALUE) {
              onChooseMode('expression');
              return;
            }
            const expression = rankByPath.get(next)?.expression;
            if (expression) onChooseField(next, expression);
          }}
          leadingOptions={leadingOptions}
          trailingOptions={trailingOptions}
          groupOf={groupOf}
          secondaryOf={secondaryOf}
          preserveOrder
          placeholder={t('valueSourceChooser.placeholder', { defaultValue: 'Choose a field from earlier steps or the trigger' })}
          emptyMessage={t('valueSourceChooser.noMatches', { defaultValue: 'No fitting fields. Choose a fixed value or write an expression.' })}
          disabled={disabled}
          size="sm"
        />
      </div>
    </div>
  );
};

export default WorkflowValueSourceChooser;
