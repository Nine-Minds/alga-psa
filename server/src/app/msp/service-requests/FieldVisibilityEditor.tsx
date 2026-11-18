'use client';

import React, { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect, { type SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { VisibilityRule, VisibilityRuleOperator } from '../../../lib/service-requests/formVisibility';
import {
  VISIBILITY_CONTEXT_SOURCES,
  VISIBILITY_OPERATORS,
  getFieldVisibilityRules,
  operatorNeedsValue,
  replaceFieldVisibilityRules,
} from './fieldVisibilityModel';

export interface VisibilitySourceField {
  key: string;
  type: string;
  label?: string;
  options?: Array<{ value: string; label: string }>;
}

interface FieldVisibilityEditorProps {
  fieldKey: string;
  /** Fields earlier in the form than this one; later fields are never offered as sources. */
  precedingFields: VisibilitySourceField[];
  config: Record<string, unknown>;
  onSave: (nextConfig: Record<string, unknown>) => Promise<void>;
}

function defaultValueFor(source: VisibilitySourceField | undefined): unknown {
  if (source?.type === 'checkbox') return true;
  if (source?.type === 'select') return source.options?.[0]?.value ?? '';
  return '';
}

export function FieldVisibilityEditor({
  fieldKey,
  precedingFields,
  config,
  onSave,
}: FieldVisibilityEditorProps) {
  const { t } = useTranslation('msp/service-requests');
  const [rows, setRows] = useState<VisibilityRule[]>(() => getFieldVisibilityRules(config, fieldKey));

  useEffect(() => {
    setRows(getFieldVisibilityRules(config, fieldKey));
  }, [config, fieldKey]);

  const persist = async (nextRows: VisibilityRule[]) => {
    setRows(nextRows);
    try {
      // Only this field's rules are replaced; contextDefaults and other fields' rules survive.
      await onSave(replaceFieldVisibilityRules(config, fieldKey, nextRows));
    } catch (error) {
      console.error('Failed to save field visibility rules', error);
      toast.error(t('editor.form.visibility.saveFailed'));
    }
  };

  const updateRow = (index: number, patch: Partial<VisibilityRule>, save = true) => {
    const nextRows = rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row));
    if (save) {
      void persist(nextRows);
    } else {
      setRows(nextRows);
    }
  };

  const findSource = (source: string) => precedingFields.find((field) => field.key === source);

  const buildSourceOptions = (current: string): SelectOption[] => {
    const options: SelectOption[] = [
      ...precedingFields.map((field) => ({
        value: field.key,
        label: field.label ? `${field.label} (${field.key})` : field.key,
      })),
      ...VISIBILITY_CONTEXT_SOURCES.map((source) => ({
        value: source,
        label: t(`editor.form.visibility.contextSources.${source.slice('context.'.length)}`),
      })),
    ];
    // Legacy hand-written sources (payload.x, forward references) must round-trip untouched.
    if (current && !options.some((option) => option.value === current)) {
      options.push({ value: current, label: current });
    }
    return options;
  };

  const operatorOptions: SelectOption[] = VISIBILITY_OPERATORS.map((operator) => ({
    value: operator,
    label: t(`editor.form.visibility.operators.${operator}`),
  }));

  const addRow = () => {
    const first = precedingFields[0];
    const source = first ? first.key : VISIBILITY_CONTEXT_SOURCES[0];
    const operator: VisibilityRuleOperator = 'equals';
    void persist([
      ...rows,
      { fieldKey, source, operator, value: defaultValueFor(first) },
    ]);
  };

  return (
    <div className="space-y-2 rounded border border-dashed border-[rgb(var(--color-border-200))] p-2">
      <div className="text-sm font-medium">{t('editor.form.visibility.title')}</div>
      {rows.length === 0 && (
        <div className="text-xs text-[rgb(var(--color-text-600))]">
          {t('editor.form.visibility.none')}
        </div>
      )}
      {rows.map((row, index) => {
        const source = findSource(row.source);
        const idBase = `service-request-form-visibility-${fieldKey}-${index}`;
        const legacyString =
          source?.type === 'checkbox' && operatorNeedsValue(row.operator) && typeof row.value === 'string';
        return (
          <div key={idBase} className="space-y-1">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end">
              <CustomSelect
                id={`${idBase}-source`}
                label={t('editor.form.visibility.source')}
                value={row.source}
                options={buildSourceOptions(row.source)}
                placeholder={t('editor.form.visibility.selectSource')}
                onValueChange={(value) =>
                  updateRow(index, {
                    source: value,
                    value: operatorNeedsValue(row.operator) ? defaultValueFor(findSource(value)) : undefined,
                  })
                }
              />
              <CustomSelect
                id={`${idBase}-operator`}
                label={t('editor.form.visibility.operator')}
                value={row.operator}
                options={operatorOptions}
                onValueChange={(value) => {
                  const operator = value as VisibilityRuleOperator;
                  updateRow(index, {
                    operator,
                    value: operatorNeedsValue(operator)
                      ? row.value !== undefined
                        ? row.value
                        : defaultValueFor(source)
                      : undefined,
                  });
                }}
              />
              {operatorNeedsValue(row.operator) ? (
                source?.type === 'checkbox' ? (
                  <CustomSelect
                    id={`${idBase}-value`}
                    label={t('editor.form.visibility.value')}
                    // Real JSON booleans: `equals` is strict, so "true" would never match a checkbox.
                    value={row.value === true ? 'true' : row.value === false ? 'false' : ''}
                    options={[
                      { value: 'true', label: t('editor.form.visibility.valueTrue') },
                      { value: 'false', label: t('editor.form.visibility.valueFalse') },
                    ]}
                    placeholder={t('editor.form.visibility.selectValue')}
                    onValueChange={(value) => updateRow(index, { value: value === 'true' })}
                  />
                ) : source?.type === 'select' && source.options ? (
                  <CustomSelect
                    id={`${idBase}-value`}
                    label={t('editor.form.visibility.value')}
                    value={typeof row.value === 'string' ? row.value : ''}
                    options={source.options.map((option) => ({
                      value: option.value,
                      label: option.label || option.value,
                    }))}
                    placeholder={t('editor.form.visibility.selectValue')}
                    onValueChange={(value) => updateRow(index, { value })}
                  />
                ) : (
                  <Input
                    id={`${idBase}-value`}
                    label={t('editor.form.visibility.value')}
                    containerClassName="mb-0"
                    value={typeof row.value === 'string' ? row.value : row.value === undefined ? '' : String(row.value)}
                    onChange={(event) => updateRow(index, { value: event.target.value }, false)}
                    onBlur={() => void persist(rows)}
                  />
                )
              ) : (
                <div />
              )}
              <Button
                id={`${idBase}-remove`}
                variant="ghost"
                size="icon"
                tooltipText={t('editor.form.visibility.removeRule')}
                onClick={() => void persist(rows.filter((_, rowIndex) => rowIndex !== index))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            {legacyString && (
              <div className="text-xs text-[rgb(var(--color-text-600))]">
                {t('editor.form.visibility.legacyBooleanWarning')}
              </div>
            )}
          </div>
        );
      })}
      <Button
        id={`service-request-form-visibility-add-${fieldKey}`}
        variant="outline"
        size="sm"
        onClick={addRow}
      >
        <Plus className="h-4 w-4" />
        {t('editor.form.visibility.addRule')}
      </Button>
    </div>
  );
}
