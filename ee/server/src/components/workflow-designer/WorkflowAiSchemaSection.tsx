'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';

import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';

import {
  buildWorkflowAiSimpleSchema,
  createWorkflowAiSimpleField,
  getWorkflowAiSchemaFallbackText,
  hydrateWorkflowAiSimpleFields,
  normalizeWorkflowAiSchemaMode,
  parseWorkflowAiSchemaText,
  resolveWorkflowAiSchemaFromConfig,
  validateWorkflowAiSchema,
  type WorkflowAiSchemaMode,
  type WorkflowAiSimpleArrayItemType,
  type WorkflowAiSimpleField,
  type WorkflowAiSimpleFieldType,
  type WorkflowJsonSchema,
} from '@alga-psa/workflows/authoring';
import { useWorkflowAiSchemaTypeOptions } from '@alga-psa/workflows/hooks/useWorkflowEnumOptions';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { TFunction } from 'i18next';

type WorkflowAiSchemaSectionProps = {
  stepId: string;
  config?: Record<string, unknown>;
  disabled?: boolean;
  onChange: (patch: {
    aiOutputSchemaMode: WorkflowAiSchemaMode;
    aiOutputSchema?: WorkflowJsonSchema;
    aiOutputSchemaText?: string;
  }) => void;
};

type DerivedSectionState = {
  mode: WorkflowAiSchemaMode;
  fields: WorkflowAiSimpleField[];
  advancedText: string;
  validationErrors: string[];
  fallbackMessage: string | null;
};

const getHydrationError = (
  t: TFunction,
  hydrated: ReturnType<typeof hydrateWorkflowAiSimpleFields>
): string =>
  'reason' in hydrated
    ? hydrated.reason
    : t('aiSchemaSection.simpleModeUnsupported', {
        defaultValue: 'This schema cannot be represented in simple mode.',
      });

const cloneFields = (fields: WorkflowAiSimpleField[]): WorkflowAiSimpleField[] =>
  JSON.parse(JSON.stringify(fields)) as WorkflowAiSimpleField[];

const hasUnnamedSimpleField = (fields: WorkflowAiSimpleField[]): boolean =>
  fields.some((field) => {
    if (!field.name.trim()) {
      return true;
    }

    return field.children ? hasUnnamedSimpleField(field.children) : false;
  });

const hasMatchingPersistedSimpleSchema = (
  localFields: WorkflowAiSimpleField[],
  persistedFields: WorkflowAiSimpleField[]
): boolean =>
  JSON.stringify(buildWorkflowAiSimpleSchema(localFields)) ===
  JSON.stringify(buildWorkflowAiSimpleSchema(persistedFields));

const areEquivalentSimpleFields = (
  leftFields: WorkflowAiSimpleField[],
  rightFields: WorkflowAiSimpleField[]
): boolean => {
  if (leftFields.length !== rightFields.length) {
    return false;
  }

  return leftFields.every((leftField, index) => {
    const rightField = rightFields[index];
    if (!rightField) {
      return false;
    }

    if (
      leftField.name !== rightField.name ||
      leftField.type !== rightField.type ||
      leftField.description !== rightField.description ||
      Boolean(leftField.required) !== Boolean(rightField.required) ||
      leftField.arrayItemType !== rightField.arrayItemType
    ) {
      return false;
    }

    return areEquivalentSimpleFields(leftField.children ?? [], rightField.children ?? []);
  });
};

const updateFieldInTree = (
  fields: WorkflowAiSimpleField[],
  fieldId: string,
  updater: (field: WorkflowAiSimpleField) => WorkflowAiSimpleField
): WorkflowAiSimpleField[] =>
  fields.map((field) => {
    if (field.id === fieldId) {
      return updater(field);
    }

    if (field.children?.length) {
      return {
        ...field,
        children: updateFieldInTree(field.children, fieldId, updater),
      };
    }

    return field;
  });

const removeFieldFromTree = (fields: WorkflowAiSimpleField[], fieldId: string): WorkflowAiSimpleField[] =>
  fields
    .filter((field) => field.id !== fieldId)
    .map((field) => ({
      ...field,
      children: field.children ? removeFieldFromTree(field.children, fieldId) : field.children,
    }));

const addChildFieldToTree = (
  fields: WorkflowAiSimpleField[],
  parentId: string,
  createFieldId: () => string
): WorkflowAiSimpleField[] =>
  fields.map((field) => {
    if (field.id === parentId) {
      return {
        ...field,
        type: field.type === 'array' ? 'array' : 'object',
        children: [...(field.children ?? []), createWorkflowAiSimpleField({ id: createFieldId() })],
      };
    }

    if (field.children?.length) {
      return {
        ...field,
        children: addChildFieldToTree(field.children, parentId, createFieldId),
      };
    }

    return field;
  });

const deriveSectionState = (t: TFunction, config?: Record<string, unknown>): DerivedSectionState => {
  const resolved = resolveWorkflowAiSchemaFromConfig(config);
  const storedMode = normalizeWorkflowAiSchemaMode(config?.aiOutputSchemaMode) ?? 'simple';
  const fallbackText = getWorkflowAiSchemaFallbackText(
    (config?.aiOutputSchema as WorkflowJsonSchema | undefined) ?? resolved.schema
  );
  const storedSchema = config?.aiOutputSchema as WorkflowJsonSchema | undefined;

  if (storedMode === 'simple') {
    const schemaToHydrate = storedSchema ?? resolved.schema;
    const hydrated = schemaToHydrate
      ? hydrateWorkflowAiSimpleFields(schemaToHydrate)
      : ({ ok: true as const, fields: [] } satisfies ReturnType<typeof hydrateWorkflowAiSimpleFields>);
    if (hydrated.ok) {
      return {
        mode: 'simple',
        fields: hydrated.fields,
        advancedText: fallbackText,
        validationErrors: [],
        fallbackMessage: null,
      };
    }

    const hydrationError = getHydrationError(t, hydrated);

    return {
      mode: 'advanced',
      fields: [],
      advancedText: fallbackText,
      validationErrors: resolved.errors.length > 0 ? resolved.errors : [hydrationError],
      fallbackMessage: t('aiSchemaSection.advancedFallback', {
        defaultValue: 'This saved schema uses advanced JSON Schema features, so it is shown in Advanced mode.',
      }),
    };
  }

  return {
    mode: storedMode,
    fields: [],
    advancedText: resolved.schemaText ?? fallbackText,
    validationErrors: resolved.errors,
    fallbackMessage: null,
  };
};

const FieldEditor: React.FC<{
  field: WorkflowAiSimpleField;
  stepId: string;
  depth: number;
  disabled?: boolean;
  onUpdate: (fieldId: string, updater: (field: WorkflowAiSimpleField) => WorkflowAiSimpleField) => void;
  onRemove: (fieldId: string) => void;
  onAddChild: (fieldId: string) => void;
}> = ({ field, stepId, depth, disabled, onUpdate, onRemove, onAddChild }) => {
  const { t } = useTranslation('msp/workflows');
  const workflowAiSchemaTypeOptions = useWorkflowAiSchemaTypeOptions();
  const isObject = field.type === 'object';
  const isArray = field.type === 'array';
  const canHaveChildren = isObject || (isArray && field.arrayItemType === 'object');
  const fieldTypeOptions = workflowAiSchemaTypeOptions as Array<{
    value: WorkflowAiSimpleFieldType;
    label: string;
  }>;
  const arrayItemTypeOptions = useMemo(
    () =>
      workflowAiSchemaTypeOptions.filter(
        (
          option,
        ): option is {
          value: WorkflowAiSimpleArrayItemType;
          label: string;
        } => option.value !== 'array'
      ),
    [workflowAiSchemaTypeOptions]
  );

  return (
    <div className="rounded-md border border-gray-200 bg-white p-3" style={{ marginLeft: depth > 0 ? depth * 16 : 0 }}>
      <div className="flex items-start justify-end">
        <Button
          id={`${stepId}-ai-remove-${field.id}`}
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => onRemove(field.id)}
        >
          <Trash2 className="mr-1 h-3.5 w-3.5" />
          {t('aiSchemaSection.remove', { defaultValue: 'Remove' })}
        </Button>
      </div>

      <div className="mt-2 space-y-3">
        <Input
          id={`${stepId}-ai-field-name-${field.id}`}
          label={t('aiSchemaSection.nameLabel', { defaultValue: 'Name' })}
          value={field.name}
          disabled={disabled}
          onChange={(event) => onUpdate(field.id, (current) => ({ ...current, name: event.target.value }))}
        />

        <label className="flex flex-col gap-1 text-xs font-medium text-gray-700">
          <span>{t('aiSchemaSection.answerType', { defaultValue: 'Answer type' })}</span>
          <select
            aria-label={t('aiSchemaSection.answerType', { defaultValue: 'Answer type' })}
            className="h-10 rounded-md border border-gray-300 bg-white px-3 text-sm"
            disabled={disabled}
            value={field.type}
            onChange={(event) => {
              const nextType = event.target.value as WorkflowAiSimpleFieldType;
              onUpdate(field.id, (current) => ({
                ...current,
                type: nextType,
                arrayItemType: nextType === 'array' ? current.arrayItemType ?? 'string' : undefined,
                children: nextType === 'object' ? current.children ?? [] : nextType === 'array' && current.arrayItemType === 'object' ? current.children ?? [] : undefined,
              }));
            }}
          >
            {fieldTypeOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        {isArray ? (
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-700">
            <span>{t('aiSchemaSection.arrayItems', { defaultValue: 'Array items' })}</span>
            <select
              aria-label={t('aiSchemaSection.arrayItems', { defaultValue: 'Array items' })}
              className="h-10 rounded-md border border-gray-300 bg-white px-3 text-sm"
              disabled={disabled}
              value={field.arrayItemType ?? 'string'}
              onChange={(event) => {
                const nextArrayItemType = event.target.value as WorkflowAiSimpleArrayItemType;
                onUpdate(field.id, (current) => ({
                  ...current,
                  arrayItemType: nextArrayItemType,
                  children: nextArrayItemType === 'object' ? current.children ?? [] : undefined,
                }));
              }}
            >
              {arrayItemTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        ) : (
          <label className="flex items-center gap-2 text-xs font-medium text-gray-700">
            <input
              aria-label={t('aiSchemaSection.required', { defaultValue: 'Required' })}
              type="checkbox"
              checked={Boolean(field.required)}
              disabled={disabled}
              onChange={(event) => onUpdate(field.id, (current) => ({ ...current, required: event.target.checked }))}
            />
            {t('aiSchemaSection.required', { defaultValue: 'Required' })}
          </label>
        )}
      </div>

      {isArray && (
        <label className="mt-3 flex items-center gap-2 text-xs font-medium text-gray-700">
          <input
            aria-label={t('aiSchemaSection.required', { defaultValue: 'Required' })}
            type="checkbox"
            checked={Boolean(field.required)}
            disabled={disabled}
            onChange={(event) => onUpdate(field.id, (current) => ({ ...current, required: event.target.checked }))}
          />
          {t('aiSchemaSection.required', { defaultValue: 'Required' })}
        </label>
      )}

      <div className="mt-3">
        <TextArea
          id={`${stepId}-ai-field-description-${field.id}`}
          label={t('aiSchemaSection.descriptionLabel', { defaultValue: 'Description' })}
          value={field.description ?? ''}
          disabled={disabled}
          onChange={(event) => onUpdate(field.id, (current) => ({ ...current, description: event.target.value }))}
          rows={2}
        />
      </div>

      {canHaveChildren && (
        <div className="mt-3 rounded-md bg-gray-50 p-3">
          <div className="mb-2 text-xs font-semibold text-gray-700">
            {isArray
              ? t('aiSchemaSection.objectItemFields', { defaultValue: 'Object item fields' })
              : t('aiSchemaSection.nestedFields', { defaultValue: 'Nested fields' })}
          </div>
          <div className="space-y-3">
            {(field.children ?? []).map((child) => (
              <FieldEditor
                key={child.id}
                field={child}
                stepId={stepId}
                depth={depth + 1}
                disabled={disabled}
                onUpdate={onUpdate}
                onRemove={onRemove}
                onAddChild={onAddChild}
              />
            ))}
          </div>
          <Button
            id={`${stepId}-ai-add-child-${field.id}`}
            type="button"
            variant="secondary"
            size="sm"
            className="mt-3"
            disabled={disabled}
            onClick={() => onAddChild(field.id)}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t('aiSchemaSection.addNested', { defaultValue: 'Add nested field' })}
          </Button>
        </div>
      )}
    </div>
  );
};

export const WorkflowAiSchemaSection: React.FC<WorkflowAiSchemaSectionProps> = ({
  stepId,
  config,
  disabled,
  onChange,
}) => {
  const { t } = useTranslation('msp/workflows');
  const derivedState = useMemo(() => deriveSectionState(t, config), [config, t]);
  const fieldCounterRef = useRef(0);
  const makeFieldId = () => {
    fieldCounterRef.current += 1;
    return `${stepId}_ai_field_${fieldCounterRef.current}`;
  };

  const [mode, setMode] = useState<WorkflowAiSchemaMode>(derivedState.mode);
  const [simpleFields, setSimpleFields] = useState<WorkflowAiSimpleField[]>(derivedState.fields);
  const [advancedText, setAdvancedText] = useState<string>(derivedState.advancedText);
  const [validationErrors, setValidationErrors] = useState<string[]>(derivedState.validationErrors);
  const [fallbackMessage, setFallbackMessage] = useState<string | null>(derivedState.fallbackMessage);

  useEffect(() => {
    setMode(derivedState.mode);
    setSimpleFields((currentFields) => {
      if (
        derivedState.mode === 'simple' &&
        areEquivalentSimpleFields(currentFields, derivedState.fields)
      ) {
        return currentFields;
      }

      if (
        derivedState.mode === 'simple' &&
        hasUnnamedSimpleField(currentFields) &&
        hasMatchingPersistedSimpleSchema(currentFields, derivedState.fields)
      ) {
        return currentFields;
      }

      return cloneFields(derivedState.fields);
    });
    setAdvancedText(derivedState.advancedText);
    setValidationErrors(derivedState.validationErrors);
    setFallbackMessage(derivedState.fallbackMessage);
  }, [derivedState]);

  useEffect(() => {
    if (normalizeWorkflowAiSchemaMode(config?.aiOutputSchemaMode)) {
      return;
    }

    const emptySchema = buildWorkflowAiSimpleSchema([]);
    onChange({
      aiOutputSchemaMode: 'simple',
      aiOutputSchema: emptySchema,
      aiOutputSchemaText: undefined,
    });
  }, [config?.aiOutputSchemaMode, onChange]);

  const emitSimpleMode = (nextFields: WorkflowAiSimpleField[]) => {
    const nextSchema = buildWorkflowAiSimpleSchema(nextFields);
    setMode('simple');
    setSimpleFields(nextFields);
    setAdvancedText(getWorkflowAiSchemaFallbackText(nextSchema));
    setValidationErrors([]);
    setFallbackMessage(null);
    onChange({
      aiOutputSchemaMode: 'simple',
      aiOutputSchema: nextSchema,
      aiOutputSchemaText: undefined,
    });
  };

  const emitAdvancedMode = (nextText: string) => {
    const parsed = parseWorkflowAiSchemaText(nextText);
    const errors = parsed.schema ? validateWorkflowAiSchema(parsed.schema, 'advanced') : [parsed.error ?? t('aiSchemaSection.errors.jsonRequired', { defaultValue: 'AI output schema JSON is required.' })];
    setMode('advanced');
    setAdvancedText(nextText);
    setValidationErrors(errors);
    onChange({
      aiOutputSchemaMode: 'advanced',
      aiOutputSchemaText: nextText,
      aiOutputSchema: errors.length === 0 && parsed.schema ? parsed.schema : undefined,
    });
  };

  const handleModeChange = (nextMode: WorkflowAiSchemaMode) => {
    if (nextMode === 'simple') {
      const currentAdvancedSchema = parseWorkflowAiSchemaText(advancedText);
      if (currentAdvancedSchema.schema) {
        const hydrated = hydrateWorkflowAiSimpleFields(currentAdvancedSchema.schema);
        if (!hydrated.ok) {
          const hydrationError = getHydrationError(t, hydrated);
          setFallbackMessage(hydrationError);
          return;
        }
        emitSimpleMode(hydrated.fields);
        return;
      }

      emitSimpleMode(simpleFields);
      return;
    }

    const nextText = advancedText || getWorkflowAiSchemaFallbackText(buildWorkflowAiSimpleSchema(simpleFields));
    emitAdvancedMode(nextText);
  };

  return (
    <div className="space-y-3 rounded-md border border-gray-200 bg-white p-4">
      <div>
        <div className="text-sm font-semibold text-gray-800">
          {t('aiSchemaSection.heading', { defaultValue: 'AI response format' })}
        </div>
        <div className="text-xs text-gray-500">
          {t('aiSchemaSection.headingDescription', {
            defaultValue: 'Choose what the AI response should include for later steps.',
          })}
        </div>
      </div>

      <div className="flex gap-2">
        <Button
          id={`${stepId}-ai-mode-simple`}
          type="button"
          size="sm"
          variant={mode === 'simple' ? 'default' : 'secondary'}
          disabled={disabled}
          onClick={() => handleModeChange('simple')}
        >
          {t('aiSchemaSection.modeSimple', { defaultValue: 'Simple' })}
        </Button>
        <Button
          id={`${stepId}-ai-mode-advanced`}
          type="button"
          size="sm"
          variant={mode === 'advanced' ? 'default' : 'secondary'}
          disabled={disabled}
          onClick={() => handleModeChange('advanced')}
        >
          {t('aiSchemaSection.modeAdvanced', { defaultValue: 'Advanced' })}
        </Button>
      </div>

      {fallbackMessage && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          {fallbackMessage}
        </div>
      )}

      {mode === 'simple' ? (
        <div className="space-y-3">
          <div className="space-y-3">
            {simpleFields.map((field) => (
              <FieldEditor
                key={field.id}
                field={field}
                stepId={stepId}
                depth={0}
                disabled={disabled}
                onUpdate={(fieldId, updater) => {
                  const nextFields = updateFieldInTree(simpleFields, fieldId, updater);
                  emitSimpleMode(nextFields);
                }}
                onRemove={(fieldId) => {
                  const nextFields = removeFieldFromTree(simpleFields, fieldId);
                  emitSimpleMode(nextFields);
                }}
                onAddChild={(fieldId) => {
                  const nextFields = addChildFieldToTree(simpleFields, fieldId, makeFieldId);
                  emitSimpleMode(nextFields);
                }}
              />
            ))}
          </div>

          <Button
            id={`${stepId}-ai-add-field`}
            type="button"
            variant="secondary"
            size="sm"
            disabled={disabled}
            onClick={() => emitSimpleMode([
              ...simpleFields,
              createWorkflowAiSimpleField({ id: makeFieldId() }),
            ])}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t('aiSchemaSection.addField', { defaultValue: 'Add field' })}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <TextArea
            id={`${stepId}-ai-schema-json`}
            label={t('aiSchemaSection.jsonSchemaLabel', { defaultValue: 'JSON Schema' })}
            value={advancedText}
            disabled={disabled}
            onChange={(event) => emitAdvancedMode(event.target.value)}
            rows={16}
            className="font-mono text-xs"
          />
          <div className="text-[11px] text-gray-500">
            {t('aiSchemaSection.advancedHelperText', {
              defaultValue: 'Advanced mode supports object-rooted schemas plus nested objects, arrays, descriptions, constraints, and additionalProperties.',
            })}
          </div>
        </div>
      )}

      {validationErrors.length > 0 && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          <div className="mb-1 flex items-center gap-1 font-semibold">
            <AlertTriangle className="h-3.5 w-3.5" />
            {t('aiSchemaSection.validationHeading', { defaultValue: 'Schema validation' })}
          </div>
          <ul className="space-y-1">
            {validationErrors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
