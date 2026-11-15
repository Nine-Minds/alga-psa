'use client';

/**
 * "Only show this when …", built as a sentence.
 *
 * The model is the one `WorkflowConditionBuilder` uses — pick a field, offer the operators its
 * type allows, choose the value editor by that type — so phase 3's required-when and option
 * filters extend this instead of starting again. The operators come from the shared field type
 * registry (a subset of `PredicateOperator`) and are written back through the adapter in
 * `fieldVisibilityModel.ts`: stored rules keep today's six-operator dialect, so published
 * definitions evaluate exactly as before.
 */
import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect, { type SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getFieldType } from '@alga-psa/ui/form-fields';
import type {
  VisibilityRule,
  VisibilityRuleOperator,
} from '../../../../lib/service-requests/formVisibility';
import type { BasicFormField } from '../../../../lib/service-requests/basicFormBuilder';
import {
  VISIBILITY_CONTEXT_SOURCES,
  getFieldVisibilityRules,
  getVisibilityOperatorsForType,
  getVisibilitySourceFields,
  operatorNeedsValue,
  replaceFieldVisibilityRules,
} from '../fieldVisibilityModel';

export interface FormBuilderVisibilityRulesProps {
  elementKey: string;
  /** Only elements before this one, and only answer-carrying ones, can be read. */
  precedingElements: BasicFormField[];
  config: Record<string, unknown>;
  onChange: (nextConfig: Record<string, unknown>) => void;
}

function defaultValueFor(source: BasicFormField | undefined): unknown {
  if (source?.type === 'checkbox') return true;
  if (getFieldType(source?.type)?.supportsOptions) return source?.options?.[0]?.value ?? '';
  return '';
}

export function FormBuilderVisibilityRules({
  elementKey,
  precedingElements,
  config,
  onChange,
}: FormBuilderVisibilityRulesProps): React.ReactElement {
  const { t } = useTranslation('msp/service-requests');
  const sourceFields = getVisibilitySourceFields(precedingElements);
  const rules = getFieldVisibilityRules(config, elementKey);

  const persist = (nextRules: VisibilityRule[]) => {
    onChange(replaceFieldVisibilityRules(config, elementKey, nextRules));
  };

  const findSource = (source: string) => sourceFields.find((field) => field.key === source);

  const sourceOptions = (current: string): SelectOption[] => {
    const options: SelectOption[] = [
      ...sourceFields.map((field) => ({
        value: field.key,
        label: field.label || field.key,
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

  const updateRule = (index: number, patch: Partial<VisibilityRule>) => {
    persist(rules.map((rule, ruleIndex) => (ruleIndex === index ? { ...rule, ...patch } : rule)));
  };

  if (sourceFields.length === 0 && rules.length === 0) {
    return (
      <p className="text-xs text-[rgb(var(--color-text-600))]">
        {t('formBuilder.inspector.visibilityNeedsEarlierField')}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {rules.length === 0 ? (
        <p className="text-xs text-[rgb(var(--color-text-600))]">
          {t('formBuilder.inspector.visibilityAlways')}
        </p>
      ) : null}
      {rules.map((rule, index) => {
        const source = findSource(rule.source);
        const idBase = `service-request-form-builder-visibility-${index}`;
        const operatorOptions: SelectOption[] = getVisibilityOperatorsForType(source?.type).map(
          (operator) => ({
            value: operator,
            label: t(`formBuilder.inspector.visibilityOperators.${operator}`, {
              defaultValue: t(`editor.form.visibility.operators.${operator}`),
            }),
          })
        );

        return (
          <div
            key={idBase}
            className="space-y-1.5 rounded-md border border-[rgb(var(--color-border-200))] p-2"
          >
            <div className="flex items-start gap-1.5">
              <div className="min-w-0 flex-1 space-y-1.5">
                <CustomSelect
                  id={`${idBase}-source`}
                  label={t('formBuilder.inspector.visibilityWhen')}
                  value={rule.source}
                  options={sourceOptions(rule.source)}
                  onValueChange={(value) =>
                    updateRule(index, {
                      source: value,
                      value: operatorNeedsValue(rule.operator)
                        ? defaultValueFor(findSource(value))
                        : undefined,
                    })
                  }
                />
                <CustomSelect
                  id={`${idBase}-operator`}
                  label={t('formBuilder.inspector.visibilityIs')}
                  value={rule.operator}
                  options={operatorOptions}
                  onValueChange={(value) => {
                    const operator = value as VisibilityRuleOperator;
                    updateRule(index, {
                      operator,
                      value: operatorNeedsValue(operator)
                        ? rule.value !== undefined
                          ? rule.value
                          : defaultValueFor(source)
                        : undefined,
                    });
                  }}
                />
                {operatorNeedsValue(rule.operator) ? (
                  source?.type === 'checkbox' ? (
                    <CustomSelect
                      id={`${idBase}-value`}
                      label={t('formBuilder.inspector.visibilityValue')}
                      // Real JSON booleans: `equals` is strict, so "true" would never match.
                      value={rule.value === true ? 'true' : rule.value === false ? 'false' : ''}
                      options={[
                        { value: 'true', label: t('editor.form.visibility.valueTrue') },
                        { value: 'false', label: t('editor.form.visibility.valueFalse') },
                      ]}
                      onValueChange={(value) => updateRule(index, { value: value === 'true' })}
                    />
                  ) : getFieldType(source?.type)?.supportsOptions && source?.options ? (
                    <CustomSelect
                      id={`${idBase}-value`}
                      label={t('formBuilder.inspector.visibilityValue')}
                      value={typeof rule.value === 'string' ? rule.value : ''}
                      options={source.options.map((option) => ({
                        value: option.value,
                        label: option.label || option.value,
                      }))}
                      onValueChange={(value) => updateRule(index, { value })}
                    />
                  ) : (
                    <Input
                      id={`${idBase}-value`}
                      label={t('formBuilder.inspector.visibilityValue')}
                      containerClassName="mb-0"
                      value={
                        typeof rule.value === 'string'
                          ? rule.value
                          : rule.value === undefined
                            ? ''
                            : String(rule.value)
                      }
                      onChange={(event) => updateRule(index, { value: event.target.value })}
                    />
                  )
                ) : null}
              </div>
              <Button
                id={`${idBase}-remove`}
                variant="ghost"
                size="icon"
                tooltipText={t('editor.form.visibility.removeRule')}
                onClick={() => persist(rules.filter((_rule, ruleIndex) => ruleIndex !== index))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        );
      })}
      <Button
        id="service-request-form-builder-visibility-add"
        variant="outline"
        size="sm"
        disabled={sourceFields.length === 0}
        onClick={() => {
          const first = sourceFields[0];
          persist([
            ...rules,
            {
              fieldKey: elementKey,
              source: first ? first.key : VISIBILITY_CONTEXT_SOURCES[0],
              operator: first?.type === 'checkbox' ? 'is-true' : 'equals',
              value: first?.type === 'checkbox' ? undefined : defaultValueFor(first),
            },
          ]);
        }}
      >
        <Plus className="h-4 w-4" />
        {t('formBuilder.inspector.addVisibilityRule')}
      </Button>
    </div>
  );
}
