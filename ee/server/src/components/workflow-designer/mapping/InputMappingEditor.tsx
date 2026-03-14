'use client';

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { ChevronRight, ChevronDown, Plus, Trash2, AlertTriangle, Wand2, Sparkles, RotateCcw } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Card } from '@alga-psa/ui/components/Card';
import { Badge } from '@alga-psa/ui/components/Badge';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import type { InputMapping, MappingValue, Expr } from '@alga-psa/workflows/runtime';
import {
  type ExpressionContext,
  type JsonSchema
} from '../expression-editor';
import type { MappingPositionsHandlers } from './useMappingPositions';
import { useMappingKeyboard } from './useMappingKeyboard';
import { SourceDataTree, type DataTreeContext } from './SourceDataTree';
import {
  TypeCompatibility,
  getTypeCompatibility,
  getCompatibilityClasses,
  getCompatibilityLabel,
} from './typeCompatibility';
import { WorkflowActionInputFieldInfo } from '../WorkflowActionInputFieldInfo';
import { getWorkflowActionInputTypeHint, WorkflowActionInputTypeHint } from '../WorkflowActionInputTypeHint';
import { WorkflowActionInputFixedPicker } from '../WorkflowActionInputFixedPicker';
import {
  WorkflowActionInputSourceMode,
  createWorkflowActionInputValueForMode,
  deriveWorkflowActionInputSourceMode,
  getDefaultWorkflowActionInputSourceMode,
  isWorkflowActionInputLegacyValue,
  transitionWorkflowActionInputMode,
  type WorkflowActionInputSourceModeValue,
} from '../WorkflowActionInputSourceMode';

/**
 * Infer type from a field path
 * Uses heuristics based on common field naming patterns
 */
function inferTypeFromPath(path: string): string | undefined {
  if (!path) return undefined;

  const parts = path.split('.');
  const fieldName = parts[parts.length - 1].toLowerCase();

  // Remove array index notation
  const cleanName = fieldName.replace(/\[\]$/, '').replace(/\[\d+\]$/, '');

  // Common patterns for specific types
  if (cleanName.endsWith('id') || cleanName.endsWith('_id') || cleanName === 'id') return 'string';
  if (cleanName.endsWith('email') || cleanName === 'email') return 'string';
  if (cleanName.endsWith('name') || cleanName === 'name') return 'string';
  if (cleanName.endsWith('title') || cleanName === 'title') return 'string';
  if (cleanName.endsWith('description') || cleanName === 'description') return 'string';
  if (cleanName.endsWith('message') || cleanName === 'message') return 'string';
  if (cleanName.endsWith('url') || cleanName === 'url') return 'string';
  if (cleanName.endsWith('path') || cleanName === 'path') return 'string';
  if (cleanName.endsWith('text') || cleanName === 'text') return 'string';
  if (cleanName.endsWith('content') || cleanName === 'content') return 'string';
  if (cleanName.endsWith('subject') || cleanName === 'subject') return 'string';

  if (cleanName.endsWith('count') || cleanName.endsWith('_count')) return 'number';
  if (cleanName.endsWith('amount') || cleanName.endsWith('_amount')) return 'number';
  if (cleanName.endsWith('total') || cleanName.endsWith('_total')) return 'number';
  if (cleanName.endsWith('number') && !cleanName.includes('phone')) return 'number';
  if (cleanName === 'index' || cleanName === '$index') return 'number';
  if (cleanName.endsWith('port')) return 'number';
  if (cleanName.endsWith('version')) return 'number';

  if (cleanName.startsWith('is_') || cleanName.startsWith('has_')) return 'boolean';
  if (cleanName.endsWith('enabled') || cleanName.endsWith('_enabled')) return 'boolean';
  if (cleanName.endsWith('active') || cleanName.endsWith('_active')) return 'boolean';
  if (cleanName.endsWith('flag') || cleanName.endsWith('_flag')) return 'boolean';
  if (cleanName === 'required' || cleanName === 'optional') return 'boolean';
  if (cleanName === 'success' || cleanName === 'valid') return 'boolean';

  if (cleanName.endsWith('date') || cleanName.endsWith('_at')) return 'date';
  if (cleanName.endsWith('time') || cleanName.endsWith('timestamp')) return 'date';
  if (cleanName === 'created' || cleanName === 'updated') return 'date';

  if (cleanName.endsWith('list') || cleanName.endsWith('items')) return 'array';
  if (cleanName.endsWith('[]')) return 'array';
  if (cleanName === 'attachments' || cleanName === 'files') return 'array';
  if (cleanName === 'tags' || cleanName === 'labels') return 'array';

  // Root paths
  if (path === 'payload' || path === 'vars' || path === 'meta' || path === 'error') return 'object';

  // State is typically a string
  if (path === 'meta.state') return 'string';
  if (path === 'meta.traceId') return 'string';
  if (path === 'error.message' || path === 'error.name' || path === 'error.stack') return 'string';

  return undefined;
}

function extractPrimaryPath(expression: string | undefined): string | null {
  if (!expression) return null;
  const trimmed = expression.trim();
  if (!trimmed) return null;
  const token = trimmed.split(/[\s+\-*/%()[\]{},<>=!&|?:]+/)[0];
  return token || null;
}

type ReferenceSourceScope = 'payload' | 'vars' | 'meta' | 'error' | 'forEach';

type ReferenceFieldOption = {
  value: string;
  label: string;
  type?: string;
};

type ReferenceStepOption = {
  value: string;
  label: string;
  fields: ReferenceFieldOption[];
};

type ReferenceSourceModel = {
  payload: ReferenceFieldOption[];
  vars: ReferenceStepOption[];
  meta: ReferenceFieldOption[];
  error: ReferenceFieldOption[];
  forEach: ReferenceFieldOption[];
};

const toRelativeLabel = (path: string, prefix: string, fallback: string): string => {
  if (path === prefix) return fallback;
  if (path.startsWith(`${prefix}.`)) return path.slice(prefix.length + 1);
  return path;
};

const pushUniqueReferenceField = (
  target: ReferenceFieldOption[],
  option: ReferenceFieldOption
) => {
  if (target.some((existing) => existing.value === option.value)) return;
  target.push(option);
};

const flattenReferenceFields = (
  fields: DataTreeContext['payload'],
  labelPrefix: string
): ReferenceFieldOption[] => {
  const flattened: ReferenceFieldOption[] = [];
  const visit = (field: DataTreeContext['payload'][number]) => {
    pushUniqueReferenceField(flattened, {
      value: field.path,
      label: toRelativeLabel(field.path, labelPrefix, field.name),
      type: field.type,
    });
    field.children?.forEach((child) => visit(child));
  };
  fields.forEach((field) => visit(field));
  return flattened;
};

const resolveReferenceSchema = (schema: JsonSchema, root?: JsonSchema): JsonSchema => {
  if (schema.$ref && root?.definitions) {
    const refKey = schema.$ref.replace('#/definitions/', '');
    const resolved = root.definitions?.[refKey];
    if (resolved) return resolveReferenceSchema(resolved, root);
  }

  if (schema.anyOf?.length) {
    const nonNullVariant = schema.anyOf.find(
      (variant) =>
        variant.type !== 'null' &&
        !(Array.isArray(variant.type) && variant.type.length === 1 && variant.type[0] === 'null')
    );
    if (nonNullVariant) {
      const resolved = resolveReferenceSchema(nonNullVariant, root);
      return {
        ...resolved,
        type: Array.isArray(resolved.type)
          ? resolved.type
          : resolved.type
            ? [resolved.type, 'null']
            : ['null'],
      };
    }
  }

  return schema;
};

const normalizeReferenceSchemaType = (schema?: JsonSchema): string | undefined => {
  if (!schema?.type) return undefined;
  if (Array.isArray(schema.type)) {
    return schema.type.find((type) => type !== 'null') ?? schema.type[0];
  }
  return schema.type;
};

const collectReferenceSchemaFields = (
  schema: JsonSchema | undefined,
  prefix: string,
  labelPrefix: string,
  root?: JsonSchema
): ReferenceFieldOption[] => {
  if (!schema) return [];

  const resolved = resolveReferenceSchema(schema, root);
  const type = normalizeReferenceSchemaType(resolved);
  const options: ReferenceFieldOption[] = [
    {
      value: prefix,
      label: toRelativeLabel(prefix, labelPrefix, prefix),
      type,
    },
  ];

  if (type === 'object' && resolved.properties) {
    Object.entries(resolved.properties).forEach(([key, childSchema]) => {
      collectReferenceSchemaFields(childSchema, `${prefix}.${key}`, labelPrefix, root ?? resolved).forEach((option) =>
        pushUniqueReferenceField(options, option)
      );
    });
    return options;
  }

  if (type === 'array' && resolved.items) {
    const arrayPrefix = `${prefix}[]`;
    pushUniqueReferenceField(options, {
      value: arrayPrefix,
      label: toRelativeLabel(arrayPrefix, labelPrefix, arrayPrefix),
      type: normalizeReferenceSchemaType(resolveReferenceSchema(resolved.items, root ?? resolved)),
    });
    collectReferenceSchemaFields(resolved.items, arrayPrefix, labelPrefix, root ?? resolved).forEach((option) =>
      pushUniqueReferenceField(options, option)
    );
  }

  return options;
};

const buildReferenceSourceModel = (
  referenceBrowseContext: DataTreeContext | undefined,
  fieldOptions: SelectOption[],
  payloadSchema?: JsonSchema
): ReferenceSourceModel => {
  const model: ReferenceSourceModel = {
    payload: [],
    vars: [],
    meta: [],
    error: [],
    forEach: [],
  };

  collectReferenceSchemaFields(payloadSchema, 'payload', 'payload', payloadSchema).forEach((option) =>
    pushUniqueReferenceField(model.payload, option)
  );
  referenceBrowseContext?.payload.forEach((field) => {
    flattenReferenceFields([field], 'payload').forEach((option) =>
      pushUniqueReferenceField(model.payload, option)
    );
  });
  referenceBrowseContext?.meta.forEach((field) => {
    flattenReferenceFields([field], 'meta').forEach((option) =>
      pushUniqueReferenceField(model.meta, option)
    );
  });
  referenceBrowseContext?.error.forEach((field) => {
    flattenReferenceFields([field], 'error').forEach((option) =>
      pushUniqueReferenceField(model.error, option)
    );
  });
  referenceBrowseContext?.vars.forEach((step) => {
    const prefix = `vars.${step.saveAs}`;
    model.vars.push({
      value: step.saveAs,
      label: `${step.stepName} (${step.saveAs})`,
      fields: flattenReferenceFields(step.fields, prefix),
    });
  });
  if (referenceBrowseContext?.forEach) {
    const { itemVar, indexVar, itemType } = referenceBrowseContext.forEach;
    pushUniqueReferenceField(model.forEach, {
      value: itemVar,
      label: itemVar,
      type: itemType,
    });
    pushUniqueReferenceField(model.forEach, {
      value: indexVar,
      label: indexVar,
      type: 'number',
    });
  }

  fieldOptions.forEach((option) => {
    const path = option.value;
    const inferredType = inferTypeFromPath(path);

    if (path.startsWith('payload')) {
      pushUniqueReferenceField(model.payload, {
        value: path,
        label: toRelativeLabel(path, 'payload', 'payload'),
        type: inferredType,
      });
      return;
    }

    if (path.startsWith('vars.')) {
      const [, stepKey, ...rest] = path.split('.');
      if (!stepKey) return;
      let step = model.vars.find((entry) => entry.value === stepKey);
      if (!step) {
        step = {
          value: stepKey,
          label: stepKey,
          fields: [],
        };
        model.vars.push(step);
      }
      pushUniqueReferenceField(step.fields, {
        value: path,
        label: rest.length > 0 ? rest.join('.') : stepKey,
        type: inferredType,
      });
      return;
    }

    if (path.startsWith('meta')) {
      pushUniqueReferenceField(model.meta, {
        value: path,
        label: toRelativeLabel(path, 'meta', 'meta'),
        type: inferredType,
      });
      return;
    }

    if (path.startsWith('error')) {
      pushUniqueReferenceField(model.error, {
        value: path,
        label: toRelativeLabel(path, 'error', 'error'),
        type: inferredType,
      });
      return;
    }

    if (
      referenceBrowseContext?.forEach &&
      (path === referenceBrowseContext.forEach.itemVar ||
        path.startsWith(`${referenceBrowseContext.forEach.itemVar}.`) ||
        path === referenceBrowseContext.forEach.indexVar)
    ) {
      pushUniqueReferenceField(model.forEach, {
        value: path,
        label:
          path === referenceBrowseContext.forEach.itemVar
            ? referenceBrowseContext.forEach.itemVar
            : path === referenceBrowseContext.forEach.indexVar
              ? referenceBrowseContext.forEach.indexVar
              : path.slice(referenceBrowseContext.forEach.itemVar.length + 1),
        type: inferredType,
      });
    }
  });

  return model;
};

const deriveReferenceScope = (
  path: string | null,
  referenceBrowseContext: DataTreeContext | undefined
): { scope: ReferenceSourceScope | ''; step: string } => {
  if (!path) return { scope: '', step: '' };
  if (path.startsWith('payload')) return { scope: 'payload', step: '' };
  if (path.startsWith('vars.')) {
    const [, step = ''] = path.split('.');
    return { scope: 'vars', step };
  }
  if (path.startsWith('meta')) return { scope: 'meta', step: '' };
  if (path.startsWith('error')) return { scope: 'error', step: '' };
  if (
    referenceBrowseContext?.forEach &&
    (path === referenceBrowseContext.forEach.itemVar ||
      path.startsWith(`${referenceBrowseContext.forEach.itemVar}.`) ||
      path === referenceBrowseContext.forEach.indexVar)
  ) {
    return { scope: 'forEach', step: '' };
  }
  return { scope: '', step: '' };
};

const filterReferenceFieldOptions = (
  options: ReferenceFieldOption[],
  targetType: string | undefined
): ReferenceFieldOption[] => {
  if (!targetType) return options;

  const exact = options.filter(
    (option) => getTypeCompatibility(option.type, targetType) === TypeCompatibility.EXACT
  );
  const coercible = options.filter(
    (option) => getTypeCompatibility(option.type, targetType) === TypeCompatibility.COERCIBLE
  );
  const unknown = options.filter(
    (option) => getTypeCompatibility(option.type, targetType) === TypeCompatibility.UNKNOWN
  );

  if (exact.length > 0) return exact;
  if (coercible.length > 0) return coercible;

  return unknown.length > 0 ? unknown : options;
};

/**
 * Build ExpressionContext from SelectOption[] for the Monaco expression editor
 *
 * @param fieldOptions - Available field options from data context
 * @returns ExpressionContext for the expression editor
 */
function buildExpressionContextFromOptions(fieldOptions: SelectOption[]): ExpressionContext {
  // Group fields by their root (payload, vars, meta, error)
  const payloadFields: Record<string, JsonSchema> = {};
  const varsFields: Record<string, JsonSchema> = {};
  const metaFields: Record<string, JsonSchema> = {};
  const errorFields: Record<string, JsonSchema> = {};

  for (const option of fieldOptions) {
    const path = option.value;
    const parts = path.split('.');
    if (parts.length < 2) continue;

    const root = parts[0];
    const restPath = parts.slice(1);
    const fieldName = restPath[restPath.length - 1];

    // Infer type from path
    const inferredType = inferTypeFromPath(path);
    const fieldSchema: JsonSchema = {
      type: inferredType || 'string',
      description: typeof option.label === 'string' ? option.label : undefined
    };

    // Build nested schema structure
    const buildNestedSchema = (
      target: Record<string, JsonSchema>,
      pathParts: string[],
      schema: JsonSchema
    ) => {
      if (pathParts.length === 1) {
        target[pathParts[0]] = schema;
        return;
      }

      const [head, ...rest] = pathParts;
      if (!target[head]) {
        target[head] = { type: 'object', properties: {} };
      }
      if (!target[head].properties) {
        target[head].properties = {};
      }
      buildNestedSchema(target[head].properties!, rest, schema);
    };

    switch (root) {
      case 'payload':
        buildNestedSchema(payloadFields, restPath, fieldSchema);
        break;
      case 'vars':
        buildNestedSchema(varsFields, restPath, fieldSchema);
        break;
      case 'meta':
        buildNestedSchema(metaFields, restPath, fieldSchema);
        break;
      case 'error':
        buildNestedSchema(errorFields, restPath, fieldSchema);
        break;
    }
  }

  return {
    payloadSchema: Object.keys(payloadFields).length > 0
      ? { type: 'object', properties: payloadFields }
      : undefined,
    varsSchema: Object.keys(varsFields).length > 0
      ? { type: 'object', properties: varsFields }
      : undefined,
    metaSchema: Object.keys(metaFields).length > 0
      ? { type: 'object', properties: metaFields }
      : undefined,
    errorSchema: Object.keys(errorFields).length > 0
      ? { type: 'object', properties: errorFields }
      : undefined
  };
}

const ReferenceScopeSelector: React.FC<{
  idPrefix: string;
  model: ReferenceSourceModel;
  targetType: string | undefined;
  selectedScope: ReferenceSourceScope | '';
  selectedStep: string;
  selectedField: string | null;
  disabled?: boolean;
  onScopeChange: (scope: ReferenceSourceScope | '') => void;
  onStepChange: (step: string) => void;
  onFieldChange: (path: string) => void;
}> = ({
  idPrefix,
  model,
  targetType,
  selectedScope,
  selectedStep,
  selectedField,
  disabled,
  onScopeChange,
  onStepChange,
  onFieldChange,
}) => {
  const scopeOptions = useMemo<SelectOption[]>(() => {
    const options: SelectOption[] = [];
    if (model.payload.length > 0) options.push({ value: 'payload', label: 'Payload' });
    if (model.vars.length > 0) options.push({ value: 'vars', label: 'Step results' });
    if (model.meta.length > 0) options.push({ value: 'meta', label: 'Workflow details' });
    if (model.error.length > 0) options.push({ value: 'error', label: 'Error' });
    if (model.forEach.length > 0) options.push({ value: 'forEach', label: 'Loop context' });
    return options;
  }, [model]);

  const selectedStepOption = selectedScope === 'vars'
    ? model.vars.find((step) => step.value === selectedStep) ?? null
    : null;

  const fieldOptions = useMemo<SelectOption[]>(() => {
    let options: ReferenceFieldOption[] = [];
    let rootValue: string | null = null;
    if (selectedScope === 'payload') options = model.payload;
    if (selectedScope === 'meta') options = model.meta;
    if (selectedScope === 'error') options = model.error;
    if (selectedScope === 'forEach') options = model.forEach;
    if (selectedScope === 'vars' && selectedStepOption) options = selectedStepOption.fields;

    if (selectedScope === 'payload') rootValue = 'payload';
    if (selectedScope === 'meta') rootValue = 'meta';
    if (selectedScope === 'error') rootValue = 'error';
    if (selectedScope === 'vars' && selectedStepOption) rootValue = `vars.${selectedStepOption.value}`;
    if (selectedScope === 'forEach' && options.length > 0) rootValue = options[0]?.value ?? null;

    const filteredOptions = filterReferenceFieldOptions(options, targetType);
    if (rootValue) {
      const rootOption = options.find((option) => option.value === rootValue);
      if (rootOption && !filteredOptions.some((option) => option.value === rootValue)) {
        filteredOptions.unshift(rootOption);
      }
    }

    return filteredOptions.map((option) => ({
      value: option.value,
      label: option.label,
    }));
  }, [model, selectedScope, selectedStepOption, targetType]);

  const stepOptions = useMemo<SelectOption[]>(() => {
    if (selectedScope !== 'vars') return [];
    return model.vars.map((step) => ({ value: step.value, label: step.label }));
  }, [model.vars, selectedScope]);

  const selectClassName = 'min-w-0 w-full overflow-hidden whitespace-nowrap';

  return (
    <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(12rem,1fr))]">
      <CustomSelect
        id={`${idPrefix}-reference-scope`}
        options={scopeOptions}
        value={selectedScope || undefined}
        placeholder="Select source scope..."
        onValueChange={(value) => onScopeChange(value as ReferenceSourceScope | '')}
        disabled={disabled}
        className={selectClassName}
      />
      {selectedScope === 'vars' && (
        <CustomSelect
          id={`${idPrefix}-reference-step`}
          options={stepOptions}
          value={selectedStep || undefined}
          placeholder="Select step..."
          onValueChange={onStepChange}
          disabled={disabled}
          className={selectClassName}
        />
      )}
      {selectedScope && selectedScope !== 'vars' && (
        <CustomSelect
          id={`${idPrefix}-reference-field`}
          options={fieldOptions}
          value={selectedField ?? undefined}
          placeholder="Select field..."
          onValueChange={onFieldChange}
          disabled={disabled}
          className={selectClassName}
        />
      )}
      {selectedScope === 'vars' && selectedStep && (
        <CustomSelect
          id={`${idPrefix}-reference-field`}
          options={fieldOptions}
          value={selectedField ?? undefined}
          placeholder="Select field..."
          onValueChange={onFieldChange}
          disabled={disabled}
          className={selectClassName}
        />
      )}
    </div>
  );
};

/**
 * Schema field definition for target action inputs
 */
export interface ActionInputField {
  name: string;
  type: string;
  nullable?: boolean;
  description?: string;
  required?: boolean;
  examples?: unknown[];
  picker?: {
    kind: string;
    dependencies?: string[];
    fixedValueHint?: string;
    allowsDynamicReference?: boolean;
  };
  enum?: Array<string | number | boolean | null>;
  default?: unknown;
  constraints?: {
    format?: string;
    minItems?: number;
    maxItems?: number;
    minLength?: number;
    maxLength?: number;
    minimum?: number;
    maximum?: number;
    pattern?: string;
    itemType?: string;
  };
  children?: ActionInputField[];
}

/**
 * Props for the InputMappingEditor component
 */
export interface InputMappingEditorProps {
  /**
   * Current input mapping value
   */
  value: InputMapping;

  /**
   * Callback when mapping changes
   */
  onChange: (mapping: InputMapping) => void;

  /**
   * Action input schema fields to map to
   */
  targetFields: ActionInputField[];

  /**
   * Available data context options for references
   */
  fieldOptions: SelectOption[];

  /**
   * Step ID for unique element IDs
   */
  stepId: string;

  /**
   * §19.3 - Shared position handlers from MappingPanel
   */
  positionsHandlers?: MappingPositionsHandlers;

  /**
   * §19.1 - Source field type lookup for compatibility indicators
   */
  sourceTypeMap?: Map<string, string>;

  /**
   * Reference context derived from workflow schemas.
   * Falls back to building a minimal context from fieldOptions.
   */
  expressionContext?: ExpressionContext;

  /**
   * Grouped source data used by inline "Browse sources" reference panels.
   */
  referenceBrowseContext?: DataTreeContext;

  /**
   * Whether the editor is disabled
   */
  disabled?: boolean;
}

/**
 * Value type for a mapping entry
 */
type ValueType = 'reference' | 'fixed' | 'legacy';

/**
 * Determine the type of a MappingValue
 */
function getMappingValueType(value: MappingValue | undefined): ValueType {
  if (!value) return 'fixed';
  if (typeof value === 'object' && value !== null) {
    if ('$secret' in value) return 'legacy';
    if ('$expr' in value) {
      return isWorkflowActionInputLegacyValue(value) ? 'legacy' : 'reference';
    }
  }
  return 'fixed';
}

/**
 * Get display value for a MappingValue
 */
function getDisplayValue(value: MappingValue | undefined): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') {
    if ('$expr' in value) return (value as Expr).$expr ?? '';
    if ('$secret' in value) return (value as { $secret: string }).$secret ?? '';
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * Determine whether a mapping value is effectively "set" (not just present).
 * Used to highlight required fields that are missing values.
 */
function isMappingValueSet(value: MappingValue | undefined, fieldType?: string): boolean {
  if (value === undefined) return false;
  if (value === null) return true;

  if (typeof value === 'object') {
    if ('$expr' in value) {
      return Boolean((value as Expr).$expr?.trim());
    }
    if ('$secret' in value) {
      return Boolean((value as { $secret: string }).$secret?.trim());
    }
    return true;
  }

  if (typeof value === 'string') {
    // Treat empty strings as "unset" so required string fields can be flagged.
    return fieldType === 'string' ? value.trim().length > 0 : true;
  }

  return true;
}

/**
 * Editor for a single mapping field
 */
const MappingFieldEditor: React.FC<{
  field: ActionInputField;
  fieldPath?: string;
  value: MappingValue | undefined;
  onChange: (value: MappingValue | undefined) => void;
  rootInputMapping: InputMapping;
  fieldOptions: SelectOption[];
  stepId: string;
  disabled?: boolean;
  sourceTypeMap?: Map<string, string>;
  expressionContext?: ExpressionContext;
  referenceBrowseContext?: DataTreeContext;
}> = ({
  field,
  fieldPath,
  value,
  onChange,
  rootInputMapping,
  fieldOptions,
  stepId,
  disabled,
  sourceTypeMap,
  expressionContext,
  referenceBrowseContext,
}) => {
  const [expanded, setExpanded] = useState(true);
  const [preservedFixedValue, setPreservedFixedValue] = useState<MappingValue | undefined>(() =>
    deriveWorkflowActionInputSourceMode(value).mode === 'fixed' ? value : undefined
  );
  const [preservedReferenceValue, setPreservedReferenceValue] = useState<MappingValue | undefined>(() =>
    deriveWorkflowActionInputSourceMode(value).mode === 'reference' ? value : undefined
  );
  const valueType = useMemo(() => getMappingValueType(value), [value]);

  const resolvedFieldPath = fieldPath ?? field.name;
  const idPrefix = `mapping-${stepId}-${resolvedFieldPath}`;
  const isMissingRequired = useMemo(
    () => Boolean(field.required) && !isMappingValueSet(value, field.type),
    [field.required, field.type, value]
  );

  useEffect(() => {
    const sourceMode = deriveWorkflowActionInputSourceMode(value).mode;
    if (sourceMode === 'fixed' && value !== undefined && valueType === 'fixed') {
      setPreservedFixedValue(value);
    }
    if (sourceMode === 'reference' && value !== undefined && valueType === 'reference') {
      setPreservedReferenceValue(value);
    }
  }, [value, valueType]);

  const handleSourceModeChange = useCallback((nextMode: WorkflowActionInputSourceModeValue) => {
    const transition = transitionWorkflowActionInputMode(
      field,
      value,
      nextMode,
      {
        preservedFixedValue,
        preservedReferenceValue,
      }
    );
    setPreservedFixedValue(transition.preservedFixedValue);
    setPreservedReferenceValue(transition.preservedReferenceValue);
    onChange(transition.nextValue);
  }, [field, onChange, preservedFixedValue, preservedReferenceValue, value, valueType]);

  const handleLiteralChange = useCallback((literalValue: unknown) => {
    onChange(literalValue as MappingValue);
  }, [onChange]);

  const typeMismatchWarning = useMemo(() => {
    if (
      valueType !== 'reference' ||
      !value ||
      typeof value !== 'object' ||
      !('$expr' in value)
    ) {
      return null;
    }

    const expr = (value as Expr).$expr;
    const sourcePath = extractPrimaryPath(expr);
    if (!sourcePath) return null;

    const sourceType = sourceTypeMap?.get(sourcePath) ?? inferTypeFromPath(sourcePath);

    // Get target type
    const targetType = field.type;

    if (!sourceType || !targetType) return null;

    return getWorkflowActionInputTypeHint(sourceType, targetType);
  }, [valueType, value, fieldOptions, field.type, sourceTypeMap]);

  const compatibilityBadge = useMemo(() => {
    if (
      valueType !== 'reference' ||
      !value ||
      typeof value !== 'object' ||
      !('$expr' in value)
    ) {
      return null;
    }

    const expr = (value as Expr).$expr;
    const sourcePath = extractPrimaryPath(expr);
    if (!sourcePath) return null;

    const sourceType = sourceTypeMap?.get(sourcePath) ?? inferTypeFromPath(sourcePath);
    if (!field.type) return null;

    const compatibility = getTypeCompatibility(sourceType, field.type);
    if (compatibility === TypeCompatibility.EXACT) return null;
    const classes = getCompatibilityClasses(compatibility);

    return {
      label: getCompatibilityLabel(compatibility),
      classes,
      sourceType,
      targetType: field.type
    };
  }, [valueType, value, sourceTypeMap, field.type]);

  const [showBrowseSources, setShowBrowseSources] = useState(false);
  const currentSourceMode = valueType === 'legacy' ? deriveWorkflowActionInputSourceMode(value).mode : valueType;
  const selectedReferencePath = currentSourceMode === 'reference' ? extractPrimaryPath(getDisplayValue(value)) : null;
  const referenceSourceModel = useMemo(
    () => buildReferenceSourceModel(referenceBrowseContext, fieldOptions, expressionContext?.payloadSchema),
    [expressionContext?.payloadSchema, referenceBrowseContext, fieldOptions]
  );
  const [selectedReferenceScope, setSelectedReferenceScope] = useState<ReferenceSourceScope | ''>(() =>
    deriveReferenceScope(selectedReferencePath, referenceBrowseContext).scope
  );
  const [selectedReferenceStep, setSelectedReferenceStep] = useState(() =>
    deriveReferenceScope(selectedReferencePath, referenceBrowseContext).step
  );

  useEffect(() => {
    if (currentSourceMode !== 'reference' && showBrowseSources) {
      setShowBrowseSources(false);
    }
  }, [currentSourceMode, showBrowseSources]);

  useEffect(() => {
    if (currentSourceMode !== 'reference') return;
    if (!selectedReferencePath) return;
    const nextSelection = deriveReferenceScope(selectedReferencePath, referenceBrowseContext);
    setSelectedReferenceScope(nextSelection.scope);
    setSelectedReferenceStep(nextSelection.step);
  }, [currentSourceMode, referenceBrowseContext, selectedReferencePath]);

  const handleBrowseSelect = useCallback((path: string) => {
    onChange({ $expr: path });
    setShowBrowseSources(false);
  }, [onChange]);

  const handleReferenceScopeChange = useCallback((nextScope: ReferenceSourceScope | '') => {
    setSelectedReferenceScope(nextScope);
    setSelectedReferenceStep('');
    onChange({ $expr: '' });
  }, [onChange]);

  const handleReferenceStepChange = useCallback((nextStep: string) => {
    setSelectedReferenceStep(nextStep);
    onChange({ $expr: '' });
  }, [onChange]);

  const handleReferenceFieldChange = useCallback((path: string) => {
    if (!path) {
      onChange({ $expr: '' });
      return;
    }
    onChange({ $expr: path });
  }, [onChange]);

  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <button
          onClick={() => setExpanded(!expanded)}
          className="min-w-0 flex-1 text-left text-sm font-medium text-gray-800 hover:text-gray-600"
          disabled={disabled}
        >
          <div className="flex min-w-0 items-start gap-2">
            {expanded ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0" />}
            <WorkflowActionInputFieldInfo
              field={field}
              isMissingRequired={isMissingRequired}
              compact
            />
          </div>
        </button>
      </div>

      {expanded && (
        <div className="space-y-3 pl-2">
          <div className="flex items-center justify-between gap-3">
            <WorkflowActionInputSourceMode
              idPrefix={idPrefix}
              value={value}
              onModeChange={handleSourceModeChange}
              disabled={disabled}
            />
            {compatibilityBadge && valueType === 'reference' && (
              <Badge
                className={`text-[10px] ${compatibilityBadge.classes.bg} ${compatibilityBadge.classes.text} ${compatibilityBadge.classes.border}`}
                title={`${compatibilityBadge.label}: ${compatibilityBadge.sourceType ?? 'unknown'} → ${compatibilityBadge.targetType}`}
              >
                {compatibilityBadge.label}
              </Badge>
            )}
          </div>
          {valueType === 'reference' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Button
                  id={`${idPrefix}-browse-sources-toggle`}
                  variant="ghost"
                  size="sm"
                  type="button"
                  disabled={disabled || !referenceBrowseContext}
                  onClick={() => setShowBrowseSources((current) => !current)}
                  className="text-xs text-gray-600 hover:text-gray-900"
                >
                  {showBrowseSources ? (
                    <ChevronDown className="mr-1 h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="mr-1 h-3.5 w-3.5" />
                  )}
                  Browse sources
                </Button>
              </div>
              <ReferenceScopeSelector
                idPrefix={idPrefix}
                model={referenceSourceModel}
                targetType={field.type}
                selectedScope={selectedReferenceScope}
                selectedStep={selectedReferenceStep}
                selectedField={selectedReferencePath}
                disabled={disabled}
                onScopeChange={handleReferenceScopeChange}
                onStepChange={handleReferenceStepChange}
                onFieldChange={handleReferenceFieldChange}
              />
              {showBrowseSources && referenceBrowseContext && (
                <SourceDataTree
                  context={referenceBrowseContext}
                  onSelectField={handleBrowseSelect}
                  selectedPath={selectedReferencePath ?? undefined}
                  disabled={disabled}
                  maxHeight="280px"
                  targetType={field.type}
                  compact
                />
              )}
              {typeMismatchWarning && (
                <WorkflowActionInputTypeHint
                  sourceType={sourceTypeMap?.get(extractPrimaryPath((value as Expr).$expr) ?? '') ?? inferTypeFromPath(extractPrimaryPath((value as Expr).$expr) ?? '')}
                  targetType={field.type}
                />
              )}
            </div>
          )}

          {valueType === 'legacy' && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 space-y-2">
              <div className="flex items-start gap-2 text-sm text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-medium">Legacy mapping no longer supported here</p>
                  <p className="text-xs text-amber-800">
                    This field uses a saved expression or secret. Replace it with a structured reference or a fixed value.
                  </p>
                </div>
              </div>
              <pre className="overflow-x-auto rounded bg-white/70 px-2 py-1 text-xs text-amber-900">
                {getDisplayValue(value)}
              </pre>
              <div className="flex gap-2">
                <Button
                  id={`${idPrefix}-replace-with-reference`}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  onClick={() => handleSourceModeChange('reference')}
                >
                  Use reference
                </Button>
                <Button
                  id={`${idPrefix}-replace-with-fixed`}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  onClick={() => handleSourceModeChange('fixed')}
                >
                  Use fixed value
                </Button>
              </div>
            </div>
          )}

          {valueType === 'fixed' && (
            <LiteralValueEditor
              value={value as MappingValue}
              onChange={handleLiteralChange}
              field={field}
              rootInputMapping={rootInputMapping}
              fieldType={field.type}
              fieldEnum={field.enum}
              fieldChildren={field.children}
              fieldConstraints={field.constraints}
              fieldOptions={fieldOptions}
              stepId={stepId}
              idPrefix={idPrefix}
              disabled={disabled}
              sourceTypeMap={sourceTypeMap}
              expressionContext={expressionContext}
              referenceBrowseContext={referenceBrowseContext}
            />
          )}
        </div>
      )}
    </Card>
  );
};

/**
 * Editor for literal values based on field type
 */
const isRecordLiteral = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeJsonLiteral = (value: MappingValue | undefined, fieldType: string): unknown => {
  if (fieldType === 'array') {
    return Array.isArray(value) ? value : [];
  }
  if (fieldType === 'object') {
    return isRecordLiteral(value) ? value : {};
  }
  return value ?? null;
};

const buildDefaultLiteralValue = (field: ActionInputField): MappingValue => {
  if (field.default !== undefined) return field.default as MappingValue;
  if (field.type === 'boolean') return false;
  if (field.type === 'number' || field.type === 'integer') return 0;
  if (field.type === 'array') return [];
  if (field.type === 'object') {
    if (!field.children?.length) return {};
    const next: Record<string, MappingValue> = {};
    for (const child of field.children) {
      if (child.required || child.default !== undefined) {
        next[child.name] = buildDefaultLiteralValue(child);
      }
    }
    return next;
  }
  return '';
};

const StructuredLiteralGroup: React.FC<{
  id: string;
  title: string;
  defaultExpanded?: boolean;
  actions?: React.ReactNode;
  children: React.ReactNode;
}> = ({
  id,
  title,
  defaultExpanded = true,
  actions,
  children,
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="rounded-md border border-gray-200">
      <div className="flex items-center justify-between gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2">
        <button
          id={`${id}-toggle`}
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-controls={`${id}-content`}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${title}`}
          className="flex items-center gap-2 text-xs font-medium text-gray-700 hover:text-gray-900"
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <span>{title}</span>
        </button>
        {actions}
      </div>

      {expanded && (
        <div id={`${id}-content`} className="space-y-3 p-3">
          {children}
        </div>
      )}
    </div>
  );
};

const looksLikeEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const formatPrimitiveList = (value: MappingValue | undefined): string => {
  if (!Array.isArray(value)) return '';
  return value.map((item) => String(item ?? '')).join('\n');
};

const parsePrimitiveList = (
  text: string,
  itemType: string,
  constraints?: ActionInputField['constraints']
): { values: MappingValue[]; errors: string[] } => {
  const tokens = text
    .split(/[\n,;]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  const errors: string[] = [];
  const values: MappingValue[] = [];

  tokens.forEach((token, index) => {
    if (itemType === 'number' || itemType === 'integer') {
      const parsed = Number(token);
      if (Number.isNaN(parsed)) {
        errors.push(`Item ${index + 1} is not a valid number`);
        return;
      }
      if (itemType === 'integer' && !Number.isInteger(parsed)) {
        errors.push(`Item ${index + 1} must be an integer`);
        return;
      }
      if (typeof constraints?.minimum === 'number' && parsed < constraints.minimum) {
        errors.push(`Item ${index + 1} must be >= ${constraints.minimum}`);
        return;
      }
      if (typeof constraints?.maximum === 'number' && parsed > constraints.maximum) {
        errors.push(`Item ${index + 1} must be <= ${constraints.maximum}`);
        return;
      }
      values.push(parsed);
      return;
    }

    if (itemType === 'boolean') {
      const normalized = token.toLowerCase();
      if (['true', '1', 'yes'].includes(normalized)) {
        values.push(true);
        return;
      }
      if (['false', '0', 'no'].includes(normalized)) {
        values.push(false);
        return;
      }
      errors.push(`Item ${index + 1} must be true/false`);
      return;
    }

    if (constraints?.format === 'email' && !looksLikeEmail(token)) {
      errors.push(`Item ${index + 1} is not a valid email address`);
      return;
    }

    if (typeof constraints?.minLength === 'number' && token.length < constraints.minLength) {
      errors.push(`Item ${index + 1} must be at least ${constraints.minLength} characters`);
      return;
    }
    if (typeof constraints?.maxLength === 'number' && token.length > constraints.maxLength) {
      errors.push(`Item ${index + 1} must be at most ${constraints.maxLength} characters`);
      return;
    }
    if (constraints?.pattern) {
      try {
        const regex = new RegExp(constraints.pattern);
        if (!regex.test(token)) {
          errors.push(`Item ${index + 1} does not match required format`);
          return;
        }
      } catch {
        // Ignore malformed patterns from schema metadata.
      }
    }
    values.push(token);
  });

  if (typeof constraints?.minItems === 'number' && values.length < constraints.minItems) {
    errors.push(`At least ${constraints.minItems} value(s) required`);
  }
  if (typeof constraints?.maxItems === 'number' && values.length > constraints.maxItems) {
    errors.push(`At most ${constraints.maxItems} value(s) allowed`);
  }

  return { values, errors };
};

const LiteralValueEditor: React.FC<{
  value: MappingValue | undefined;
  onChange: (value: MappingValue) => void;
  field: ActionInputField;
  rootInputMapping: InputMapping;
  fieldType: string;
  fieldEnum?: Array<string | number | boolean | null>;
  fieldChildren?: ActionInputField[];
  fieldConstraints?: ActionInputField['constraints'];
  fieldOptions: SelectOption[];
  stepId: string;
  idPrefix: string;
  disabled?: boolean;
  sourceTypeMap?: Map<string, string>;
  expressionContext?: ExpressionContext;
  referenceBrowseContext?: DataTreeContext;
}> = ({
  value,
  onChange,
  field,
  rootInputMapping,
  fieldType,
  fieldEnum,
  fieldChildren,
  fieldConstraints,
  fieldOptions,
  stepId,
  idPrefix,
  disabled,
  sourceTypeMap,
  expressionContext,
  referenceBrowseContext,
}) => {
  const hasPickerEditor = Boolean(field.picker?.kind);
  const hasStructuredObjectEditor = fieldType === 'object' && (fieldChildren?.length ?? 0) > 0;
  const hasStructuredArrayObjectEditor = fieldType === 'array' && (fieldChildren?.length ?? 0) > 0;
  const hasStructuredPrimitiveArrayEditor =
    fieldType === 'array' &&
    (fieldChildren?.length ?? 0) === 0 &&
    Boolean(fieldConstraints?.itemType) &&
    fieldConstraints?.itemType !== 'object' &&
    fieldConstraints?.itemType !== 'unknown' &&
    fieldConstraints?.itemType !== 'any' &&
    fieldConstraints?.itemType !== 'array';
  const hasStructuredDynamicArrayEditor =
    fieldType === 'array' &&
    (fieldChildren?.length ?? 0) === 0 &&
    (fieldConstraints?.itemType === 'unknown' ||
      fieldConstraints?.itemType === 'any');
  const supportsStructuredEditor =
    hasStructuredObjectEditor ||
    hasStructuredArrayObjectEditor ||
    hasStructuredPrimitiveArrayEditor ||
    hasStructuredDynamicArrayEditor;

  const [editorMode, setEditorMode] = useState<'structured' | 'json'>(
    supportsStructuredEditor ? 'structured' : 'json'
  );
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [jsonText, setJsonText] = useState(() => {
    if (fieldType === 'object' || fieldType === 'array') {
      return JSON.stringify(normalizeJsonLiteral(value, fieldType), null, 2);
    }
    return '';
  });
  const [listError, setListError] = useState<string | null>(null);
  const [listText, setListText] = useState(() => formatPrimitiveList(value));

  useEffect(() => {
    if (!supportsStructuredEditor) {
      setEditorMode('json');
    }
  }, [supportsStructuredEditor]);

  useEffect(() => {
    if (fieldType === 'array' || fieldType === 'object') {
      setJsonText(JSON.stringify(normalizeJsonLiteral(value, fieldType), null, 2));
      setJsonError(null);
    }
  }, [value, fieldType]);

  useEffect(() => {
    if (hasStructuredPrimitiveArrayEditor) {
      setListText(formatPrimitiveList(value));
      setListError(null);
    }
  }, [value, hasStructuredPrimitiveArrayEditor]);

  const nullableOptions: SelectOption[] = [
    { value: 'value', label: 'Use value' },
    { value: 'null', label: 'Set null' },
  ];
  const supportsNull = field.nullable === true;
  const wrapNullableEditor = (editor: React.ReactNode) => {
    if (!supportsNull) return editor;

    return (
      <div className="space-y-2">
        <CustomSelect
          id={`${idPrefix}-literal-null-mode`}
          options={nullableOptions}
          value={value === null ? 'null' : 'value'}
          onValueChange={(nextMode) => {
            if (nextMode === 'null') {
              onChange(null);
              return;
            }

            if (value === null) {
              onChange(buildDefaultLiteralValue(field));
            }
          }}
          disabled={disabled}
          className="w-36"
        />
        {value !== null && editor}
      </div>
    );
  };

  // Handle enum fields
  if (hasPickerEditor) {
    return wrapNullableEditor(
      <WorkflowActionInputFixedPicker
        field={field}
        value={typeof value === 'string' ? value : null}
        onChange={(nextValue) => onChange(nextValue)}
        idPrefix={idPrefix}
        rootInputMapping={rootInputMapping}
        disabled={disabled}
      />
    );
  }

  if (fieldEnum && fieldEnum.length > 0) {
    const enumOptions: SelectOption[] = fieldEnum.map(e => ({
      value: String(e ?? ''),
      label: String(e ?? '')
    }));

    return wrapNullableEditor(
      <CustomSelect
        id={`${idPrefix}-literal-enum`}
        options={enumOptions}
        value={value === undefined || value === null ? '' : String(value)}
        onValueChange={(val) => {
          // Try to preserve type
          const enumVal = fieldEnum.find(e => String(e) === val);
          onChange(enumVal as MappingValue);
        }}
        disabled={disabled}
      />
    );
  }

  // Handle boolean
  if (fieldType === 'boolean') {
    return wrapNullableEditor(
      <CustomSelect
        id={`${idPrefix}-literal-bool`}
        options={[
          { value: 'true', label: 'true' },
          { value: 'false', label: 'false' }
        ]}
        value={value === true ? 'true' : 'false'}
        onValueChange={(val) => onChange(val === 'true')}
        disabled={disabled}
      />
    );
  }

  // Handle number/integer
  if (fieldType === 'number' || fieldType === 'integer') {
    return wrapNullableEditor(
      <Input
        id={`${idPrefix}-literal-num`}
        type="number"
        value={typeof value === 'number' ? value : Number(value ?? 0)}
        onChange={(e) => {
          const parsed = Number(e.target.value);
          if (Number.isNaN(parsed)) return;
          onChange(parsed);
        }}
        disabled={disabled}
      />
    );
  }

  // Handle array/object
  if (fieldType === 'array' || fieldType === 'object') {
    const modeOptions: SelectOption[] = [
      { value: 'structured', label: 'Structured' },
      { value: 'json', label: 'Raw JSON' }
    ];

    const handleJsonChange = (text: string) => {
      setJsonText(text);
      try {
        const parsed = JSON.parse(text);
        setJsonError(null);
        onChange(parsed);
      } catch {
        setJsonError('Invalid JSON');
      }
    };

    const renderJsonEditor = () => (
      <div className="space-y-2">
        <TextArea
          id={`${idPrefix}-literal-json`}
          value={jsonText}
          onChange={(e) => handleJsonChange(e.target.value)}
          rows={4}
          placeholder={fieldType === 'array' ? '[]' : '{}'}
          className={jsonError ? 'border-destructive focus:ring-destructive focus:border-destructive' : ''}
          disabled={disabled}
        />
        {jsonError && (
          <div className="flex items-center gap-1 text-xs text-destructive">
            <AlertTriangle className="w-3 h-3" />
            {jsonError}
          </div>
        )}
      </div>
    );

    const renderStructuredObjectEditor = () => {
      const nextValue = isRecordLiteral(value) ? value : {};
      return (
        <StructuredLiteralGroup
          id={`${idPrefix}-literal-object`}
          title="Object fields"
          actions={
            <Button
              id={`${idPrefix}-literal-object-reset`}
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => onChange(buildDefaultLiteralValue(field))}
              disabled={disabled}
              className="h-7 px-2 text-gray-500 hover:text-gray-900"
            >
              Reset
            </Button>
          }
        >
          {fieldChildren?.map((child) => (
            <MappingFieldEditor
              key={child.name}
              field={child}
              fieldPath={`${field.name}.${child.name}`}
              value={nextValue[child.name] as MappingValue | undefined}
              onChange={(childValue) => {
                onChange({
                  ...nextValue,
                  [child.name]: childValue
                });
              }}
              rootInputMapping={rootInputMapping}
              fieldOptions={fieldOptions}
              stepId={stepId}
              disabled={disabled}
              sourceTypeMap={sourceTypeMap}
              expressionContext={expressionContext}
              referenceBrowseContext={referenceBrowseContext}
            />
          ))}
        </StructuredLiteralGroup>
      );
    };

    const renderStructuredArrayObjectEditor = () => {
      const rows = Array.isArray(value)
        ? value.map((item) => (isRecordLiteral(item) ? item : {}))
        : [];
      const buildEmptyRow = () => {
        const newRow: Record<string, MappingValue> = {};
        for (const child of fieldChildren ?? []) {
          if (child.required || child.default !== undefined) {
            newRow[child.name] = buildDefaultLiteralValue(child);
          }
        }
        return newRow;
      };

      const addRow = () => {
        onChange([...rows, buildEmptyRow()]);
      };

      return (
        <div className="space-y-3">
          {rows.map((row, rowIndex) => (
            <StructuredLiteralGroup
              key={`${idPrefix}-row-${rowIndex}`}
              id={`${idPrefix}-literal-row-${rowIndex}`}
              title={`Item ${rowIndex + 1}`}
              actions={
                <div className="flex items-center gap-1">
                  <Button
                    id={`${idPrefix}-literal-row-reset-${rowIndex}`}
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => {
                      const nextRows = [...rows];
                      nextRows[rowIndex] = buildEmptyRow();
                      onChange(nextRows);
                    }}
                    disabled={disabled}
                    className="h-7 px-2 text-gray-500 hover:text-gray-900"
                  >
                    Reset
                  </Button>
                  <Button
                    id={`${idPrefix}-literal-row-remove-${rowIndex}`}
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => onChange(rows.filter((_, idx) => idx !== rowIndex))}
                    disabled={disabled}
                    className="h-7 px-2 text-gray-500 hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              }
            >
              {fieldChildren?.map((child) => (
                <MappingFieldEditor
                  key={`${idPrefix}-row-${rowIndex}-${child.name}`}
                  field={child}
                  fieldPath={`${field.name}[${rowIndex}].${child.name}`}
                  value={row[child.name] as MappingValue | undefined}
                  onChange={(childValue) => {
                    const nextRows = [...rows];
                    const nextRow = { ...row, [child.name]: childValue };
                    nextRows[rowIndex] = nextRow;
                    onChange(nextRows);
                  }}
                  rootInputMapping={rootInputMapping}
                  fieldOptions={fieldOptions}
                  stepId={stepId}
                  disabled={disabled}
                  sourceTypeMap={sourceTypeMap}
                  expressionContext={expressionContext}
                  referenceBrowseContext={referenceBrowseContext}
                />
              ))}
            </StructuredLiteralGroup>
          ))}

          <Button
            id={`${idPrefix}-literal-array-add`}
            variant="outline"
            size="sm"
            type="button"
            onClick={addRow}
            disabled={disabled}
            className="w-full justify-center"
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add item
          </Button>
        </div>
      );
    };

    const renderStructuredPrimitiveArrayEditor = () => {
      const itemType = fieldConstraints?.itemType ?? 'string';
      return (
        <div className="space-y-2">
          <TextArea
            id={`${idPrefix}-literal-list`}
            value={listText}
            onChange={(e) => {
              const nextText = e.target.value;
              setListText(nextText);
              const { values, errors } = parsePrimitiveList(nextText, itemType, fieldConstraints);
              setListError(errors[0] ?? null);
              if (errors.length === 0) {
                onChange(values);
              }
            }}
            rows={4}
            placeholder="Enter one value per line, or comma-separated"
            className={listError ? 'border-destructive focus:ring-destructive focus:border-destructive' : ''}
            disabled={disabled}
          />
          <p className="text-[11px] text-gray-500">
            Use newline, comma, or semicolon separators.
          </p>
          {listError && (
            <div className="flex items-center gap-1 text-xs text-destructive">
              <AlertTriangle className="w-3 h-3" />
              {listError}
            </div>
          )}
        </div>
      );
    };

    const renderStructuredDynamicArrayEditor = () => {
      const rows = Array.isArray(value) ? value : [];
      const itemField: ActionInputField = {
        name: 'item',
        type: fieldConstraints?.itemType ?? 'unknown',
      };

      const addRow = () => {
        const defaultMode = getDefaultWorkflowActionInputSourceMode(itemField);
        const nextItem = createWorkflowActionInputValueForMode(
          itemField,
          undefined,
          defaultMode
        );
        onChange([...rows, nextItem]);
      };

      return (
        <div className="space-y-3">
          {rows.map((rowValue, rowIndex) => (
            <StructuredLiteralGroup
              key={`${idPrefix}-dynamic-row-${rowIndex}`}
              id={`${idPrefix}-literal-dynamic-row-${rowIndex}`}
              title={`Item ${rowIndex + 1}`}
              actions={
                <div className="flex items-center gap-1">
                  <Button
                    id={`${idPrefix}-literal-dynamic-row-reset-${rowIndex}`}
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => {
                      const nextRows = [...rows];
                      nextRows[rowIndex] = createWorkflowActionInputValueForMode(
                        itemField,
                        undefined,
                        getDefaultWorkflowActionInputSourceMode(itemField)
                      );
                      onChange(nextRows);
                    }}
                    disabled={disabled}
                    className="h-7 px-2 text-gray-500 hover:text-gray-900"
                  >
                    Reset
                  </Button>
                  <Button
                    id={`${idPrefix}-literal-dynamic-row-remove-${rowIndex}`}
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => onChange(rows.filter((_, idx) => idx !== rowIndex))}
                    disabled={disabled}
                    className="h-7 px-2 text-gray-500 hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              }
            >
              <MappingFieldEditor
                field={itemField}
                fieldPath={`${field.name}[${rowIndex}]`}
                value={rowValue as MappingValue | undefined}
                onChange={(nextRowValue) => {
                  const nextRows = [...rows];
                  nextRows[rowIndex] = nextRowValue;
                  onChange(nextRows);
                }}
                rootInputMapping={rootInputMapping}
                fieldOptions={fieldOptions}
                stepId={stepId}
                disabled={disabled}
                sourceTypeMap={sourceTypeMap}
                expressionContext={expressionContext}
                referenceBrowseContext={referenceBrowseContext}
              />
            </StructuredLiteralGroup>
          ))}

          <Button
            id={`${idPrefix}-literal-dynamic-array-add`}
            variant="outline"
            size="sm"
            type="button"
            onClick={addRow}
            disabled={disabled}
            className="w-full justify-center"
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add item
          </Button>
        </div>
      );
    };

    const showStructured = supportsStructuredEditor && editorMode === 'structured';

    return wrapNullableEditor(
      <div className="space-y-2">
        {supportsStructuredEditor && (
          <CustomSelect
            id={`${idPrefix}-literal-mode`}
            options={modeOptions}
            value={editorMode}
            onValueChange={(mode) => setEditorMode(mode as 'structured' | 'json')}
            disabled={disabled}
            className="w-40"
          />
        )}

        {showStructured && hasStructuredObjectEditor && renderStructuredObjectEditor()}
        {showStructured && hasStructuredArrayObjectEditor && renderStructuredArrayObjectEditor()}
        {showStructured && hasStructuredPrimitiveArrayEditor && renderStructuredPrimitiveArrayEditor()}
        {showStructured && hasStructuredDynamicArrayEditor && renderStructuredDynamicArrayEditor()}
        {!showStructured && renderJsonEditor()}
      </div>
    );
  }

  // Default to string
  const stringInputType = fieldConstraints?.format === 'email' ? 'email' : 'text';
  return wrapNullableEditor(
    <Input
      id={`${idPrefix}-literal-str`}
      type={stringInputType}
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Enter value..."
      disabled={disabled}
    />
  );
};

/**
 * Auto-mapping suggestion for a target field.
 */
interface AutoMappingSuggestion {
  targetField: string;
  sourcePath: string;
  confidence: 'exact' | 'fuzzy';
}

/**
 * Find auto-mapping suggestions based on field name matching.
 *
 * @param targetFields - Fields to find suggestions for
 * @param fieldOptions - Available source fields from data context
 * @param currentMappings - Current mappings to exclude already-mapped fields
 * @returns Array of suggestions with confidence levels
 */
function findAutoMappingSuggestions(
  targetFields: ActionInputField[],
  fieldOptions: SelectOption[],
  currentMappings: InputMapping
): AutoMappingSuggestion[] {
  const suggestions: AutoMappingSuggestion[] = [];
  const mappedFields = new Set(Object.keys(currentMappings));

  // Extract field names from options (e.g., "payload.ticketId" -> "ticketId")
  const optionsByFieldName = new Map<string, string[]>();
  fieldOptions.forEach(opt => {
    const parts = opt.value.split('.');
    const fieldName = parts[parts.length - 1].toLowerCase();
    if (!optionsByFieldName.has(fieldName)) {
      optionsByFieldName.set(fieldName, []);
    }
    optionsByFieldName.get(fieldName)!.push(opt.value);
  });

  for (const field of targetFields) {
    // Skip already-mapped fields
    if (mappedFields.has(field.name)) continue;

    const fieldNameLower = field.name.toLowerCase();

    // Try exact match first
    const exactMatches = optionsByFieldName.get(fieldNameLower);
    if (exactMatches && exactMatches.length > 0) {
      suggestions.push({
        targetField: field.name,
        sourcePath: exactMatches[0],
        confidence: 'exact'
      });
      continue;
    }

    // Try fuzzy match (contains)
    for (const [optFieldName, optPaths] of optionsByFieldName) {
      if (optFieldName.includes(fieldNameLower) || fieldNameLower.includes(optFieldName)) {
        suggestions.push({
          targetField: field.name,
          sourcePath: optPaths[0],
          confidence: 'fuzzy'
        });
        break;
      }
    }
  }

  return suggestions;
}

/**
 * InputMappingEditor component
 *
 * Provides a visual editor for mapping action inputs using structured references
 * or literal values.
 */
export const InputMappingEditor: React.FC<InputMappingEditorProps> = ({
  value,
  onChange,
  targetFields,
  fieldOptions,
  stepId,
  sourceTypeMap,
  disabled,
  expressionContext: providedExpressionContext,
  referenceBrowseContext,
}) => {
  const missingRequiredCount = useMemo(() => {
    return targetFields.filter((field) => {
      if (!field.required) return false;
      return !isMappingValueSet(value[field.name], field.type);
    }).length;
  }, [targetFields, value]);

  const filledFieldCount = useMemo(
    () => targetFields.filter((field) => isMappingValueSet(value[field.name], field.type)).length,
    [targetFields, value]
  );

  // §17.3.3 - Auto-mapping suggestions
  const suggestions = useMemo(() =>
    findAutoMappingSuggestions(targetFields, fieldOptions, value),
    [targetFields, fieldOptions, value]
  );

  const suggestionMap = useMemo(() => {
    const map = new Map<string, AutoMappingSuggestion>();
    suggestions.forEach(s => map.set(s.targetField, s));
    return map;
  }, [suggestions]);

  const expressionContext = useMemo(() => {
    if (providedExpressionContext) {
      return providedExpressionContext;
    }
    return buildExpressionContextFromOptions(fieldOptions);
  }, [providedExpressionContext, fieldOptions]);

  // Apply all auto-mapping suggestions
  const handleAutoMapAll = useCallback(() => {
    if (suggestions.length === 0) return;

    const newMappings = { ...value };
    suggestions.forEach(s => {
      newMappings[s.targetField] = { $expr: s.sourcePath };
    });
    onChange(newMappings);
  }, [suggestions, value, onChange]);

  // Apply single suggestion
  const handleApplySuggestion = useCallback((suggestion: AutoMappingSuggestion) => {
    onChange({ ...value, [suggestion.targetField]: { $expr: suggestion.sourcePath } });
  }, [value, onChange]);

  const handleFieldChange = useCallback((fieldName: string, newValue: MappingValue | undefined) => {
    if (newValue === undefined) {
      // Remove mapping
      const next = { ...value };
      delete next[fieldName];
      onChange(next);
    } else {
      onChange({ ...value, [fieldName]: newValue });
    }
  }, [value, onChange]);

  const handleAddMapping = useCallback((fieldName: string) => {
    const field = targetFields.find((candidate) => candidate.name === fieldName);
    if (!field) return;
    const defaultMode = getDefaultWorkflowActionInputSourceMode(field);
    onChange({
      ...value,
      [fieldName]: createWorkflowActionInputValueForMode(field, undefined, defaultMode),
    });
  }, [onChange, targetFields, value]);

  const handleRemoveMapping = useCallback((fieldName: string) => {
    const next = { ...value };
    delete next[fieldName];
    onChange(next);
  }, [value, onChange]);

  // §17.3 - Keyboard navigation
  const allFieldNames = useMemo(
    () => targetFields.map((field) => field.name),
    [targetFields]
  );

  const [keyboardState, keyboardHandlers] = useMappingKeyboard({
    fieldCount: targetFields.length,
    fieldNames: allFieldNames,
    onRemoveMapping: handleRemoveMapping,
    onActivateField: (index) => {
      // When Enter is pressed, add mapping if unmapped or expand if mapped
      const fieldName = allFieldNames[index];
      if (fieldName && !(fieldName in value)) {
        handleAddMapping(fieldName);
      }
    },
    disabled
  });

  // §17.3 - Bulk operation: Clear all mappings
  const handleClearAll = useCallback(() => {
    onChange({});
  }, [onChange]);

  if (targetFields.length === 0) {
    return (
      <div className="text-sm text-gray-500 p-3 bg-gray-50 rounded border border-gray-200">
        This action has no input fields.
      </div>
    );
  }

  return (
    <div
      className="space-y-4"
      onKeyDown={keyboardHandlers.handleKeyDown}
      onFocus={keyboardHandlers.activate}
      onBlur={keyboardHandlers.deactivate}
      role="listbox"
      aria-label="Action input fields"
      aria-activedescendant={
        keyboardState.focusedIndex >= 0
          ? `mapping-field-${stepId}-${allFieldNames[keyboardState.focusedIndex]}`
          : undefined
      }
    >
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
          <div>
            {filledFieldCount} of {targetFields.length} fields filled
          </div>
          {missingRequiredCount > 0 && (
            <div className="text-xs text-destructive flex items-center gap-1" title="Required fields are missing values">
              <AlertTriangle className="w-3 h-3" />
              {missingRequiredCount} required missing
            </div>
          )}
        </div>
        <div className="flex flex-col items-start gap-1">
          {suggestions.length > 0 && (
            <Button
              id={`auto-map-${stepId}`}
              variant="ghost"
              size="sm"
              onClick={handleAutoMapAll}
              disabled={disabled}
              className="text-xs text-primary-600 hover:text-primary-700"
            >
              <Wand2 className="w-3.5 h-3.5 mr-1" />
              Apply suggestions ({suggestions.length})
            </Button>
          )}
          {Object.keys(value).length > 0 && (
            <Button
              id={`clear-all-mappings-${stepId}`}
              variant="ghost"
              size="sm"
              onClick={handleClearAll}
              disabled={disabled}
              className="text-xs text-gray-500 hover:text-destructive"
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1" />
              Clear values
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-2" role="group" aria-label="Action input fields list">
        {targetFields.map((field) => {
          const suggestion = suggestionMap.get(field.name);
          const isMissingRequired = Boolean(field.required) && !isMappingValueSet(value[field.name], field.type);
          const fieldIndex = allFieldNames.indexOf(field.name);
          const isFocused = keyboardState.isActive && keyboardState.focusedIndex === fieldIndex;
          const fieldProps = keyboardHandlers.getFieldProps(fieldIndex);
          const fieldValue = value[field.name];
          const hasConfiguredValue = Object.prototype.hasOwnProperty.call(value, field.name);

          if (hasConfiguredValue) {
            return (
              <div
                key={field.name}
                id={`mapping-field-${stepId}-${field.name}`}
                role="option"
                className={`relative group transition-all ${fieldProps.className}`}
                tabIndex={fieldProps.tabIndex}
                aria-selected={fieldProps['aria-selected']}
                onFocus={fieldProps.onFocus}
                onKeyDown={fieldProps.onKeyDown}
              >
                <MappingFieldEditor
                  field={field}
                  value={fieldValue}
                  onChange={(v) => handleFieldChange(field.name, v)}
                  rootInputMapping={value}
                  fieldOptions={fieldOptions}
                  stepId={stepId}
                  disabled={disabled}
                  sourceTypeMap={sourceTypeMap}
                  expressionContext={expressionContext}
                  referenceBrowseContext={referenceBrowseContext}
                />
                <button
                  onClick={() => handleRemoveMapping(field.name)}
                  className={`absolute -right-2 -top-2 p-1 bg-white dark:bg-[rgb(var(--color-card))] border border-gray-200 dark:border-[rgb(var(--color-border-200))] rounded-full shadow-sm transition-opacity hover:bg-destructive/10 hover:border-destructive/30 ${
                    isFocused ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                  }`}
                  title="Remove mapping (Delete/Backspace)"
                  disabled={disabled}
                  tabIndex={-1}
                >
                  <Trash2 className="w-3.5 h-3.5 text-gray-500 hover:text-destructive" />
                </button>
              </div>
            );
          }

          return (
            <div
              key={field.name}
              id={`mapping-field-${stepId}-${field.name}`}
              role="option"
              tabIndex={fieldProps.tabIndex}
              aria-selected={fieldProps['aria-selected']}
              onFocus={fieldProps.onFocus}
              onKeyDown={fieldProps.onKeyDown}
              className={`rounded px-2.5 py-2 transition-all ${
                suggestion ? 'bg-primary-50 border border-primary-100' : ''
              } hover:bg-gray-50 ${isFocused ? 'ring-2 ring-primary-500 ring-offset-1' : ''}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <WorkflowActionInputFieldInfo
                    field={field}
                    isMissingRequired={isMissingRequired}
                    compact
                  />
                  {suggestion && (
                    <span className="flex min-w-0 items-center gap-1 text-xs text-primary-600">
                      <Sparkles className="w-3 h-3" />
                      <span className="truncate">← {suggestion.sourcePath}</span>
                      {suggestion.confidence === 'fuzzy' && (
                        <span className="text-primary-400">(fuzzy)</span>
                      )}
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {suggestion && (
                    <Button
                      id={`apply-suggestion-${stepId}-${field.name}`}
                      variant="ghost"
                      size="sm"
                      onClick={() => handleApplySuggestion(suggestion)}
                      disabled={disabled}
                      className="text-xs text-primary-600"
                      title={`Apply suggestion: ${suggestion.sourcePath}`}
                    >
                      <Wand2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  <Button
                    id={`add-mapping-${stepId}-${field.name}`}
                    variant="ghost"
                    size="sm"
                    onClick={() => handleAddMapping(field.name)}
                    disabled={disabled}
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" />
                    Fill
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default InputMappingEditor;
