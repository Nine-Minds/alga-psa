'use client';

/**
 * The right-hand pane: everything about the selected element, in plain words. Validation and
 * visibility live here permanently rather than behind a menu — that is the whole point of the
 * pane, and the reason today's forms stay thin.
 */
import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Switch } from '@alga-psa/ui/components/Switch';
import CustomSelect, { type SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  FieldInputControl,
  LOOKUP_ENTITIES,
  defaultLookupScope,
  getFieldType,
  isUnsupportedFieldType,
  validateFieldValue,
  type FieldValidationRuleKey,
} from '@alga-psa/ui/form-fields';
import {
  BASIC_FORM_WIDTH_PX,
  isBasicFormWidth,
  type BasicFormField,
  type BasicFormFieldOption,
  type BasicFormSettings,
} from '../../../../lib/service-requests/formSchema';
import { FormBuilderVisibilityRules } from './FormBuilderVisibilityRules';
import { slugifyElementKey, uniqueOptionValue } from './formBuilderState';

export interface FormBuilderInspectorProps {
  element: BasicFormField | null;
  /** Elements before the selected one; only these can be read by a visibility rule. */
  precedingElements: BasicFormField[];
  settings: BasicFormSettings;
  onChange: (patch: Partial<BasicFormField>, options?: { coalesceId?: string | null }) => void;
  /** Returns false when the key was refused; the box then goes back to the key in force. */
  onRenameKey: (nextKey: string) => boolean;
  onDuplicate: () => void;
  onDelete: () => void;
  onSettingsChange: (patch: Partial<BasicFormSettings>, options?: { coalesceId?: string | null }) => void;
  /** Shows form-level settings instead of the element, from the toolbar's gear. */
  showFormSettings: boolean;
  /**
   * The element is also governed by a rule the builder could not adopt, which keeps being
   * evaluated from the form-behavior config. Shown so the author is not surprised by it.
   */
  hasRuleOutsideBuilder?: boolean;
}

const NUMERIC_RULES: FieldValidationRuleKey[] = [
  'minLength',
  'maxLength',
  'min',
  'max',
  'minSelected',
  'maxSelected',
];

/**
 * The stored shape of a default answer, by type: a boolean for a checkbox, a list for a
 * multi-select, a string otherwise. A blank answer clears the default rather than storing an
 * empty one, so the form simply opens with nothing filled in.
 */
function toStoredDefault(
  element: BasicFormField,
  next: unknown
): BasicFormField['defaultValue'] {
  if (element.type === 'checkbox') {
    return next === true;
  }
  if (element.type === 'multi-select') {
    const list = Array.isArray(next)
      ? next.filter((entry): entry is string => typeof entry === 'string')
      : [];
    return list.length > 0 ? list : undefined;
  }
  const text = typeof next === 'string' ? next : next === null || next === undefined ? '' : String(next);
  return text.length > 0 ? text : undefined;
}

/** What the control should show for the element's stored default. */
function defaultValueForControl(element: BasicFormField): unknown {
  if (element.type === 'checkbox') return element.defaultValue === true;
  if (element.type === 'multi-select') {
    return Array.isArray(element.defaultValue) ? element.defaultValue : [];
  }
  return typeof element.defaultValue === 'string' ? element.defaultValue : '';
}

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
  onChange,
  onRenameKey,
  onDuplicate,
  onDelete,
  onSettingsChange,
  showFormSettings,
  hasRuleOutsideBuilder,
}: FormBuilderInspectorProps): React.ReactElement {
  const { t } = useTranslation('msp/service-requests');
  const [keyDraft, setKeyDraft] = React.useState(element?.key ?? '');

  React.useEffect(() => {
    setKeyDraft(element?.key ?? '');
  }, [element?.key]);

  // A refused key must not stay in the box pretending to be the element's: the builder says
  // why, and the box goes back to the key that is actually in force.
  const elementKey = element?.key ?? '';
  // The raw draft goes out, not a slug: slugging first turns a cleared box into `field`, and
  // the builder could then never tell an empty key from a deliberate one.
  const commitKeyDraft = () => {
    setKeyDraft(onRenameKey(keyDraft) ? slugifyElementKey(keyDraft) : elementKey);
  };

  if (showFormSettings || !element) {
    return (
      <div id="service-request-form-builder-inspector-body" className="pb-6">
        <InspectorGroup
          title={t('formBuilder.inspector.formSettings.title')}
          description={t('formBuilder.inspector.formSettings.description')}
        >
          {/* Each choice names the measure it renders at, so "how wide is the form?" has an
              answer in the control itself rather than in the stylesheet. */}
          <CustomSelect
            id="service-request-form-settings-width"
            label={t('formBuilder.inspector.formSettings.width')}
            value={settings.layout?.width ?? 'boxed'}
            options={[
              {
                value: 'narrow',
                label: `${t('formBuilder.inspector.formSettings.widthNarrow')} · ${BASIC_FORM_WIDTH_PX.narrow} px`,
              },
              {
                value: 'boxed',
                label: `${t('formBuilder.inspector.formSettings.widthBoxed')} · ${BASIC_FORM_WIDTH_PX.boxed} px`,
              },
              {
                value: 'wide',
                label: `${t('formBuilder.inspector.formSettings.widthWide')} · ${BASIC_FORM_WIDTH_PX.wide} px`,
              },
              { value: 'full', label: t('formBuilder.inspector.formSettings.widthFull') },
            ]}
            onValueChange={(value) =>
              onSettingsChange({
                layout: { width: isBasicFormWidth(value) ? value : 'boxed' },
              })
            }
          />
          <Input
            id="service-request-form-settings-submit-label"
            label={t('formBuilder.inspector.formSettings.submitLabel')}
            containerClassName="mb-0"
            value={settings.submitLabel ?? ''}
            placeholder={t('formBuilder.inspector.formSettings.submitLabelPlaceholder')}
            onChange={(event) =>
              onSettingsChange({ submitLabel: event.target.value }, { coalesceId: 'settings.submitLabel' })
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
                { coalesceId: 'settings.successMessage' }
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

  const setValidation = (patch: Record<string, unknown>, coalesceId?: string) => {
    const next = { ...validation, ...patch };
    for (const [ruleKey, ruleValue] of Object.entries(next)) {
      if (ruleValue === '' || ruleValue === null || ruleValue === undefined) {
        delete (next as Record<string, unknown>)[ruleKey];
      }
    }
    onChange({ validation: Object.keys(next).length > 0 ? next : undefined }, { coalesceId });
  };

  // A default has to be an answer the requester could have given: it must satisfy this field's
  // own rules, and for a choice field it must be one of its options.
  const defaultIssue =
    element.defaultValue === undefined || element.defaultValue === null
      ? null
      : validateFieldValue({
          type: element.type,
          value: element.defaultValue,
          validation: element.validation,
        });
  const optionValues = new Set((element.options ?? []).map((option) => option.value));
  const defaultChoices = Array.isArray(element.defaultValue)
    ? element.defaultValue
    : typeof element.defaultValue === 'string' && element.defaultValue
      ? [element.defaultValue]
      : [];
  const defaultIsUnknownChoice =
    !!definition?.supportsOptions && defaultChoices.some((choice) => !optionValues.has(choice));
  const defaultIssueMessage = defaultIsUnknownChoice
    ? t('formBuilder.inspector.defaultNotAnOption')
    : defaultIssue
      ? t('formBuilder.inspector.defaultFailsRules')
      : null;

  const updateOption = (index: number, patch: Partial<BasicFormFieldOption>) => {
    const options = (element.options ?? []).map((option, optionIndex) =>
      optionIndex === index ? { ...option, ...patch } : option
    );
    onChange({ options }, { coalesceId: `options.${element.key}.${index}` });
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
            onChange({ label: event.target.value }, { coalesceId: `label.${element.key}` })
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
              onChange({ helpText: event.target.value || null }, { coalesceId: `help.${element.key}` })
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
            onBlur={() => commitKeyDraft()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitKeyDraft();
              }
            }}
          />
        ) : null}
      </InspectorGroup>

      {isUnsupportedFieldType(element.type) ? (
        <p id="service-request-form-builder-unsupported-type" role="note" className="text-sm text-destructive">
          {t('formBuilder.inspector.unsupportedType', { type: String(element.type) })}
        </p>
      ) : null}

      {element.lookup ? (
        <InspectorGroup
          title={t('formBuilder.inspector.lookup.title')}
          description={t('formBuilder.inspector.lookup.help')}
        >
          <CustomSelect
            id="service-request-form-builder-lookup-entity"
            label={t('formBuilder.inspector.lookup.entity')}
            value={element.lookup.entity}
            options={LOOKUP_ENTITIES.map((entity) => ({
              value: entity,
              label: t(`formBuilder.inspector.lookup.entities.${entity}`),
            }))}
            // The scope is derived from the entity, never chosen: a contact is only ever
            // offered from the requester's own client.
            onValueChange={(value) => {
              const entity = value as (typeof LOOKUP_ENTITIES)[number];
              onChange({ lookup: { entity, scope: defaultLookupScope(entity) } });
            }}
          />
          <div className="space-y-0.5">
            <p className="text-sm font-medium text-[rgb(var(--color-text-700))]">
              {t('formBuilder.inspector.lookup.scope')}
            </p>
            <p id="service-request-form-builder-lookup-scope" className="text-sm text-[rgb(var(--color-text-600))]">
              {t(`formBuilder.inspector.lookup.scopes.${element.lookup.scope}`, {
                defaultValue: String(element.lookup.scope),
              })}
            </p>
          </div>
        </InspectorGroup>
      ) : null}

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
                  { coalesceId: `placeholder.${element.key}` }
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
              // Unique against what is there, not derived from the count: after a delete the
              // count repeats a value that is still in use, and publish then refuses the form.
              const value = uniqueOptionValue(existing);
              onChange({
                options: [
                  ...existing,
                  {
                    label: t('formBuilder.inspector.newChoice', { index: existing.length + 1 }),
                    value,
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

      {definition?.supportsDefaultValue ? (
        <InspectorGroup
          title={t('formBuilder.inspector.startWithThisAnswer')}
          description={t('formBuilder.inspector.startWithThisAnswerHelp')}
        >
          <FieldInputControl
            id="service-request-form-builder-default"
            type={element.type}
            value={defaultValueForControl(element)}
            options={element.options}
            placeholder={element.placeholder}
            label={element.label}
            labels={{
              selectPlaceholder: t('formBuilder.inspector.noDefaultAnswer'),
              datePlaceholder: t('formBuilder.inspector.noDefaultAnswer'),
            }}
            // Typing a default is one edit, not one per keystroke, exactly as the label and
            // the validation rules behave.
            onChange={(next) =>
              onChange(
                { defaultValue: toStoredDefault(element, next) },
                { coalesceId: `default.${element.key}` }
              )
            }
          />
          {defaultIssueMessage ? (
            <p
              id="service-request-form-builder-default-warning"
              className="text-xs text-[rgb(var(--color-status-error))]"
            >
              {defaultIssueMessage}
            </p>
          ) : null}
          {element.defaultValue !== undefined && element.defaultValue !== null ? (
            <Button
              id="service-request-form-builder-default-clear"
              variant="outline"
              size="sm"
              onClick={() => onChange({ defaultValue: undefined })}
            >
              {t('formBuilder.inspector.clearDefaultAnswer')}
            </Button>
          ) : null}
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

      <InspectorGroup
        title={t('formBuilder.inspector.onlyShowWhen')}
        description={t(
          element.type === 'section'
            ? 'formBuilder.inspector.onlyShowWhenSectionHelp'
            : 'formBuilder.inspector.onlyShowWhenHelp'
        )}
      >
        <FormBuilderVisibilityRules
          precedingElements={precedingElements}
          rules={element.visibleWhen ?? []}
          onChange={(rules) => onChange({ visibleWhen: rules.length > 0 ? rules : undefined })}
        />
        {hasRuleOutsideBuilder ? (
          <p
            id="service-request-form-builder-legacy-rule-note"
            className="text-xs text-[rgb(var(--color-text-600))]"
          >
            {t('formBuilder.inspector.legacyRuleOutsideBuilder')}
          </p>
        ) : null}
      </InspectorGroup>
    </div>
  );
}
