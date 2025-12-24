'use client';

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { ChevronRight, ChevronDown, Plus, Trash2, Code, Key, Type, AlertTriangle, Wand2, Sparkles, RotateCcw, LinkIcon } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { TextArea } from '@/components/ui/TextArea';
import { Card } from '@/components/ui/Card';
import { ExpressionTextArea } from './ExpressionTextArea';
import { Badge } from '@/components/ui/Badge';
import { Label } from '@/components/ui/Label';
import CustomSelect, { SelectOption } from '@/components/ui/CustomSelect';
import { validateExpressionSource } from '@shared/workflow/runtime/expressionEngine';
import { listTenantSecrets } from 'server/src/lib/actions/tenant-secret-actions';
import type { InputMapping, MappingValue, Expr } from '@shared/workflow/runtime';
import {
  useMappingDnd,
  getDragData,
  getDropTargetClasses,
  type DragItem
} from './useMappingDnd';
import { useMappingPositions } from './useMappingPositions';
import { useMappingKeyboard } from './useMappingKeyboard';
import { MappingConnectionsOverlay, type ConnectionData } from './MappingConnectionsOverlay';
import {
  TypeCompatibility,
  getTypeCompatibility,
  getCompatibilityColor,
  getCompatibilityClasses,
  getCompatibilityLabel,
  getDisplayTypeName
} from './typeCompatibility';

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
  description?: string;
  required?: boolean;
  enum?: Array<string | number | boolean | null>;
  default?: unknown;
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
   * Whether the editor is disabled
   */
  disabled?: boolean;

  /**
   * §19.3 - Source positions from external SourceDataTree for connection lines
   */
  sourcePositions?: Map<string, { centerY: number; right: number }>;
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
 * Editor for a single mapping field
 */
const MappingFieldEditor: React.FC<{
  field: ActionInputField;
  value: MappingValue | undefined;
  onChange: (value: MappingValue | undefined) => void;
  fieldOptions: SelectOption[];
  secrets: Array<{ name: string; description?: string }>;
  stepId: string;
  disabled?: boolean;
}> = ({ field, value, onChange, fieldOptions, secrets, stepId, disabled }) => {
  const [valueType, setValueType] = useState<ValueType>(() => getMappingValueType(value));
  const [expressionError, setExpressionError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

  const idPrefix = `mapping-${stepId}-${field.name}`;

  // Sync valueType when value prop changes externally
  useEffect(() => {
    setValueType(getMappingValueType(value));
  }, [value]);

  const handleValueTypeChange = useCallback((newType: string) => {
    const type = newType as ValueType;
    setValueType(type);
    setExpressionError(null);

    // Convert to new type with appropriate default
    if (type === 'expr') {
      onChange({ $expr: '' });
    } else if (type === 'secret') {
      onChange({ $secret: '' });
    } else {
      // Literal - set appropriate default based on field type
      if (field.type === 'boolean') onChange(false);
      else if (field.type === 'number' || field.type === 'integer') onChange(0);
      else if (field.type === 'array') onChange([]);
      else if (field.type === 'object') onChange({});
      else onChange('');
    }
  }, [field.type, onChange]);

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
    const current = value && '$expr' in (value as object) ? (value as Expr).$expr ?? '' : '';
    const next = current ? `${current} ${path}` : path;
    handleExpressionChange(next);
  }, [value, handleExpressionChange]);

  const typeOptions: SelectOption[] = [
    { value: 'expr', label: 'Expression' },
    { value: 'secret', label: 'Secret' },
    { value: 'literal', label: 'Literal' },
  ];

  // §16.2 - Type mismatch warning for expression mappings
  const typeMismatchWarning = useMemo(() => {
    if (valueType !== 'expr' || !value || !('$expr' in (value as object))) {
      return null;
    }

    const expr = (value as Expr).$expr;
    if (!expr?.trim()) return null;

    // Extract the first path-like token from the expression
    const sourcePath = expr.trim().split(/[\s+\-*/%()[\]{},<>=!&|?:]+/)[0];
    if (!sourcePath) return null;

    // Find the source type from field options
    const sourceOption = fieldOptions.find(opt => opt.value === sourcePath);
    const sourceType = inferTypeFromPath(sourcePath);

    // Get target type
    const targetType = field.type;

    if (!sourceType || !targetType) return null;

    const compatibility = getTypeCompatibility(sourceType, targetType);

    if (compatibility === TypeCompatibility.COERCIBLE) {
      return {
        type: 'warning' as const,
        message: `Type "${sourceType}" will be converted to "${targetType}"`,
        compatibility
      };
    }

    if (compatibility === TypeCompatibility.INCOMPATIBLE) {
      return {
        type: 'error' as const,
        message: `Type "${sourceType}" is incompatible with expected "${targetType}"`,
        compatibility
      };
    }

    return null;
  }, [valueType, value, fieldOptions, field.type]);

  const secretOptions: SelectOption[] = secrets.map(s => ({
    value: s.name,
    label: s.name,
    ...(s.description && { description: s.description })
  }));

  const typeIcon = valueType === 'expr' ? <Code className="w-3.5 h-3.5" /> :
    valueType === 'secret' ? <Key className="w-3.5 h-3.5" /> :
    <Type className="w-3.5 h-3.5" />;

  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-sm font-medium text-gray-800 hover:text-gray-600"
          disabled={disabled}
        >
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          <span>{field.name}</span>
          {field.required && <Badge className="text-xs bg-red-100 text-red-700">required</Badge>}
        </button>
        <div className="flex items-center gap-2">
          {typeIcon}
          <CustomSelect
            id={`${idPrefix}-type`}
            options={typeOptions}
            value={valueType}
            onValueChange={handleValueTypeChange}
            disabled={disabled}
            className="w-28"
          />
        </div>
      </div>

      {expanded && (
        <div className="pl-6 space-y-2">
          {field.description && (
            <p className="text-xs text-gray-500">{field.description}</p>
          )}

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
              {/* §16.2 - Expression textarea with context-aware autocomplete */}
              <ExpressionTextArea
                id={`${idPrefix}-expr`}
                value={getDisplayValue(value)}
                onChange={handleExpressionChange}
                fieldOptions={fieldOptions}
                rows={2}
                className={expressionError ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : ''}
                disabled={disabled}
              />
              {expressionError && (
                <div className="flex items-center gap-1 text-xs text-red-600">
                  <AlertTriangle className="w-3 h-3" />
                  {expressionError}
                </div>
              )}
              {/* §16.2 - Type mismatch warning */}
              {!expressionError && typeMismatchWarning && (
                <div className={`flex items-center gap-1 text-xs ${
                  typeMismatchWarning.type === 'error' ? 'text-red-600' : 'text-yellow-600'
                }`}>
                  <AlertTriangle className="w-3 h-3" />
                  {typeMismatchWarning.message}
                </div>
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
              fieldType={field.type}
              fieldEnum={field.enum}
              idPrefix={idPrefix}
              disabled={disabled}
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
const LiteralValueEditor: React.FC<{
  value: MappingValue | undefined;
  onChange: (value: MappingValue) => void;
  fieldType: string;
  fieldEnum?: Array<string | number | boolean | null>;
  idPrefix: string;
  disabled?: boolean;
}> = ({ value, onChange, fieldType, fieldEnum, idPrefix, disabled }) => {
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [jsonText, setJsonText] = useState(() => {
    if (fieldType === 'object' || fieldType === 'array') {
      return JSON.stringify(value ?? (fieldType === 'array' ? [] : {}), null, 2);
    }
    return '';
  });

  // Handle enum fields
  if (fieldEnum && fieldEnum.length > 0) {
    const enumOptions: SelectOption[] = fieldEnum.map(e => ({
      value: String(e ?? ''),
      label: String(e ?? '')
    }));

    return (
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
    return (
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
    return (
      <Input
        id={`${idPrefix}-literal-num`}
        type="number"
        value={typeof value === 'number' ? value : 0}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
      />
    );
  }

  // Handle array/object
  if (fieldType === 'array' || fieldType === 'object') {
    const handleJsonChange = (text: string) => {
      setJsonText(text);
      try {
        const parsed = JSON.parse(text);
        setJsonError(null);
        onChange(parsed);
      } catch (err) {
        setJsonError('Invalid JSON');
      }
    };

    return (
      <div className="space-y-2">
        <TextArea
          id={`${idPrefix}-literal-json`}
          value={jsonText}
          onChange={(e) => handleJsonChange(e.target.value)}
          rows={4}
          placeholder={fieldType === 'array' ? '[]' : '{}'}
          className={jsonError ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : ''}
          disabled={disabled}
        />
        {jsonError && (
          <div className="flex items-center gap-1 text-xs text-red-600">
            <AlertTriangle className="w-3 h-3" />
            {jsonError}
          </div>
        )}
      </div>
    );
  }

  // Default to string
  return (
    <Input
      id={`${idPrefix}-literal-str`}
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
  disabled,
  sourcePositions
}) => {
  const [secrets, setSecrets] = useState<Array<{ name: string; description?: string }>>([]);
  const [showUnmapped, setShowUnmapped] = useState(true);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);

  // §19.2 - Drag-and-drop state
  const [dndState, dndHandlers] = useMappingDnd({
    onCreateMapping: (targetFieldName, sourcePath) => {
      // Create expression mapping from dropped item
      onChange({ ...value, [targetFieldName]: { $expr: sourcePath } });
    }
  });

  // §19.3 - Position tracking for connection lines
  const containerRef = useRef<HTMLDivElement>(null);
  const [positionsState, positionsHandlers] = useMappingPositions();

  // Set container ref for position tracking
  useEffect(() => {
    positionsHandlers.setContainerRef(containerRef.current);
  }, [positionsHandlers]);

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

  // §19.3 - Build connection data for visual lines
  const connections: ConnectionData[] = useMemo(() => {
    const result: ConnectionData[] = [];

    for (const [fieldName, mappingValue] of Object.entries(value)) {
      // Only show connections for expression mappings
      if (typeof mappingValue !== 'object' || !mappingValue || !('$expr' in mappingValue)) {
        continue;
      }

      const expr = (mappingValue as Expr).$expr;
      if (!expr) continue;

      // Get the source path from the expression (simplified - just takes first path-like token)
      const sourcePath = expr.trim().split(/[\s+\-*/()[\]{}]+/)[0];
      if (!sourcePath) continue;

      const field = targetFields.find(f => f.name === fieldName);
      const sourceRect = sourcePositions?.get(sourcePath) || positionsState.sourcePositions.get(sourcePath) || null;
      const targetRect = positionsState.targetPositions.get(fieldName) || null;

      result.push({
        id: `${sourcePath}->${fieldName}`,
        sourceId: sourcePath,
        targetId: fieldName,
        sourceRect: sourceRect ? { ...sourceRect, left: sourceRect.right - 10, top: sourceRect.centerY - 5, bottom: sourceRect.centerY + 5, width: 10, height: 10, centerX: sourceRect.right - 5 } : null,
        targetRect: targetRect ? { ...targetRect } : null,
        sourceType: undefined, // Would need source field type info
        targetType: field?.type,
        compatibility: TypeCompatibility.UNKNOWN
      });
    }

    return result;
  }, [value, targetFields, sourcePositions, positionsState.sourcePositions, positionsState.targetPositions]);

  // §19.3 - Handle connection click (select)
  const handleConnectionClick = useCallback((connectionId: string) => {
    setSelectedConnectionId(prev => prev === connectionId ? null : connectionId);
  }, []);

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
    // Default to expression for new mappings
    onChange({ ...value, [fieldName]: { $expr: '' } });
  }, [value, onChange]);

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

  // §19.3 - Handle connection delete
  const handleConnectionDelete = useCallback((connectionId: string) => {
    const targetField = connectionId.split('->')[1];
    if (targetField) {
      handleRemoveMapping(targetField);
      setSelectedConnectionId(null);
    }
  }, [handleRemoveMapping]);

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
      ref={containerRef}
      className="space-y-4 relative"
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
      {/* §19.3 - Visual connection lines overlay */}
      {positionsState.containerRect && (
        <MappingConnectionsOverlay
          connections={connections}
          width={positionsState.containerRect.width}
          height={positionsState.containerRect.height}
          selectedConnectionId={selectedConnectionId}
          onConnectionClick={handleConnectionClick}
          onConnectionDelete={handleConnectionDelete}
          interactive={!disabled}
          disabled={disabled}
        />
      )}

      <div className="flex items-center justify-between">
        <Label className="text-sm font-semibold">Input Mapping</Label>
        <div className="flex items-center gap-3">
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
              className="text-xs text-gray-500 hover:text-red-600"
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
                  fieldOptions={fieldOptions}
                  secrets={secrets}
                  stepId={stepId}
                  disabled={disabled}
                />
                <button
                  onClick={() => handleRemoveMapping(field.name)}
                  className={`absolute -right-2 -top-2 p-1 bg-white border border-gray-200 rounded-full shadow-sm transition-opacity hover:bg-red-50 hover:border-red-200 ${
                    isFocused ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                  }`}
                  title="Remove mapping (Delete/Backspace)"
                  disabled={disabled}
                  tabIndex={-1}
                >
                  <Trash2 className="w-3.5 h-3.5 text-gray-500 hover:text-red-600" />
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
                      <span className="text-sm text-gray-700">{field.name}</span>
                      {field.required && (
                        <Badge className="text-xs bg-red-100 text-red-700">required</Badge>
                      )}
                      <span className="text-xs text-gray-400">{field.type}</span>
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
