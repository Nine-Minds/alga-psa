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

import { WORKFLOW_CAUGHT_ERROR_SCHEMA } from '@alga-psa/workflows/authoring';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Maximize2 } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { ExpressionEditor, type ExpressionEditorHandle, type ExpressionContext, type JsonSchema } from './ExpressionEditor';
import type { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { WorkflowInsertFieldPicker } from '../mapping/WorkflowFieldPicker';
import { Label } from '@alga-psa/ui/components/Label';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { ExpressionSyntaxHelp } from './ExpressionSyntaxHelp';
import { ExpressionPreview } from './ExpressionPreview';

const LINE_HEIGHT_PX = 18;
const EDITOR_PADDING_PX = 24;
const MAX_INLINE_HEIGHT_PX = 320;
const APPROX_CHARS_PER_LINE = 40;

/** Inline editor height that grows with the expression, from `minHeight` up to a cap. */
export const getAutoGrowEditorHeight = (value: string, minHeight: number): number => {
  const visualLines = value
    .split('\n')
    .reduce((count, line) => count + Math.max(1, Math.ceil(line.length / APPROX_CHARS_PER_LINE)), 0);
  return Math.min(MAX_INLINE_HEIGHT_PX, Math.max(minHeight, EDITOR_PADDING_PX + visualLines * LINE_HEIGHT_PX));
};

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
  /** Show the collapsible syntax cheat-sheet under the editor */
  showSyntaxHelp?: boolean;
  /** Sample workflow data; when given, a preview of the result is shown */
  sampleContext?: Record<string, unknown>;
  /** Offer a larger editor in a dialog (multi-line editors only) */
  expandable?: boolean;
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
    errorSchema: dataContext.inCatchBlock ? (WORKFLOW_CAUGHT_ERROR_SCHEMA as unknown as JsonSchema) : undefined,
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
  placeholder,
  error,
  description,
  disabled = false,
  className = '',
  showFieldPicker = true,
  showSyntaxHelp = true,
  sampleContext,
  expandable = true,
}) => {
  const { t } = useTranslation('msp/workflows');
  const editorRef = useRef<ExpressionEditorHandle>(null);
  const expandedEditorRef = useRef<ExpressionEditorHandle>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const canExpand = expandable && !singleLine;
  const inlineHeight = singleLine
    ? height
    : getAutoGrowEditorHeight(value, typeof height === 'number' ? height : 96);
  const resolvedPlaceholder = placeholder ?? t('expressionEditor.field.placeholder', { defaultValue: 'Enter expression...' });

  // Build expression context from data context
  const expressionContext = useMemo(
    () => buildExpressionContext(dataContext),
    [dataContext]
  );

  const localNames = useMemo(
    () => [dataContext?.forEachItemVar, dataContext?.forEachIndexVar].filter((name): name is string => Boolean(name)),
    [dataContext?.forEachIndexVar, dataContext?.forEachItemVar]
  );

  // Handle field picker selection
  const handleInsert = useCallback((path: string) => {
    if (!path) return;
    editorRef.current?.insertAtCursor(path);
  }, []);
  const handleExpandedInsert = useCallback((path: string) => {
    if (!path) return;
    expandedEditorRef.current?.insertAtCursor(path);
  }, []);

  return (
    <div className={`space-y-2 ${className}`}>
      {/* Header with label and field picker */}
      {(label || showFieldPicker || canExpand) && (
        <div className="flex items-center justify-between gap-2">
          {label && (
            <Label htmlFor={`${idPrefix}-expr`}>{label}</Label>
          )}
          {canExpand && (
            <Button
              id={`${idPrefix}-expand`}
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setIsExpanded(true)}
              disabled={disabled}
              title={t('expressionEditor.field.expand', { defaultValue: 'Open a larger editor' })}
            >
              <Maximize2 className="mr-1 h-3.5 w-3.5" />
              {t('expressionEditor.field.expandShort', { defaultValue: 'Expand' })}
            </Button>
          )}
          {showFieldPicker && (
            <div className="w-56">
              <WorkflowInsertFieldPicker
                id={`${idPrefix}-picker`}
                fieldOptions={fieldOptions}
                localNames={localNames}
                onInsert={handleInsert}
                disabled={disabled}
              />
            </div>
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
        height={inlineHeight}
        placeholder={resolvedPlaceholder}
        disabled={disabled}
        hasError={!!error}
        ariaLabel={label}
        idPrefix={idPrefix}
      />

      {/* Error message */}
      {error && (
        <div className="text-xs text-destructive">{error}</div>
      )}

      {/* Description */}
      {description && !error && (
        <div className="text-xs text-gray-500">{description}</div>
      )}

      {!isExpanded && <ExpressionPreview idPrefix={idPrefix} expression={value} sampleContext={sampleContext} />}

      {showSyntaxHelp && <ExpressionSyntaxHelp idPrefix={idPrefix} />}

      {canExpand && (
        <Dialog
          id={`${idPrefix}-expanded-dialog`}
          isOpen={isExpanded}
          onClose={() => setIsExpanded(false)}
          title={label || t('expressionEditor.field.expandedTitle', { defaultValue: 'Edit expression' })}
          className="max-w-4xl"
          allowOverflow
          footer={(
            <div className="flex justify-end">
              <Button id={`${idPrefix}-expanded-done`} type="button" onClick={() => setIsExpanded(false)}>
                {t('expressionEditor.field.done', { defaultValue: 'Done' })}
              </Button>
            </div>
          )}
        >
          <DialogContent>
            <div className="space-y-3">
              {showFieldPicker && (
                <div className="flex justify-end">
                  <div className="w-64">
                    <WorkflowInsertFieldPicker
                      id={`${idPrefix}-expanded-picker`}
                      fieldOptions={fieldOptions}
                      localNames={localNames}
                      onInsert={handleExpandedInsert}
                      disabled={disabled}
                    />
                  </div>
                </div>
              )}
              <ExpressionEditor
                ref={expandedEditorRef}
                value={value}
                onChange={onChange}
                context={expressionContext}
                singleLine={false}
                height={320}
                placeholder={resolvedPlaceholder}
                disabled={disabled}
                hasError={!!error}
                ariaLabel={label}
                idPrefix={`${idPrefix}-expanded`}
              />
              {error && <div className="text-xs text-destructive">{error}</div>}
              <ExpressionPreview idPrefix={`${idPrefix}-expanded`} expression={value} sampleContext={sampleContext} />
              {showSyntaxHelp && <ExpressionSyntaxHelp idPrefix={`${idPrefix}-expanded`} defaultOpen />}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};

export default ExpressionEditorField;
