'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';

import { Button } from '@alga-psa/ui/components/Button';
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
  hydrated: ReturnType<typeof hydrateWorkflowAiSimpleFields>
): string =>
  'reason' in hydrated ? hydrated.reason : 'This schema cannot be represented in simple mode.';

const SIMPLE_FIELD_TYPE_OPTIONS: Array<{ value: WorkflowAiSimpleFieldType; label: string }> = [
  { value: 'string', label: 'String' },
  { value: 'number', label: 'Number' },
  { value: 'integer', label: 'Integer' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'object', label: 'Object' },
  { value: 'array', label: 'Array' },
];

const SIMPLE_ARRAY_ITEM_TYPE_OPTIONS: Array<{ value: WorkflowAiSimpleArrayItemType; label: string }> = [
  { value: 'string', label: 'String' },
  { value: 'number', label: 'Number' },
  { value: 'integer', label: 'Integer' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'object', label: 'Object' },
];

const cloneFields = (fields: WorkflowAiSimpleField[]): WorkflowAiSimpleField[] =>
  JSON.parse(JSON.stringify(fields)) as WorkflowAiSimpleField[];

const countFieldsInTree = (fields: WorkflowAiSimpleField[]): number =>
  fields.reduce((total, field) => total + 1 + countFieldsInTree(field.children ?? []), 0);

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

const deriveSectionState = (config?: Record<string, unknown>): DerivedSectionState => {
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

    const hydrationError = getHydrationError(hydrated);

    return {
      mode: 'advanced',
      fields: [],
      advancedText: fallbackText,
      validationErrors: resolved.errors.length > 0 ? resolved.errors : [hydrationError],
      fallbackMessage: 'This saved schema uses advanced JSON Schema features, so it is shown in Advanced mode.',
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
  const isObject = field.type === 'object';
  const isArray = field.type === 'array';
  const canHaveChildren = isObject || (isArray && field.arrayItemType === 'object');

  return (
    <div className="rounded-md border border-gray-200 bg-white p-3" style={{ marginLeft: depth > 0 ? depth * 16 : 0 }}>
      <div className="space-y-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-700">
          <span>Field name</span>
          <input
            id={`${stepId}-ai-field-name-${field.id}`}
            className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[rgb(var(--color-primary-500))] focus:border-transparent"
            value={field.name}
            disabled={disabled}
            onChange={(event) => onUpdate(field.id, (current) => ({ ...current, name: event.target.value }))}
          />
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-gray-700">
          <span>{isArray ? 'Array items' : 'Field type'}</span>
          <select
            aria-label={isArray ? 'Array items' : 'Field type'}
            className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm"
            disabled={disabled}
            value={isArray ? field.arrayItemType ?? 'string' : field.type}
            onChange={(event) => {
              if (isArray) {
                const nextArrayItemType = event.target.value as WorkflowAiSimpleArrayItemType;
                onUpdate(field.id, (current) => ({
                  ...current,
                  arrayItemType: nextArrayItemType,
                  children: nextArrayItemType === 'object' ? current.children ?? [] : undefined,
                }));
                return;
              }

              const nextType = event.target.value as WorkflowAiSimpleFieldType;
              onUpdate(field.id, (current) => ({
                ...current,
                type: nextType,
                arrayItemType: nextType === 'array' ? current.arrayItemType ?? 'string' : undefined,
                children: nextType === 'object' ? current.children ?? [] : nextType === 'array' && current.arrayItemType === 'object' ? current.children ?? [] : undefined,
              }));
            }}
          >
            {(isArray ? SIMPLE_ARRAY_ITEM_TYPE_OPTIONS : SIMPLE_FIELD_TYPE_OPTIONS).map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-xs font-medium text-gray-700">
          <input
            aria-label="Required"
            type="checkbox"
            checked={Boolean(field.required)}
            disabled={disabled}
            onChange={(event) => onUpdate(field.id, (current) => ({ ...current, required: event.target.checked }))}
          />
          Required
        </label>

        <div className="flex justify-end">
          <Button
            id={`${stepId}-ai-remove-${field.id}`}
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => onRemove(field.id)}
            aria-label="Remove field"
          >
            <Trash2 className="mr-1 h-3.5 w-3.5" />
            Remove
          </Button>
        </div>
      </div>

      <div className="mt-3">
        <TextArea
          id={`${stepId}-ai-field-description-${field.id}`}
          label="Description"
          value={field.description ?? ''}
          disabled={disabled}
          onChange={(event) => onUpdate(field.id, (current) => ({ ...current, description: event.target.value }))}
          rows={2}
        />
      </div>

      {canHaveChildren && (
        <div className="mt-3 rounded-md bg-gray-50 p-3">
          <div className="mb-2 text-xs font-semibold text-gray-700">
            {isArray ? 'Object item fields' : 'Nested fields'}
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
            Add nested field
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
  const derivedState = useMemo(() => deriveSectionState(config), [config]);
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
  const modeRef = useRef(mode);
  const simpleFieldsRef = useRef(simpleFields);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    simpleFieldsRef.current = simpleFields;
  }, [simpleFields]);

  useEffect(() => {
    if (modeRef.current === 'simple' && derivedState.mode === 'simple') {
      const persistedLocalSchema = JSON.stringify(buildWorkflowAiSimpleSchema(simpleFieldsRef.current));
      const persistedDerivedSchema = JSON.stringify(buildWorkflowAiSimpleSchema(derivedState.fields));
      const localDraftFieldCount = countFieldsInTree(simpleFieldsRef.current);
      const derivedFieldCount = countFieldsInTree(derivedState.fields);

      // Preserve locally drafted simple-mode fields that have not been serialized yet.
      if (persistedLocalSchema === persistedDerivedSchema && localDraftFieldCount > derivedFieldCount) {
        return;
      }
    }

    setMode(derivedState.mode);
    setSimpleFields(cloneFields(derivedState.fields));
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
    const errors = parsed.schema ? validateWorkflowAiSchema(parsed.schema, 'advanced') : [parsed.error ?? 'AI output schema JSON is required.'];
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
          const hydrationError = getHydrationError(hydrated);
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
        <div className="text-sm font-semibold text-gray-800">AI output schema</div>
        <div className="text-xs text-gray-500">
          Define the structured JSON saved to downstream workflow variables.
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
          Simple
        </Button>
        <Button
          id={`${stepId}-ai-mode-advanced`}
          type="button"
          size="sm"
          variant={mode === 'advanced' ? 'default' : 'secondary'}
          disabled={disabled}
          onClick={() => handleModeChange('advanced')}
        >
          Advanced
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
            Add field
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <TextArea
            id={`${stepId}-ai-schema-json`}
            label="JSON Schema"
            value={advancedText}
            disabled={disabled}
            onChange={(event) => emitAdvancedMode(event.target.value)}
            rows={16}
            className="font-mono text-xs"
          />
          <div className="text-[11px] text-gray-500">
            Advanced mode supports object-rooted schemas plus nested objects, arrays, descriptions, constraints, and additionalProperties.
          </div>
        </div>
      )}

      {validationErrors.length > 0 && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          <div className="mb-1 flex items-center gap-1 font-semibold">
            <AlertTriangle className="h-3.5 w-3.5" />
            Schema validation
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
