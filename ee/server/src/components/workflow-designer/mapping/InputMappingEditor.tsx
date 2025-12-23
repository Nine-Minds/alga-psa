'use client';

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { ChevronRight, ChevronDown, Plus, Trash2, Code, Key, Type, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { TextArea } from '@/components/ui/TextArea';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Label } from '@/components/ui/Label';
import CustomSelect, { SelectOption } from '@/components/ui/CustomSelect';
import { validateExpressionSource } from '@shared/workflow/runtime/expressionEngine';
import { listTenantSecrets } from 'server/src/lib/actions/tenant-secret-actions';
import type { InputMapping, MappingValue, Expr } from '@shared/workflow/runtime';

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
                <CustomSelect
                  id={`${idPrefix}-picker`}
                  options={fieldOptions}
                  value=""
                  placeholder="Insert field"
                  onValueChange={handleInsertField}
                  allowClear
                  className="w-44"
                  disabled={disabled}
                />
              </div>
              <TextArea
                id={`${idPrefix}-expr`}
                value={getDisplayValue(value)}
                onChange={(e) => handleExpressionChange(e.target.value)}
                rows={2}
                placeholder="Enter JSONata expression..."
                className={expressionError ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : ''}
                disabled={disabled}
              />
              {expressionError && (
                <div className="flex items-center gap-1 text-xs text-red-600">
                  <AlertTriangle className="w-3 h-3" />
                  {expressionError}
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
  disabled
}) => {
  const [secrets, setSecrets] = useState<Array<{ name: string; description?: string }>>([]);
  const [showUnmapped, setShowUnmapped] = useState(true);

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

  if (targetFields.length === 0) {
    return (
      <div className="text-sm text-gray-500 p-3 bg-gray-50 rounded border border-gray-200">
        This action has no input fields to map.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-semibold">Input Mapping</Label>
        <div className="text-xs text-gray-500">
          {Object.keys(value).length} / {targetFields.length} fields mapped
        </div>
      </div>

      {/* Mapped fields */}
      {mappedFields.length > 0 && (
        <div className="space-y-2">
          {mappedFields.map(field => (
            <div key={field.name} className="relative group">
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
                className="absolute -right-2 -top-2 p-1 bg-white border border-gray-200 rounded-full shadow-sm opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-50 hover:border-red-200"
                title="Remove mapping"
                disabled={disabled}
              >
                <Trash2 className="w-3.5 h-3.5 text-gray-500 hover:text-red-600" />
              </button>
            </div>
          ))}
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
            <div className="space-y-1 pl-5">
              {unmappedFields.map(field => (
                <div
                  key={field.name}
                  className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-gray-50"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-700">{field.name}</span>
                    {field.required && (
                      <Badge className="text-xs bg-red-100 text-red-700">required</Badge>
                    )}
                    <span className="text-xs text-gray-400">{field.type}</span>
                  </div>
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
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default InputMappingEditor;
