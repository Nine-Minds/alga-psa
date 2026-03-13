'use client';

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { ChevronRight, ChevronDown, Plus, Trash2, AlertTriangle, Wand2, Sparkles, RotateCcw, LinkIcon } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Card } from '@alga-psa/ui/components/Card';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { validateExpressionSource } from '@shared/workflow/runtime/expressionEngine';
import { listTenantSecrets } from '@alga-psa/tenancy/actions';
import type { InputMapping, MappingValue, Expr } from '@shared/workflow/runtime/client';
import {
  ExpressionEditor,
  type ExpressionEditorHandle,
  type ExpressionContext,
  type JsonSchema
} from '../expression-editor';
import {
  useMappingDnd,
  getDragData,
  getDropTargetClasses,
  type DragItem
} from './useMappingDnd';
import type { MappingPositionsHandlers } from './useMappingPositions';
import { useMappingKeyboard } from './useMappingKeyboard';
import {
  TypeCompatibility,
  getTypeCompatibility,
  getCompatibilityColor,
  getCompatibilityClasses,
  getCompatibilityLabel,
  getDisplayTypeName
} from './typeCompatibility';
import { WorkflowActionInputFieldInfo } from '../WorkflowActionInputFieldInfo';
import { getWorkflowActionInputTypeHint, WorkflowActionInputTypeHint } from '../WorkflowActionInputTypeHint';
import { WorkflowActionInputFixedPicker } from '../WorkflowActionInputFixedPicker';
import {
  WorkflowActionInputSourceMode,
  createWorkflowActionInputValueForMode,
  deriveWorkflowActionInputSourceMode,
  getDefaultWorkflowActionInputSourceMode,
  transitionWorkflowActionInputMode,
  type WorkflowActionInputAdvancedModeValue,
  type WorkflowActionInputSourceModeValue,
} from '../WorkflowActionInputSourceMode';

/**
 * Extended select option with type information for compatibility filtering
 */
export interface TypedSelectOption extends SelectOption {
  /** The data type of this field (e.g., 'string', 'number', 'object') */
  type?: string;
}

/**
 * Compatibility group for dropdown options
 */
interface CompatibilityGroup {
  compatibility: TypeCompatibility;
  label: string;
  options: TypedSelectOption[];
}

/**
 * Build grouped field options sorted by type compatibility
 *
 * @param options - Available field options
 * @param targetType - The target field type to compare against
 * @returns Grouped and sorted options with compatibility indicators
 */
function buildCompatibilityGroupedOptions(
  options: SelectOption[],
  targetType: string | undefined
): CompatibilityGroup[] {
  if (!targetType) {
    // No target type - just return all options as unknown
    return [{
      compatibility: TypeCompatibility.UNKNOWN,
      label: 'Available Fields',
      options: options.map(o => ({ ...o }))
    }];
  }

  const groups: Record<TypeCompatibility, TypedSelectOption[]> = {
    [TypeCompatibility.EXACT]: [],
    [TypeCompatibility.COERCIBLE]: [],
    [TypeCompatibility.UNKNOWN]: [],
    [TypeCompatibility.INCOMPATIBLE]: []
  };

  // Infer types from field paths and group by compatibility
  for (const option of options) {
    const inferredType = inferTypeFromPath(option.value);
    const compatibility = getTypeCompatibility(inferredType, targetType);

    groups[compatibility].push({
      ...option,
      type: inferredType,
      // Add visual indicator to label
      label: typeof option.label === 'string'
        ? option.label
        : option.label
    });
  }

  // Build result groups (only include non-empty groups)
  const result: CompatibilityGroup[] = [];

  if (groups[TypeCompatibility.EXACT].length > 0) {
    result.push({
      compatibility: TypeCompatibility.EXACT,
      label: '✓ Exact Match',
      options: groups[TypeCompatibility.EXACT]
    });
  }

  if (groups[TypeCompatibility.COERCIBLE].length > 0) {
    result.push({
      compatibility: TypeCompatibility.COERCIBLE,
      label: '~ Can Convert',
      options: groups[TypeCompatibility.COERCIBLE]
    });
  }

  if (groups[TypeCompatibility.UNKNOWN].length > 0) {
    result.push({
      compatibility: TypeCompatibility.UNKNOWN,
      label: '? Unknown',
      options: groups[TypeCompatibility.UNKNOWN]
    });
  }

  if (groups[TypeCompatibility.INCOMPATIBLE].length > 0) {
    result.push({
      compatibility: TypeCompatibility.INCOMPATIBLE,
      label: '✗ Incompatible',
      options: groups[TypeCompatibility.INCOMPATIBLE]
    });
  }

  return result;
}

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

/**
 * Flatten grouped options back to a sorted array with visual indicators
 */
function flattenGroupedOptions(groups: CompatibilityGroup[]): SelectOption[] {
  const result: SelectOption[] = [];

  for (const group of groups) {
    // Add group header as a disabled option
    if (groups.length > 1) {
      result.push({
        value: `__group_${group.compatibility}__`,
        label: group.label,
        is_inactive: true,
        className: 'text-xs font-semibold text-gray-500 bg-gray-50 cursor-default'
      });
    }

    // Add options with compatibility styling
    for (const option of group.options) {
      const classes = getCompatibilityClasses(group.compatibility);
      result.push({
        ...option,
        className: `${option.className || ''} ${classes.text}`.trim()
      });
    }
  }

  return result;
}

/**
 * §17.3.2 - Type-filtered field picker component
 * Groups and sorts options by type compatibility with target field
 */
const TypeFilteredFieldPicker: React.FC<{
  id: string;
  options: SelectOption[];
  targetType: string | undefined;
  onSelect: (path: string) => void;
  disabled?: boolean;
}> = ({ id, options, targetType, onSelect, disabled }) => {
  // Build grouped options by type compatibility
  const groupedOptions = useMemo(() => {
    const groups = buildCompatibilityGroupedOptions(options, targetType);
    return flattenGroupedOptions(groups);
  }, [options, targetType]);

  return (
    <CustomSelect
      id={id}
      options={groupedOptions}
      value=""
      placeholder="Insert field"
      onValueChange={(value) => {
        // Skip group headers
        if (value.startsWith('__group_')) return;
        onSelect(value);
      }}
      allowClear
      className="w-48"
      disabled={disabled}
    />
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
   * Available data context options for expressions
   */
  fieldOptions: SelectOption[];

  /**
   * Step ID for unique element IDs
   */
  stepId: string;

  /**
   * §19.3 - Shared position handlers from MappingPanel
   */
  positionsHandlers: MappingPositionsHandlers;

  /**
   * §19.1 - Source field type lookup for compatibility indicators
   */
  sourceTypeMap?: Map<string, string>;

  /**
   * §20 - Expression context for Monaco editor autocomplete
   * If not provided, falls back to building context from fieldOptions
   */
  expressionContext?: ExpressionContext;

  /**
   * Whether the editor is disabled
   */
  disabled?: boolean;
}

/**
 * Value type for a mapping entry
 */
type ValueType = 'expr' | 'secret' | 'literal';

/**
 * Determine the type of a MappingValue
 */
function getMappingValueType(value: MappingValue | undefined): ValueType {
  if (!value) return 'literal';
  if (typeof value === 'object' && value !== null) {
    if ('$expr' in value) return 'expr';
    if ('$secret' in value) return 'secret';
  }
  return 'literal';
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
  secrets: Array<{ name: string; description?: string }>;
  stepId: string;
  disabled?: boolean;
  sourceTypeMap?: Map<string, string>;
  expressionContext?: ExpressionContext;
}> = ({
  field,
  fieldPath,
  value,
  onChange,
  rootInputMapping,
  fieldOptions,
  secrets,
  stepId,
  disabled,
  sourceTypeMap,
  expressionContext,
}) => {
  const [valueType, setValueType] = useState<ValueType>(() => getMappingValueType(value));
  const [expressionError, setExpressionError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(true);
  const [preservedFixedValue, setPreservedFixedValue] = useState<MappingValue | undefined>(() =>
    deriveWorkflowActionInputSourceMode(value).mode === 'fixed' ? value : undefined
  );
  const [preservedReferenceValue, setPreservedReferenceValue] = useState<MappingValue | undefined>(() =>
    deriveWorkflowActionInputSourceMode(value).mode === 'reference' ? value : undefined
  );
  const editorRef = useRef<ExpressionEditorHandle>(null);

  const resolvedFieldPath = fieldPath ?? field.name;
  const idPrefix = `mapping-${stepId}-${resolvedFieldPath}`;
  const isMissingRequired = useMemo(
    () => Boolean(field.required) && !isMappingValueSet(value, field.type),
    [field.required, field.type, value]
  );

  // Sync valueType when value prop changes externally
  useEffect(() => {
    setValueType(getMappingValueType(value));
  }, [value]);

  useEffect(() => {
    const sourceMode = deriveWorkflowActionInputSourceMode(value).mode;
    if (sourceMode === 'fixed' && value !== undefined) {
      setPreservedFixedValue(value);
    }
    if (sourceMode === 'reference' && value !== undefined) {
      setPreservedReferenceValue(value);
    }
  }, [value]);

  const handleSourceModeChange = useCallback((nextMode: WorkflowActionInputSourceModeValue) => {
    setExpressionError(null);
    const currentAdvancedMode: WorkflowActionInputAdvancedModeValue = valueType === 'secret' ? 'secret' : 'expression';
    const transition = transitionWorkflowActionInputMode(
      field,
      value,
      nextMode,
      currentAdvancedMode,
      {
        preservedFixedValue,
        preservedReferenceValue,
      }
    );
    setPreservedFixedValue(transition.preservedFixedValue);
    setPreservedReferenceValue(transition.preservedReferenceValue);
    setValueType(nextMode === 'fixed' ? 'literal' : currentAdvancedMode === 'secret' && nextMode === 'advanced' ? 'secret' : 'expr');
    onChange(transition.nextValue);
  }, [field, onChange, preservedFixedValue, preservedReferenceValue, value, valueType]);

  const handleAdvancedModeChange = useCallback((nextMode: WorkflowActionInputAdvancedModeValue) => {
    setExpressionError(null);
    const nextValue = createWorkflowActionInputValueForMode(field, value, 'advanced', nextMode);
    setValueType(nextMode === 'secret' ? 'secret' : 'expr');
    onChange(nextValue);
  }, [field, onChange, value]);

  const handleExpressionChange = useCallback((expr: string) => {
    try {
      if (expr.trim().length > 0) {
        validateExpressionSource(expr);
      }
      setExpressionError(null);
    } catch (err) {
      setExpressionError(err instanceof Error ? err.message : 'Invalid expression');
    }
    onChange({ $expr: expr });
  }, [onChange]);

  const handleSecretChange = useCallback((secretName: string) => {
    onChange({ $secret: secretName });
  }, [onChange]);

  const handleLiteralChange = useCallback((literalValue: unknown) => {
    onChange(literalValue as MappingValue);
  }, [onChange]);

  const handleInsertField = useCallback((path: string) => {
    if (!path) return;
    if (deriveWorkflowActionInputSourceMode(value).mode === 'reference') {
      handleExpressionChange(path);
      return;
    }
    // Use Monaco editor's insertAtCursor if available
    if (editorRef.current) {
      editorRef.current.insertAtCursor(path);
    } else {
      // Fallback for non-Monaco case
      const current = value && '$expr' in (value as object) ? (value as Expr).$expr ?? '' : '';
      const next = current ? `${current} ${path}` : path;
      handleExpressionChange(next);
    }
  }, [value, handleExpressionChange]);

  const handleValidationChange = useCallback((errors: string[]) => {
    setValidationErrors(errors);
  }, []);

  // §16.2 - Type mismatch warning for expression mappings
  const typeMismatchWarning = useMemo(() => {
    if (
      valueType !== 'expr' ||
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
      valueType !== 'expr' ||
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
    const classes = getCompatibilityClasses(compatibility);

    return {
      label: getCompatibilityLabel(compatibility),
      classes,
      sourceType,
      targetType: field.type
    };
  }, [valueType, value, sourceTypeMap, field.type]);

  const secretOptions: SelectOption[] = secrets.map(s => ({
    value: s.name,
    label: s.name,
    ...(s.description && { description: s.description })
  }));

  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-sm font-medium text-gray-800 hover:text-gray-600"
          disabled={disabled}
        >
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          <WorkflowActionInputFieldInfo
            field={field}
            isMissingRequired={isMissingRequired}
          />
          {compatibilityBadge && (
            <Badge
              className={`text-[10px] ${compatibilityBadge.classes.bg} ${compatibilityBadge.classes.text} ${compatibilityBadge.classes.border}`}
              title={`${compatibilityBadge.label}: ${compatibilityBadge.sourceType ?? 'unknown'} → ${compatibilityBadge.targetType}`}
            >
              {compatibilityBadge.label}
            </Badge>
          )}
        </button>
        <WorkflowActionInputSourceMode
          idPrefix={idPrefix}
          value={value}
          onModeChange={handleSourceModeChange}
          onAdvancedModeChange={handleAdvancedModeChange}
          disabled={disabled}
        />
      </div>

      {expanded && (
        <div className="pl-6 space-y-2">
          {valueType === 'expr' && (
            <div className="space-y-2">
              <div className="flex items-center justify-end">
                {/* §17.3.2 - Type-filtered field picker */}
                <TypeFilteredFieldPicker
                  id={`${idPrefix}-picker`}
                  options={fieldOptions}
                  targetType={field.type}
                  onSelect={handleInsertField}
                  disabled={disabled}
                />
              </div>
              {/* §20 - Monaco expression editor with syntax highlighting and autocomplete */}
              <ExpressionEditor
                ref={editorRef}
                value={getDisplayValue(value)}
                onChange={handleExpressionChange}
                context={expressionContext}
                singleLine={false}
                height={60}
                hasError={!!expressionError || validationErrors.length > 0}
                disabled={disabled}
                onValidationChange={handleValidationChange}
                ariaLabel={`Expression for ${field.name}`}
              />
              {(expressionError || validationErrors.length > 0) && (
                <div className="flex items-center gap-1 text-xs text-destructive">
                  <AlertTriangle className="w-3 h-3" />
                  {expressionError || validationErrors[0]}
                </div>
              )}
              {/* §16.2 - Type mismatch warning */}
              {!expressionError && typeMismatchWarning && (
                <WorkflowActionInputTypeHint
                  sourceType={sourceTypeMap?.get(extractPrimaryPath((value as Expr).$expr) ?? '') ?? inferTypeFromPath(extractPrimaryPath((value as Expr).$expr) ?? '')}
                  targetType={field.type}
                />
              )}
            </div>
          )}

          {valueType === 'secret' && (
            <div className="space-y-2">
              <CustomSelect
                id={`${idPrefix}-secret`}
                options={secretOptions}
                value={getDisplayValue(value)}
                placeholder="Select a secret..."
                onValueChange={handleSecretChange}
                disabled={disabled}
              />
              <div className="flex items-center justify-between">
                {secrets.length === 0 ? (
                  <p className="text-xs text-gray-500">
                    No secrets available. Create secrets in Settings → Secrets.
                  </p>
                ) : (
                  <p className="text-xs text-gray-400">
                    Value: <span className="font-mono">••••••••</span>
                  </p>
                )}
                <a
                  href="/msp/settings?tab=Secrets"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary-600 hover:text-primary-700 hover:underline"
                >
                  Manage Secrets →
                </a>
              </div>
            </div>
          )}

          {valueType === 'literal' && (
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
              secrets={secrets}
              stepId={stepId}
              idPrefix={idPrefix}
              disabled={disabled}
              sourceTypeMap={sourceTypeMap}
              expressionContext={expressionContext}
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
  secrets: Array<{ name: string; description?: string }>;
  stepId: string;
  idPrefix: string;
  disabled?: boolean;
  sourceTypeMap?: Map<string, string>;
  expressionContext?: ExpressionContext;
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
  secrets,
  stepId,
  idPrefix,
  disabled,
  sourceTypeMap,
  expressionContext,
}) => {
  const hasPickerEditor = Boolean(field.picker?.kind);
  const hasStructuredObjectEditor = fieldType === 'object' && (fieldChildren?.length ?? 0) > 0;
  const hasStructuredArrayObjectEditor = fieldType === 'array' && (fieldChildren?.length ?? 0) > 0;
  const hasStructuredPrimitiveArrayEditor =
    fieldType === 'array' &&
    (fieldChildren?.length ?? 0) === 0 &&
    Boolean(fieldConstraints?.itemType) &&
    fieldConstraints?.itemType !== 'object' &&
    fieldConstraints?.itemType !== 'array';
  const supportsStructuredEditor =
    hasStructuredObjectEditor || hasStructuredArrayObjectEditor || hasStructuredPrimitiveArrayEditor;

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
              secrets={secrets}
              stepId={stepId}
              disabled={disabled}
              sourceTypeMap={sourceTypeMap}
              expressionContext={expressionContext}
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
                  secrets={secrets}
                  stepId={stepId}
                  disabled={disabled}
                  sourceTypeMap={sourceTypeMap}
                  expressionContext={expressionContext}
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
 * Provides a visual editor for mapping action inputs using expressions,
 * secrets, or literal values.
 */
export const InputMappingEditor: React.FC<InputMappingEditorProps> = ({
  value,
  onChange,
  targetFields,
  fieldOptions,
  stepId,
  positionsHandlers,
  sourceTypeMap,
  disabled,
  expressionContext: providedExpressionContext
}) => {
  const [secrets, setSecrets] = useState<Array<{ name: string; description?: string }>>([]);
  const [showUnmapped, setShowUnmapped] = useState(true);

  // §19.2 - Drag-and-drop state
  const [dndState, dndHandlers] = useMappingDnd({
    onCreateMapping: (targetFieldName, sourcePath) => {
      // Create expression mapping from dropped item
      onChange({ ...value, [targetFieldName]: { $expr: sourcePath } });
    }
  });

  // Fetch available secrets
  useEffect(() => {
    let mounted = true;
    listTenantSecrets()
      .then(secretList => {
        if (mounted && secretList) {
          setSecrets(secretList.map(s => ({
            name: s.name,
            description: s.description ?? undefined
          })));
        }
      })
      .catch(err => {
        console.error('Failed to fetch secrets:', err);
      });

    return () => { mounted = false; };
  }, []);

  // Separate mapped and unmapped fields
  const { mappedFields, unmappedFields } = useMemo(() => {
    const mappedNames = new Set(Object.keys(value));
    return {
      mappedFields: targetFields.filter(f => mappedNames.has(f.name)),
      unmappedFields: targetFields.filter(f => !mappedNames.has(f.name))
    };
  }, [targetFields, value]);

  const missingRequiredCount = useMemo(() => {
    return targetFields.filter((field) => {
      if (!field.required) return false;
      return !isMappingValueSet(value[field.name], field.type);
    }).length;
  }, [targetFields, value]);

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

  // §20 - Build expression context for Monaco editor
  // Use provided context if available, otherwise fall back to building from fieldOptions
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
      [fieldName]: createWorkflowActionInputValueForMode(field, undefined, defaultMode, 'expression'),
    });
  }, [onChange, targetFields, value]);

  const handleRemoveMapping = useCallback((fieldName: string) => {
    const next = { ...value };
    delete next[fieldName];
    onChange(next);
  }, [value, onChange]);

  // §17.3 - Keyboard navigation
  // Build ordered list of all field names (mapped first, then unmapped)
  const allFieldNames = useMemo(() => {
    const mappedNames = Object.keys(value);
    const unmappedNames = targetFields
      .filter(f => !mappedNames.includes(f.name))
      .map(f => f.name);
    return [...mappedNames, ...unmappedNames];
  }, [value, targetFields]);

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
        This action has no input fields to map.
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
      aria-label="Input mapping fields"
      aria-activedescendant={
        keyboardState.focusedIndex >= 0
          ? `mapping-field-${stepId}-${allFieldNames[keyboardState.focusedIndex]}`
          : undefined
      }
    >
      <div className="flex items-center justify-between">
        <Label className="text-sm font-semibold">Input Mapping</Label>
        <div className="flex items-center gap-3">
          <div className="text-xs text-gray-500" title="Fields marked with * are required">
            <span className="text-[11px] text-gray-500" aria-hidden>*</span> required
          </div>
          {missingRequiredCount > 0 && (
            <div className="text-xs text-destructive flex items-center gap-1" title="Required fields are missing values">
              <AlertTriangle className="w-3 h-3" />
              {missingRequiredCount} missing
            </div>
          )}
          {/* §17.3.3 - Auto-map button */}
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
              Auto-map ({suggestions.length})
            </Button>
          )}
          {/* §17.3 - Clear all button */}
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
              Clear all
            </Button>
          )}
          <div className="text-xs text-gray-500">
            {Object.keys(value).length} / {targetFields.length} fields mapped
          </div>
        </div>
      </div>

      {/* Mapped fields */}
      {mappedFields.length > 0 && (
        <div className="space-y-2" role="group" aria-label="Mapped fields">
          {mappedFields.map((field, idx) => {
            const fieldIndex = allFieldNames.indexOf(field.name);
            const isFocused = keyboardState.isActive && keyboardState.focusedIndex === fieldIndex;
            const fieldProps = keyboardHandlers.getFieldProps(fieldIndex);

            return (
              <div
                key={field.name}
                id={`mapping-field-${stepId}-${field.name}`}
                role="option"
                className={`relative group transition-all ${fieldProps.className}`}
                ref={(el) => positionsHandlers.registerTargetRef(field.name, el)}
                tabIndex={fieldProps.tabIndex}
                aria-selected={fieldProps['aria-selected']}
                onFocus={fieldProps.onFocus}
                onKeyDown={fieldProps.onKeyDown}
              >
                <MappingFieldEditor
                  field={field}
                  value={value[field.name]}
                  onChange={(v) => handleFieldChange(field.name, v)}
                  rootInputMapping={value}
                  fieldOptions={fieldOptions}
                  secrets={secrets}
                  stepId={stepId}
                  disabled={disabled}
                  sourceTypeMap={sourceTypeMap}
                  expressionContext={expressionContext}
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
          })}
        </div>
      )}

      {/* Unmapped fields */}
      {unmappedFields.length > 0 && (
        <div className="space-y-2">
          <button
            onClick={() => setShowUnmapped(!showUnmapped)}
            className="flex items-center gap-2 text-xs font-medium text-gray-600 hover:text-gray-800"
          >
            {showUnmapped ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            Unmapped fields ({unmappedFields.length})
          </button>

          {showUnmapped && (
            <div className="space-y-1 pl-5" role="group" aria-label="Unmapped fields">
                  {unmappedFields.map((field, idx) => {
                    const suggestion = suggestionMap.get(field.name);
                    const isDropTarget = dndState.isDragging;
                    const isActiveDropTarget = dndState.dropTarget === field.name;
                    const isMissingRequired = Boolean(field.required) && !isMappingValueSet(value[field.name], field.type);

                    // §19.2 - Calculate type compatibility for drop feedback
                    const dropCompatibility = dndState.draggedItem?.type && field.type
                      ? getTypeCompatibility(dndState.draggedItem.type, field.type)
                      : null;

                const dropClasses = isActiveDropTarget && dropCompatibility
                  ? getCompatibilityClasses(dropCompatibility)
                  : null;

                // §17.3 - Keyboard navigation props
                const fieldIndex = allFieldNames.indexOf(field.name);
                const isFocused = keyboardState.isActive && keyboardState.focusedIndex === fieldIndex;
                const fieldProps = keyboardHandlers.getFieldProps(fieldIndex);

                return (
                  <div
                    key={field.name}
                    id={`mapping-field-${stepId}-${field.name}`}
                    role="option"
                    ref={(el) => positionsHandlers.registerTargetRef(field.name, el)}
                    tabIndex={fieldProps.tabIndex}
                    aria-selected={fieldProps['aria-selected']}
                    onFocus={fieldProps.onFocus}
                    onKeyDown={fieldProps.onKeyDown}
                    className={`flex items-center justify-between py-1.5 px-2 rounded transition-all ${
                      suggestion ? 'bg-primary-50 border border-primary-100' : ''
                    } ${isDropTarget ? 'border-2 border-dashed border-gray-300' : ''} ${
                      isActiveDropTarget && dropClasses
                        ? `${dropClasses.bg} ${dropClasses.border} border-solid`
                        : isActiveDropTarget
                          ? 'bg-primary-50 border-primary-300 border-solid'
                          : 'hover:bg-gray-50'
                    } ${isFocused ? 'ring-2 ring-primary-500 ring-offset-1' : ''}`}
                    onDragOver={(e) => {
                      if (disabled) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'copy';
                      dndHandlers.handleDragOver(field.name, field.type);
                    }}
                    onDragLeave={() => {
                      dndHandlers.handleDragLeave();
                    }}
                    onDrop={(e) => {
                      if (disabled) return;
                      e.preventDefault();
                      dndHandlers.handleDrop(field.name);
                    }}
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {/* §19.2 - Drop zone indicator */}
                      {isDropTarget && (
                        <LinkIcon className={`w-3.5 h-3.5 ${isActiveDropTarget ? 'text-primary-500' : 'text-gray-400'}`} />
                      )}
                      <WorkflowActionInputFieldInfo
                        field={field}
                        isMissingRequired={isMissingRequired}
                      />
                      {/* §17.3.3 - Show suggestion indicator */}
                      {suggestion && !isDropTarget && (
                        <span className="text-xs text-primary-600 flex items-center gap-1 truncate">
                          <Sparkles className="w-3 h-3" />
                          <span className="truncate">← {suggestion.sourcePath}</span>
                          {suggestion.confidence === 'fuzzy' && (
                            <span className="text-primary-400">(fuzzy)</span>
                          )}
                        </span>
                      )}
                      {/* §19.2 - Show dragged item info when hovering */}
                      {isActiveDropTarget && dndState.draggedItem && (
                        <span className="text-xs text-primary-600 flex items-center gap-1 truncate">
                          <LinkIcon className="w-3 h-3" />
                          <span className="truncate">← {dndState.draggedItem.path}</span>
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {suggestion && !isDropTarget && (
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
                      {!isDropTarget && (
                        <Button
                          id={`add-mapping-${stepId}-${field.name}`}
                          variant="ghost"
                          size="sm"
                          onClick={() => handleAddMapping(field.name)}
                          disabled={disabled}
                        >
                          <Plus className="w-3.5 h-3.5 mr-1" />
                          Map
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default InputMappingEditor;
