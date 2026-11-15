'use client';

/**
 * The right-hand pane: everything about the selected element, in plain words. Validation and
 * visibility live here permanently rather than behind a menu — that is the whole point of the
 * pane, and the reason today's forms stay thin.
 */
import React from 'react';
import { GripVertical, Plus, Trash2 } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Switch } from '@alga-psa/ui/components/Switch';
import CustomSelect, { type SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getFieldType, type FieldValidationRuleKey } from '@alga-psa/ui/form-fields';
import type {
  BasicFormField,
  BasicFormFieldOption,
  BasicFormSettings,
} from '../../../../lib/service-requests/formSchema';
import { FormBuilderVisibilityRules } from './FormBuilderVisibilityRules';
import { slugifyElementKey } from './formBuilderState';

export interface FormBuilderInspectorProps {
  element: BasicFormField | null;
  /** Elements before the selected one; only these can be read by a visibility rule. */
  precedingElements: BasicFormField[];
  settings: BasicFormSettings;
  /** Present only when the advanced form-behavior provider is on. */
  formBehaviorConfig?: Record<string, unknown>;
  onChange: (patch: Partial<BasicFormField>, options?: { coalesceKey?: string | null }) => void;
  onRenameKey: (nextKey: string) => void;
  onVisibilityConfigChange: (nextConfig: Record<string, unknown>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onSettingsChange: (patch: Partial<BasicFormSettings>, options?: { coalesceKey?: string | null }) => void;
  /** Shows form-level settings instead of the element, from the toolbar's gear. */
  showFormSettings: boolean;
}

const NUMERIC_RULES: FieldValidationRuleKey[] = [
  'minLength',
  'maxLength',
  'min',
  'max',
  'minSelected',
  'maxSelected',
];

function InspectorGroup({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2 border-t border-[rgb(var(--color-border-200))] px-4 py-3 first:border-t-0">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[rgb(var(--color-text-500))]">
          {title}
        </h3>
        {description ? (
          <p className="mt-0.5 text-xs text-[rgb(var(--color-text-600))]">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export function FormBuilderInspector({
  element,
  precedingElements,
  settings,
  formBehaviorConfig,
  onChange,
  onRenameKey,
  onVisibilityConfigChange,
  onDuplicate,
  onDelete,
  onSettingsChange,
  showFormSettings,
}: FormBuilderInspectorProps): React.ReactElement {
  const { t } = useTranslation('msp/service-requests');
  const [keyDraft, setKeyDraft] = React.useState(element?.key ?? '');

  React.useEffect(() => {
    setKeyDraft(element?.key ?? '');
  }, [element?.key]);

  if (showFormSettings || !element) {
    return (
      <div id="service-request-form-builder-inspector-body" className="pb-6">
        <InspectorGroup
          title={t('formBuilder.inspector.formSettings.title')}
          description={t('formBuilder.inspector.formSettings.description')}
        >
          <CustomSelect
            id="service-request-form-settings-width"
            label={t('formBuilder.inspector.formSettings.width')}
            value={settings.layout?.width ?? 'boxed'}
            options={[
              { value: 'boxed', label: t('formBuilder.inspector.formSettings.widthBoxed') },
              { value: 'full', label: t('formBuilder.inspector.formSettings.widthFull') },
            ]}
            onValueChange={(value) =>
              onSettingsChange({ layout: { width: value === 'full' ? 'full' : 'boxed' } })
            }
          />
          <Input
            id="service-request-form-settings-submit-label"
            label={t('formBuilder.inspector.formSettings.submitLabel')}
            containerClassName="mb-0"
            value={settings.submitLabel ?? ''}
            placeholder={t('formBuilder.inspector.formSettings.submitLabelPlaceholder')}
            onChange={(event) =>
              onSettingsChange({ submitLabel: event.target.value }, { coalesceKey: 'settings.submitLabel' })
            }
          />
          <TextArea
            id="service-request-form-settings-success-message"
            label={t('formBuilder.inspector.formSettings.successMessage')}
            wrapperClassName="mb-0"
            value={settings.successMessage ?? ''}
            placeholder={t('formBuilder.inspector.formSettings.successMessagePlaceholder')}
            onChange={(event) =>
              onSettingsChange(
                { successMessage: event.target.value },
                { coalesceKey: 'settings.successMessage' }
              )
            }
          />
        </InspectorGroup>
        {!element && !showFormSettings ? (
          <p className="px-4 text-sm text-[rgb(var(--color-text-600))]">
            {t('formBuilder.inspector.nothingSelected')}
          </p>
        ) : null}
      </div>
    );
  }

  const definition = getFieldType(element.type);
  const isDisplay = definition?.kind === 'display';
  const typeLabel = t(`editor.form.types.${element.type}`, { defaultValue: element.type });
  const validation = element.validation ?? {};
  const validationRules = definition?.validationRules ?? [];

  const setValidation = (patch: Record<string, unknown>, coalesceKey?: string) => {
    const next = { ...validation, ...patch };
    for (const [ruleKey, ruleValue] of Object.entries(next)) {
      if (ruleValue === '' || ruleValue === null || ruleValue === undefined) {
        delete (next as Record<string, unknown>)[ruleKey];
      }
    }
    onChange({ validation: Object.keys(next).length > 0 ? next : undefined }, { coalesceKey });
  };

  const updateOption = (index: number, patch: Partial<BasicFormFieldOption>) => {
    const options = (element.options ?? []).map((option, optionIndex) =>
      optionIndex === index ? { ...option, ...patch } : option
    );
    onChange({ options }, { coalesceKey: `options.${element.key}.${index}` });
  };

  const toneOptions: SelectOption[] = ['info', 'warning', 'success'].map((tone) => ({
    value: tone,
    label: t(`formBuilder.inspector.calloutTones.${tone}`),
  }));

  return (
    <div id="service-request-form-builder-inspector-body" className="pb-6">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <span className="truncate text-sm font-semibold text-[rgb(var(--color-text-900))]">
          {typeLabel}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            id="service-request-form-builder-duplicate"
            variant="ghost"
            size="icon"
            tooltipText={t('formBuilder.toolbar.duplicate')}
            onClick={onDuplicate}
          >
            <Plus className="h-4 w-4" />
          </Button>
          <Button
            id="service-request-form-builder-delete"
            variant="ghost"
            size="icon"
            tooltipText={t('formBuilder.toolbar.delete')}
            onClick={onDelete}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <InspectorGroup title={t('formBuilder.inspector.basics')}>
        <Input
          id="service-request-form-builder-label"
          label={
            element.type === 'callout'
              ? t('formBuilder.inspector.calloutTitle')
              : element.type === 'section'
                ? t('formBuilder.inspector.sectionTitle')
                : t('formBuilder.inspector.label')
          }
          containerClassName="mb-0"
          value={element.label}
          onChange={(event) =>
            onChange({ label: event.target.value }, { coalesceKey: `label.${element.key}` })
          }
        />
        {definition?.supportsHelpText !== false || element.type === 'text' || element.type === 'callout' ? (
          <TextArea
            id="service-request-form-builder-help-text"
            label={
              element.type === 'text' || element.type === 'callout'
                ? t('formBuilder.inspector.bodyText')
                : t('formBuilder.inspector.helpText')
            }
            wrapperClassName="mb-0"
            value={element.helpText ?? ''}
            onChange={(event) =>
              onChange({ helpText: event.target.value || null }, { coalesceKey: `help.${element.key}` })
            }
          />
        ) : null}
        {element.type === 'callout' ? (
          <CustomSelect
            id="service-request-form-builder-callout-tone"
            label={t('formBuilder.inspector.calloutTone')}
            value={element.display?.tone ?? 'info'}
            options={toneOptions}
            onValueChange={(value) =>
              onChange({ display: { ...element.display, tone: value as 'info' | 'warning' | 'success' } })
            }
          />
        ) : null}
        {element.type === 'section' ? (
          <label className="flex items-center justify-between gap-2 text-sm text-[rgb(var(--color-text-800))]">
            <span>{t('formBuilder.inspector.sectionCollapsible')}</span>
            <Switch
              id="service-request-form-builder-section-collapsible"
              checked={element.display?.collapsible === true}
              onCheckedChange={(checked) =>
                onChange({ display: { ...element.display, collapsible: checked } })
              }
            />
          </label>
        ) : null}
        {!isDisplay ? (
          <Input
            id="service-request-form-builder-key"
            label={t('formBuilder.inspector.answerKey')}
            containerClassName="mb-0"
            value={keyDraft}
            onChange={(event) => setKeyDraft(event.target.value)}
            onBlur={() => onRenameKey(slugifyElementKey(keyDraft))}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onRenameKey(slugifyElementKey(keyDraft));
              }
            }}
          />
        ) : null}
      </InspectorGroup>

      {!isDisplay ? (
        <InspectorGroup title={t('formBuilder.inspector.asking')}>
          <label className="flex items-center justify-between gap-2 text-sm text-[rgb(var(--color-text-800))]">
            <span>{t('formBuilder.inspector.required')}</span>
            <Switch
              id="service-request-form-builder-required"
              checked={Boolean(element.required)}
              onCheckedChange={(checked) => onChange({ required: checked })}
            />
          </label>
          {definition?.supportsPlaceholder ? (
            <Input
              id="service-request-form-builder-placeholder"
              label={t('formBuilder.inspector.placeholder')}
              containerClassName="mb-0"
              value={element.placeholder ?? ''}
              onChange={(event) =>
                onChange(
                  { placeholder: event.target.value || null },
                  { coalesceKey: `placeholder.${element.key}` }
                )
              }
            />
          ) : null}
          <CustomSelect
            id="service-request-form-builder-width"
            label={t('formBuilder.inspector.width')}
            value={element.layout?.width === 'half' ? 'half' : 'full'}
            options={[
              { value: 'full', label: t('formBuilder.inspector.widthFull') },
              { value: 'half', label: t('formBuilder.inspector.widthHalf') },
            ]}
            onValueChange={(value) =>
              onChange({ layout: value === 'half' ? { width: 'half' } : undefined })
            }
          />
        </InspectorGroup>
      ) : null}

      {definition?.supportsOptions ? (
        <InspectorGroup
          title={t('formBuilder.inspector.choices')}
          description={t('formBuilder.inspector.choicesHelp')}
        >
          <ul className="space-y-1.5">
            {(element.options ?? []).map((option, index) => (
              <li key={`${option.value}-${index}`} className="flex items-center gap-1.5">
                <GripVertical
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 text-[rgb(var(--color-text-400))]"
                />
                <Input
                  id={`service-request-form-builder-option-label-${index}`}
                  containerClassName="mb-0 flex-1"
                  aria-label={t('formBuilder.inspector.choiceLabel', { index: index + 1 })}
                  value={option.label}
                  onChange={(event) => updateOption(index, { label: event.target.value })}
                />
                <Button
                  id={`service-request-form-builder-option-remove-${index}`}
                  variant="ghost"
                  size="icon"
                  tooltipText={t('formBuilder.inspector.removeChoice')}
                  onClick={() =>
                    onChange({
                      options: (element.options ?? []).filter(
                        (_option, optionIndex) => optionIndex !== index
                      ),
                    })
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
          <Button
            id="service-request-form-builder-option-add"
            variant="outline"
            size="sm"
            onClick={() => {
              const existing = element.options ?? [];
              const nextIndex = existing.length + 1;
              onChange({
                options: [
                  ...existing,
                  {
                    label: t('formBuilder.inspector.newChoice', { index: nextIndex }),
                    value: `option_${nextIndex}`,
                  },
                ],
              });
            }}
          >
            <Plus className="h-4 w-4" />
            {t('formBuilder.inspector.addChoice')}
          </Button>
        </InspectorGroup>
      ) : null}

      {validationRules.length > 0 ? (
        <InspectorGroup
          title={t('formBuilder.inspector.checkTheAnswer')}
          description={t(`formBuilder.inspector.checkHelp.${element.type}`, {
            defaultValue: t('formBuilder.inspector.checkHelp.default'),
          })}
        >
          {validationRules.map((rule) =>
            NUMERIC_RULES.includes(rule) ? (
              <Input
                key={rule}
                id={`service-request-form-builder-rule-${rule}`}
                type="number"
                label={t(`formBuilder.inspector.rules.${element.type}.${rule}`, {
                  defaultValue: t(`formBuilder.inspector.rules.default.${rule}`),
                })}
                containerClassName="mb-0"
                value={
                  validation[rule] === undefined || validation[rule] === null
                    ? ''
                    : String(validation[rule])
                }
                onChange={(event) =>
                  setValidation(
                    { [rule]: event.target.value === '' ? undefined : Number(event.target.value) },
                    `rule.${element.key}.${rule}`
                  )
                }
              />
            ) : (
              <Input
                key={rule}
                id={`service-request-form-builder-rule-${rule}`}
                type={rule === 'minDate' || rule === 'maxDate' ? 'date' : 'text'}
                label={t(`formBuilder.inspector.rules.${element.type}.${rule}`, {
                  defaultValue: t(`formBuilder.inspector.rules.default.${rule}`),
                })}
                containerClassName="mb-0"
                value={typeof validation[rule] === 'string' ? (validation[rule] as string) : ''}
                onChange={(event) =>
                  setValidation({ [rule]: event.target.value }, `rule.${element.key}.${rule}`)
                }
              />
            )
          )}
          <Input
            id="service-request-form-builder-rule-message"
            label={t('formBuilder.inspector.customMessage')}
            containerClassName="mb-0"
            placeholder={t('formBuilder.inspector.customMessagePlaceholder')}
            value={validation.message ?? ''}
            onChange={(event) =>
              setValidation({ message: event.target.value }, `rule.${element.key}.message`)
            }
          />
        </InspectorGroup>
      ) : null}

      {formBehaviorConfig ? (
        <InspectorGroup
          title={t('formBuilder.inspector.onlyShowWhen')}
          description={t('formBuilder.inspector.onlyShowWhenHelp')}
        >
          <FormBuilderVisibilityRules
            elementKey={element.key}
            precedingElements={precedingElements}
            config={formBehaviorConfig}
            onChange={onVisibilityConfigChange}
          />
        </InspectorGroup>
      ) : null}
    </div>
  );
}
