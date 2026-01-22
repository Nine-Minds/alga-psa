'use client';

/**
 * Expression Editor Field
 *
 * A form-field compatible wrapper around ExpressionEditor that provides:
 * - Field picker integration
 * - Label support
 * - Error state display
 * - Schema context from DataContext
 *
 * This component bridges the old ExpressionTextArea API to the new Monaco-based editor.
 */

import React, { useCallback, useMemo, useRef } from 'react';
import { ExpressionEditor, type ExpressionEditorHandle, type ExpressionContext, type JsonSchema } from './ExpressionEditor';
import type { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Label } from '@alga-psa/ui/components/Label';

/**
 * Data context for building schema from SelectOptions
 */
export interface DataContextInfo {
  /** The payload schema */
  payloadSchema?: JsonSchema | null;
  /** Schema for vars built from step outputs */
  varsSchema?: JsonSchema | null;
  /** Whether in a catch block (error context available) */
  inCatchBlock?: boolean;
  /** ForEach item variable name */
  forEachItemVar?: string;
  /** ForEach item schema */
  forEachItemSchema?: JsonSchema | null;
  /** ForEach index variable name */
  forEachIndexVar?: string;
}

/**
 * Props for the ExpressionEditorField component
 */
export interface ExpressionEditorFieldProps {
  /** Unique ID prefix for the field */
  idPrefix: string;
  /** Label text */
  label?: string;
  /** Current expression value */
  value: string;
  /** Called when the expression changes */
  onChange: (value: string) => void;
  /** Field options for the field picker dropdown */
  fieldOptions: SelectOption[];
  /** Data context containing schemas for autocomplete */
  dataContext?: DataContextInfo;
  /** Whether to show a single line editor */
  singleLine?: boolean;
  /** Editor height (only used in multi-line mode) */
  height?: number;
  /** Placeholder text */
  placeholder?: string;
  /** Error message to display */
  error?: string;
  /** Description text */
  description?: string;
  /** Whether the field is disabled */
  disabled?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Show the field picker dropdown */
  showFieldPicker?: boolean;
}

/**
 * Build ExpressionContext from DataContextInfo
 */
function buildExpressionContext(dataContext?: DataContextInfo): ExpressionContext {
  if (!dataContext) {
    return {};
  }

  return {
    payloadSchema: dataContext.payloadSchema ?? undefined,
    varsSchema: dataContext.varsSchema ?? undefined,
    metaSchema: {
      type: 'object',
      properties: {
        state: { type: 'string', description: 'Workflow state' },
        traceId: { type: 'string', description: 'Trace ID' },
        tags: { type: 'object', description: 'Workflow tags' },
      },
    },
    errorSchema: dataContext.inCatchBlock ? {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Error name' },
        message: { type: 'string', description: 'Error message' },
        stack: { type: 'string', description: 'Stack trace' },
        nodePath: { type: 'string', description: 'Error location in workflow' },
      },
    } : undefined,
    inCatchBlock: dataContext.inCatchBlock,
    forEachItemVar: dataContext.forEachItemVar,
    forEachItemSchema: dataContext.forEachItemSchema ?? undefined,
    forEachIndexVar: dataContext.forEachIndexVar,
  };
}

/**
 * ExpressionEditorField Component
 *
 * A form-field wrapper around ExpressionEditor with field picker integration.
 */
export const ExpressionEditorField: React.FC<ExpressionEditorFieldProps> = ({
  idPrefix,
  label,
  value,
  onChange,
  fieldOptions,
  dataContext,
  singleLine = true,
  height,
  placeholder = 'Enter expression...',
  error,
  description,
  disabled = false,
  className = '',
  showFieldPicker = true,
}) => {
  const editorRef = useRef<ExpressionEditorHandle>(null);

  // Build expression context from data context
  const expressionContext = useMemo(
    () => buildExpressionContext(dataContext),
    [dataContext]
  );

  // Handle field picker selection
  const handleInsert = useCallback((path: string) => {
    if (!path) return;
    editorRef.current?.insertAtCursor(path);
  }, []);

  return (
    <div className={`space-y-2 ${className}`}>
      {/* Header with label and field picker */}
      {(label || showFieldPicker) && (
        <div className="flex items-center justify-between">
          {label && (
            <Label htmlFor={`${idPrefix}-expr`}>{label}</Label>
          )}
          {showFieldPicker && (
            <CustomSelect
              id={`${idPrefix}-picker`}
              options={fieldOptions}
              value=""
              placeholder="Insert field"
              onValueChange={handleInsert}
              allowClear
              className="w-44"
            />
          )}
        </div>
      )}

      {/* Expression Editor */}
      <ExpressionEditor
        ref={editorRef}
        value={value}
        onChange={onChange}
        context={expressionContext}
        singleLine={singleLine}
        height={height}
        placeholder={placeholder}
        disabled={disabled}
        hasError={!!error}
        ariaLabel={label}
      />

      {/* Error message */}
      {error && (
        <div className="text-xs text-red-600">{error}</div>
      )}

      {/* Description */}
      {description && !error && (
        <div className="text-xs text-gray-500">{description}</div>
      )}
    </div>
  );
};

export default ExpressionEditorField;
