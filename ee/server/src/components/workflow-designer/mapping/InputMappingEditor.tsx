'use client';

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { ChevronRight, ChevronDown, Plus, Trash2, AlertTriangle, Wand2, Sparkles, RotateCcw, Expand } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Card } from '@alga-psa/ui/components/Card';
import { Badge } from '@alga-psa/ui/components/Badge';
import { SearchableSelect, type SelectOption as SearchableSelectOption } from '@alga-psa/ui/components/SearchableSelect';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
} from '@alga-psa/ui/components/Dialog';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { InputMapping, MappingValue, Expr } from '@alga-psa/workflows/runtime';
import {
  useWorkflowEntityTypeOptions,
  useWorkflowLinkRelationOptions,
} from '@alga-psa/workflows/hooks/useWorkflowEnumOptions';
import { listWorkflowDataStoreNamespacesAction } from '@alga-psa/workflows/actions';
import {
  ExpressionEditorField,
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
import {
  WORKFLOW_FIXED_PICKER_MULTI_RESOURCES,
  WorkflowActionInputFixedMultiPicker,
  WorkflowActionInputFixedPicker,
} from '../WorkflowActionInputFixedPicker';
import { renderWorkflowCustomLiteralEditor } from './workflowCustomLiteralEditor';
import { buildReferenceExpression, getOneItemListReferencePath, getReferenceExpressionType } from './referenceValue';
import {
  findAutoMappingSuggestions,
  selectBulkApplicableSuggestions,
  isStrongSuggestion,
  type AutoMappingSuggestion,
} from './autoMappingSuggestions';
import { getTextTemplateScope, textTemplateFromValue } from './textTemplate';
import { WorkflowTextTemplateEditor } from './WorkflowTextTemplateEditor';
import { WorkflowValueSourceChooser } from './WorkflowValueSourceChooser';
import { countMissingRequiredInputs, isMappingValueSet } from './mappingValueState';
import { isWorkflowFreeTextInput, isWorkflowMultilineTextInput } from './workflowTextInput';
import { humanizeWorkflowRecordKind, takesAnArticle } from '../workflowFieldNames';
import {
  WorkflowPickableFieldsContext,
  buildWorkflowPickableFields,
  useWorkflowFieldOriginLabels,
  type WorkflowPickableField,
} from './WorkflowFieldPicker';
import { buildWorkflowSampleContext } from './sampleContext';
import {
  buildDefaultWorkflowActionInputLiteralValue,
  createWorkflowActionInputValueForMode,
  deriveWorkflowActionInputSourceMode,
  getDefaultWorkflowActionInputSourceMode,
  isWorkflowActionInputLegacyValue,
  transitionWorkflowActionInputMode,
  type WorkflowActionInputSourceModeValue,
} from '../WorkflowActionInputSourceMode';
import { useQuickAsk } from 'server/src/components/layout/QuickAskContext';
import {
  UpdatePatchSection,
  buildWorkflowUpdateTargetPhrase,
  isEditableWorkflowPatchValue,
  isWorkflowUpdatePatchField,
} from './UpdatePatchSection';
import {
  ReferenceScopeSelector,
  buildReferenceSourceModel,
  deriveReferenceScope,
  extractPrimaryPath,
  inferTypeFromPath,
  type ReferenceSourceScope,
} from '../workflowReferenceSelector';

/**
 * Build ExpressionContext from SelectOption[] for the Monaco expression editor
 *
 * @param fieldOptions - Available field options from data context
 * @returns ExpressionContext for the expression editor
 */
const isRegexTransformActionId = (actionId?: string): boolean =>
  actionId === 'transform.regex_match' ||
  actionId === 'transform.regex_extract' ||
  actionId === 'transform.regex_replace';

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
 * Schema field definition for target action inputs
 */
export interface ActionInputField {
  name: string;
  type: string;
  nullable?: boolean;
  description?: string;
  required?: boolean;
  examples?: unknown[];
  editor?: {
    kind: 'text' | 'picker' | 'color' | 'json' | 'custom';
    inline?: {
      mode: 'input' | 'textarea' | 'picker-summary' | 'swatch';
    };
    dialog?: {
      mode: 'large-text';
    };
    dependencies?: string[];
    fixedValueHint?: string;
    allowsDynamicReference?: boolean;
    picker?: {
      resource: string;
    };
    softEnum?: import('@alga-psa/shared/workflow/runtime').WorkflowEditorSoftEnumMetadata;
    custom?: import('@alga-psa/shared/workflow/runtime').WorkflowEditorJsonSchemaMetadata['custom'];
  };
  /** Plain-language labels for enum options, from schema metadata. */
  optionLabels?: Record<string, string>;
  /** For not-found style inputs: the option value that fails the step (so a Catch can handle it). */
  failurePolicy?: { failValue: string };
  /** The author must pick an option themselves (e.g. comment visibility); see withWorkflowExplicitChoice. */
  explicitChoice?: { prompt: string };
  picker?: {
    kind: string;
    dependencies?: string[];
    fixedValueHint?: string;
    allowsDynamicReference?: boolean;
  };
  presentation?: {
    inputControl?: 'multiline';
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

const getWorkflowFieldEditor = (field: ActionInputField): NonNullable<ActionInputField['editor']> | undefined => {
  if (field.editor) {
    return field.editor;
  }

  if (field.picker?.kind) {
    return {
      kind: 'picker',
      inline: { mode: 'picker-summary' },
      dependencies: field.picker.dependencies,
      fixedValueHint: field.picker.fixedValueHint,
      allowsDynamicReference: field.picker.allowsDynamicReference,
      picker: {
        resource: field.picker.kind,
      },
    };
  }

  if (field.presentation?.inputControl === 'multiline') {
    return {
      kind: 'text',
      inline: { mode: 'textarea' },
    };
  }

  return undefined;
};

/** Entity kind of each source path, shared with every field editor below an InputMappingEditor. */
const SourceKindContext = React.createContext<Map<string, string> | undefined>(undefined);

/** Free-text inputs are edited as "text with fields" (see workflowTextInput). */
const isPlainTextField = (field: ActionInputField): boolean => isWorkflowFreeTextInput(field);

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
   * Registry action id for contextual guidance affordances.
   */
  actionId?: string;

  /**
   * §19.3 - Shared position handlers from MappingPanel
   */
  positionsHandlers?: MappingPositionsHandlers;

  /**
   * §19.1 - Source field type lookup for compatibility indicators
   */
  sourceTypeMap?: Map<string, string>;
  /** Entity kind (contact, user, client…) of each source path, from schema metadata. */
  sourceKindMap?: Map<string, string>;

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
type ValueType = 'reference' | 'fixed' | 'expression' | 'legacy';

/**
 * Determine the type of a MappingValue
 */
function getMappingValueType(value: MappingValue | undefined): ValueType {
  if (!value) return 'fixed';
  if (typeof value === 'object' && value !== null) {
    if ('$secret' in value) return 'legacy';
    if ('$expr' in value) {
      return isWorkflowActionInputLegacyValue(value) ? 'expression' : 'reference';
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
 * Editor for a single mapping field
 */
export const MappingFieldEditor: React.FC<{
  field: ActionInputField;
  fieldPath?: string;
  value: MappingValue | undefined;
  onChange: (value: MappingValue | undefined) => void;
  rootInputMapping: InputMapping;
  fieldOptions: SelectOption[];
  stepId: string;
  actionId?: string;
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
  actionId,
  disabled,
  sourceTypeMap,
  expressionContext,
  referenceBrowseContext,
}) => {
  const { t } = useTranslation('msp/workflows');
  const { aiAssistantAvailable, openQuickAsk } = useQuickAsk();
  const [expanded, setExpanded] = useState(true);
  const [preservedFixedValue, setPreservedFixedValue] = useState<MappingValue | undefined>(() =>
    deriveWorkflowActionInputSourceMode(value).mode === 'fixed' ? value : undefined
  );
  const [preservedReferenceValue, setPreservedReferenceValue] = useState<MappingValue | undefined>(() =>
    deriveWorkflowActionInputSourceMode(value).mode === 'reference' ? value : undefined
  );
  const [preservedExpressionValue, setPreservedExpressionValue] = useState<MappingValue | undefined>(() =>
    deriveWorkflowActionInputSourceMode(value).mode === 'expression' ? value : undefined
  );
  const [manualMode, setManualMode] = useState<WorkflowActionInputSourceModeValue | null>(null);
  const [modeChangeNotice, setModeChangeNotice] = useState<string | null>(null);
  const valueType = useMemo(() => getMappingValueType(value), [value]);
  // An empty `{ $expr: '' }` derives as 'reference', so an explicit user choice of
  // Expression/Reference must win until the value is unambiguous (literal/secret).
  const expressionSampleContext = useMemo(
    () => buildWorkflowSampleContext(referenceBrowseContext) as unknown as Record<string, unknown>,
    [referenceBrowseContext]
  );
  const plainTextField = isPlainTextField(field);
  const textScope = useMemo(() => getTextTemplateScope(referenceBrowseContext?.forEach), [referenceBrowseContext?.forEach]);
  const textTemplate = useMemo(
    () => (plainTextField ? textTemplateFromValue(value, textScope) : null),
    [plainTextField, textScope, value]
  );
  const effectiveValueType: ValueType = useMemo(() => {
    if (valueType === 'legacy') return 'legacy';
    const derived = deriveWorkflowActionInputSourceMode(value).mode;
    // Text joined with fields ("Hi " & payload.name) reads as text with fields, unless the user
    // chose the Expression editor.
    const readsAsText = plainTextField && derived === 'expression' && textTemplate !== null;
    return (manualMode ?? (readsAsText ? 'fixed' : derived)) as ValueType;
  }, [valueType, value, manualMode, plainTextField, textTemplate]);

  const resolvedFieldPath = fieldPath ?? field.name;
  const idPrefix = `mapping-${stepId}-${resolvedFieldPath}`;
  const sourceKindMap = React.useContext(SourceKindContext);
  const originLabels = useWorkflowFieldOriginLabels();
  // One labelled list of the fields this input can read: the source control and every Insert field
  // picker below it use it.
  const pickableFields = useMemo<WorkflowPickableField[]>(
    () => buildWorkflowPickableFields(fieldOptions, referenceBrowseContext, originLabels, {
      typeOf: (path) => sourceTypeMap?.get(path) ?? inferTypeFromPath(path),
      kindOf: (path) => sourceKindMap?.get(path),
    }),
    [fieldOptions, originLabels, referenceBrowseContext, sourceKindMap, sourceTypeMap]
  );
  const isMissingRequired = useMemo(
    () => countMissingRequiredInputs([field], { [field.name]: value } as InputMapping) > 0,
    [field, value]
  );
  const showJsonataAskAi =
    aiAssistantAvailable &&
    actionId === 'transform.query_json' &&
    field.name === 'expression';
  const isRegexTransformAction = isRegexTransformActionId(actionId);
  const showRegexAskAi =
    aiAssistantAvailable &&
    isRegexTransformAction &&
    (field.name === 'pattern' || field.name === 'replacement');

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
    setModeChangeNotice(null);
    if (plainTextField) {
      const valueIsExpr = value !== null && typeof value === 'object' && '$expr' in value;
      // Text and Expression are two views of the same value: switching converts, never clears.
      if (nextMode === 'fixed' && valueIsExpr) {
        const source = String((value as Expr).$expr ?? '').trim();
        if (!source) {
          // Nothing to convert: bring back the text from before the switch, if any.
          setManualMode('fixed');
          onChange(preservedFixedValue ?? '');
          return;
        }
        if (textTemplate !== null) {
          setManualMode('fixed');
          return;
        }
        if (effectiveValueType === 'expression') {
          setModeChangeNotice(t('inputMappingEditor.textModeUnavailable', {
            defaultValue: 'This expression does more than join text and fields, so it can only be edited as an expression. Clear it to start again as text.',
          }));
          return;
        }
      }
      if (nextMode === 'expression' && effectiveValueType === 'fixed') {
        setPreservedFixedValue(value);
        setManualMode('expression');
        if (typeof value === 'string') {
          onChange({ $expr: value ? JSON.stringify(value) : '' });
        } else if (!valueIsExpr) {
          onChange({ $expr: '' });
        }
        return;
      }
    }
    const transition = transitionWorkflowActionInputMode(
      field,
      value,
      nextMode,
      {
        // Text with fields is saved as an expression; keep it as the value to return to in Text mode.
        preservedFixedValue: plainTextField && effectiveValueType === 'fixed' ? value : preservedFixedValue,
        preservedReferenceValue,
        preservedExpressionValue,
      }
    );
    setPreservedFixedValue(transition.preservedFixedValue);
    setPreservedReferenceValue(transition.preservedReferenceValue);
    setPreservedExpressionValue(transition.preservedExpressionValue);
    setManualMode(nextMode);
    onChange(transition.nextValue);
  }, [effectiveValueType, field, onChange, plainTextField, preservedFixedValue, preservedReferenceValue, preservedExpressionValue, t, textTemplate, value, valueType]);

  const handleLiteralChange = useCallback((literalValue: unknown) => {
    onChange(literalValue as MappingValue);
  }, [onChange]);

  const resolvePathType = useCallback(
    (path: string) => sourceTypeMap?.get(path) ?? inferTypeFromPath(path),
    [sourceTypeMap]
  );
  const resolveReferenceType = useCallback(
    (expression: string | undefined) => {
      const listType = getReferenceExpressionType(expression, resolvePathType);
      if (listType) return listType;
      const path = extractPrimaryPath(expression);
      return path ? resolvePathType(path) : undefined;
    },
    [resolvePathType]
  );
  const targetTypeForReference = field.type === 'array' && field.constraints?.itemType
    && field.constraints.itemType !== 'unknown' && field.constraints.itemType !== 'any'
    ? `array<${field.constraints.itemType}>`
    : field.type;

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

    const sourceType = resolveReferenceType(expr);

    // Get target type
    const targetType = targetTypeForReference;

    if (!sourceType || !targetType) return null;

    return getWorkflowActionInputTypeHint(sourceType, targetType);
  }, [valueType, value, field.type, resolveReferenceType, targetTypeForReference]);

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

    const sourceType = resolveReferenceType(expr);
    if (!field.type) return null;

    const compatibility = getTypeCompatibility(sourceType, targetTypeForReference);
    if (compatibility === TypeCompatibility.EXACT) return null;
    const classes = getCompatibilityClasses(compatibility);

    return {
      label: getCompatibilityLabel(compatibility),
      classes,
      sourceType,
      targetType: field.type
    };
  }, [valueType, value, field.type, resolveReferenceType, targetTypeForReference]);

  const [showBrowseSources, setShowBrowseSources] = useState(false);
  const currentSourceMode = effectiveValueType === 'legacy' ? deriveWorkflowActionInputSourceMode(value).mode : effectiveValueType;
  const selectedReferencePath = currentSourceMode === 'reference' ? extractPrimaryPath(getDisplayValue(value)) : null;
  const referenceSourceModel = useMemo(
    () => buildReferenceSourceModel(referenceBrowseContext, fieldOptions, expressionContext?.payloadSchema, {
      firstItem: t('inputMappingEditor.reference.firstItem', { defaultValue: '(first item)' }),
      lastItem: t('inputMappingEditor.reference.lastItem', { defaultValue: '(last item)' }),
      wholeResult: t('inputMappingEditor.reference.wholeResult', { defaultValue: 'Entire result' }),
    }),
    [expressionContext?.payloadSchema, referenceBrowseContext, fieldOptions, t]
  );
  const [selectedReferenceScope, setSelectedReferenceScope] = useState<ReferenceSourceScope | ''>(() =>
    deriveReferenceScope(selectedReferencePath, referenceBrowseContext).scope
  );
  const [selectedReferenceStep, setSelectedReferenceStep] = useState(() =>
    deriveReferenceScope(selectedReferencePath, referenceBrowseContext).step
  );

  // Picking a field happens in the source control; step-by-step browsing (scope → step → field, and
  // the data tree) opens on request, or by itself while a reference has no field yet.
  const browseOpen = currentSourceMode === 'reference' && (showBrowseSources || !selectedReferencePath);

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
    onChange({ $expr: buildReferenceExpression(path, resolvePathType(path), targetTypeForReference) });
    setShowBrowseSources(false);
  }, [onChange, resolvePathType, targetTypeForReference]);

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
    onChange({ $expr: buildReferenceExpression(path, resolvePathType(path), targetTypeForReference) });
  }, [onChange, resolvePathType, targetTypeForReference]);

  return (
    <WorkflowPickableFieldsContext.Provider value={pickableFields}>
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
        {showJsonataAskAi || showRegexAskAi ? (
          <button
            id={`${idPrefix}-ask-ai`}
            type="button"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium text-[rgb(var(--color-primary-700))] transition-colors hover:text-[rgb(var(--color-primary-900))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--color-primary-500))] focus:ring-offset-2 dark:text-[rgb(var(--color-primary-300))] dark:hover:text-[rgb(var(--color-primary-200))]"
            title={t('inputMappingEditor.askAi.shortcutHint', { defaultValue: showRegexAskAi ? 'Open Quick Ask for regex guidance' : 'Open Quick Ask for JSONata guidance' })}
            aria-label={t('inputMappingEditor.askAi.ariaLabel', { defaultValue: showRegexAskAi ? 'Ask AI for regex help' : 'Ask AI for JSONata help' })}
            onClick={openQuickAsk}
            disabled={disabled}
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>{t('inputMappingEditor.askAi.title', { defaultValue: 'Ask AI' })}</span>
          </button>
        ) : null}
      </div>

      {expanded && (
        <div className="space-y-3 pl-2">
          {effectiveValueType !== 'legacy' && (
            <WorkflowValueSourceChooser
              idPrefix={idPrefix}
              target={field}
              fields={pickableFields}
              mode={effectiveValueType}
              selectedPath={selectedReferencePath}
              isPlainText={plainTextField}
              onChooseField={(_path, expression) => {
                setModeChangeNotice(null);
                setManualMode('reference');
                onChange({ $expr: expression });
              }}
              onChooseMode={handleSourceModeChange}
              disabled={disabled}
            />
          )}
          {modeChangeNotice && (
            <p id={`${idPrefix}-mode-notice`} className="text-[11px] text-[rgb(var(--color-text-500))]" role="status">
              {modeChangeNotice}
            </p>
          )}
          {effectiveValueType === 'reference' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Button
                  id={`${idPrefix}-browse-sources-toggle`}
                  variant="ghost"
                  size="sm"
                  type="button"
                  disabled={disabled}
                  aria-expanded={showBrowseSources}
                  onClick={() => setShowBrowseSources((current) => !current)}
                  className="h-7 px-2 text-xs text-gray-600 hover:text-gray-900"
                >
                  {showBrowseSources ? (
                    <ChevronDown className="mr-1 h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="mr-1 h-3.5 w-3.5" />
                  )}
                  {t('inputMappingEditor.browseSources', { defaultValue: 'Browse step by step' })}
                </Button>
                {compatibilityBadge && (
                  <Badge
                    className={`text-[10px] ${compatibilityBadge.classes.bg} ${compatibilityBadge.classes.text} ${compatibilityBadge.classes.border}`}
                    title={`${compatibilityBadge.label}: ${compatibilityBadge.sourceType ?? 'unknown'} → ${compatibilityBadge.targetType}`}
                  >
                    {compatibilityBadge.label}
                  </Badge>
                )}
              </div>
              {browseOpen && (
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
              )}
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
                  sourceType={resolveReferenceType((value as Expr).$expr)}
                  targetType={targetTypeForReference}
                />
              )}
              {getOneItemListReferencePath((value as Expr | undefined)?.$expr) && (
                <p id={`${idPrefix}-one-item-list-note`} className="text-[11px] text-[rgb(var(--color-text-500))]">
                  {t('inputMappingEditor.reference.oneItemList', {
                    defaultValue: 'This single value is sent as a one-item list.',
                  })}
                </p>
              )}
            </div>
          )}

          {effectiveValueType === 'legacy' && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 space-y-2">
              <div className="flex items-start gap-2 text-sm text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-medium">
                    {t('inputMappingEditor.legacy.title', { defaultValue: 'Legacy mapping no longer supported here' })}
                  </p>
                  <p className="text-xs text-amber-800">
                    {t('inputMappingEditor.legacy.description', {
                      defaultValue: 'This field uses a saved expression or secret. Replace it with a structured reference or a fixed value.',
                    })}
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
                  {t('inputMappingEditor.legacy.useReference', { defaultValue: 'Use reference' })}
                </Button>
                <Button
                  id={`${idPrefix}-replace-with-fixed`}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  onClick={() => handleSourceModeChange('fixed')}
                >
                  {t('inputMappingEditor.legacy.useFixedValue', { defaultValue: 'Use fixed value' })}
                </Button>
              </div>
            </div>
          )}

          {effectiveValueType === 'expression' && (
            <div className="space-y-2">
              <ExpressionEditorField
                idPrefix={idPrefix}
                value={getDisplayValue(value)}
                onChange={(expr) => onChange({ $expr: expr })}
                fieldOptions={fieldOptions}
                dataContext={{
                  payloadSchema: expressionContext?.payloadSchema ?? null,
                  varsSchema: expressionContext?.varsSchema ?? null,
                  inCatchBlock: expressionContext?.inCatchBlock,
                  forEachItemVar: expressionContext?.forEachItemVar,
                  forEachItemSchema: expressionContext?.forEachItemSchema ?? null,
                  forEachIndexVar: expressionContext?.forEachIndexVar,
                }}
                singleLine={false}
                height={96}
                sampleContext={expressionSampleContext}
                showFieldPicker
                placeholder={t('inputMappingEditor.expression.placeholder', {
                  defaultValue: 'e.g. "Re: " & payload.title',
                })}
                disabled={disabled}
              />
            </div>
          )}

          {effectiveValueType === 'fixed' && (
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
    </WorkflowPickableFieldsContext.Provider>
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

/**
 * The options of a choice the author must make themselves (see withWorkflowExplicitChoice), as
 * buttons under the question. Nothing is preselected.
 */
const ExplicitChoiceOptions: React.FC<{
  id: string;
  field: ActionInputField;
  onChoose: (value: MappingValue) => void;
  disabled?: boolean;
}> = ({ id, field, onChoose, disabled }) => (
  <div id={id} role="group" aria-label={field.explicitChoice?.prompt} className="space-y-1.5">
    <p className="text-xs font-medium text-[rgb(var(--color-text-700))]">{field.explicitChoice?.prompt}</p>
    <div className="flex flex-wrap gap-2">
      {(field.enum ?? []).map((option) => (
        <Button
          key={String(option)}
          id={`${id}-${String(option)}`}
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onChoose(option as MappingValue)}
          className="h-auto whitespace-normal py-1 text-left text-xs"
        >
          {field.optionLabels?.[String(option)] ?? String(option)}
        </Button>
      ))}
    </div>
  </div>
);

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
  const { t } = useTranslation('msp/workflows');
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
          aria-label={expanded
            ? t('inputMappingEditor.structuredGroup.collapseAria', {
              defaultValue: 'Collapse {{title}}',
              title,
            })
            : t('inputMappingEditor.structuredGroup.expandAria', {
              defaultValue: 'Expand {{title}}',
              title,
            })}
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

const FixedValueEditorShell: React.FC<{
  field: ActionInputField;
  idPrefix: string;
  value: MappingValue | undefined;
  onChange: (value: MappingValue) => void;
  disabled?: boolean;
  inlineEditor?: React.ReactNode;
}> = ({ field, idPrefix, value, onChange, disabled, inlineEditor }) => {
  const { t } = useTranslation('msp/workflows');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [draftValue, setDraftValue] = useState('');
  const dialogMode = getWorkflowFieldEditor(field)?.dialog?.mode;

  useEffect(() => {
    if (!isDialogOpen) return;
    setDraftValue(typeof value === 'string' ? value : '');
  }, [isDialogOpen, value]);

  const hasDialogEditor = dialogMode === 'large-text';

  if (!hasDialogEditor) {
    return <>{inlineEditor}</>;
  }

  const openDialog = () => setIsDialogOpen(true);
  const closeDialog = () => setIsDialogOpen(false);
  const applyDialogValue = () => {
    onChange(draftValue);
    closeDialog();
  };

  return (
    <>
      <div className="space-y-2">
        {inlineEditor}
        <div className="flex justify-end">
          <Button
            id={`${idPrefix}-dialog-open`}
            type="button"
            variant="outline"
            size="sm"
            onClick={openDialog}
            disabled={disabled}
            className="gap-1"
          >
            <Expand className="h-3.5 w-3.5" />
            {t('inputMappingEditor.fixedValueDialog.openEditor', { defaultValue: 'Open editor' })}
          </Button>
        </div>
      </div>
      <Dialog
        id={`${idPrefix}-dialog`}
        isOpen={isDialogOpen}
        onClose={closeDialog}
        title={t('inputMappingEditor.fixedValueDialog.title', {
          defaultValue: 'Edit {{fieldName}}',
          fieldName: field.name,
        })}
        className="max-w-4xl"
        footer={(
          <div className="flex justify-end space-x-2">
            <Button
              id={`${idPrefix}-dialog-cancel`}
              type="button"
              variant="outline"
              onClick={closeDialog}
              disabled={disabled}
            >
              {t('inputMappingEditor.fixedValueDialog.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              id={`${idPrefix}-dialog-save`}
              type="button"
              onClick={applyDialogValue}
              disabled={disabled}
            >
              {t('inputMappingEditor.fixedValueDialog.apply', { defaultValue: 'Apply' })}
            </Button>
          </div>
        )}
      >
        <DialogContent>
          <DialogHeader>
            <DialogDescription>
              {t('inputMappingEditor.fixedValueDialog.description', {
                defaultValue: 'Use the larger editor for longer fixed-value content.',
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <TextArea
              id={`${idPrefix}-dialog-textarea`}
              value={draftValue}
              onChange={(event) => setDraftValue(event.target.value)}
              rows={18}
              disabled={disabled}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

// Cached once per session so the namespace combobox does not re-fetch for every
// field instance / re-render. Failures fall back to free-text-only (empty list).
let workflowDataStoreNamespacesPromise: Promise<string[]> | null = null;
const loadWorkflowDataStoreNamespaces = (): Promise<string[]> => {
  if (!workflowDataStoreNamespacesPromise) {
    workflowDataStoreNamespacesPromise = Promise.resolve()
      .then(() => listWorkflowDataStoreNamespacesAction())
      .catch(() => [] as string[]);
  }
  return workflowDataStoreNamespacesPromise;
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
  const { t } = useTranslation('msp/workflows');
  const workflowEntityTypeOptions = useWorkflowEntityTypeOptions();
  const workflowLinkRelationOptions = useWorkflowLinkRelationOptions();
  const fieldEditor = getWorkflowFieldEditor(field);
  const inlineEditorMode = fieldEditor?.inline?.mode;
  const hasPickerEditor = fieldEditor?.kind === 'picker' && inlineEditorMode === 'picker-summary';
  const sampleContext = useMemo(
    () => buildWorkflowSampleContext(referenceBrowseContext) as unknown as Record<string, unknown>,
    [referenceBrowseContext]
  );
  const textScope = useMemo(() => getTextTemplateScope(referenceBrowseContext?.forEach), [referenceBrowseContext?.forEach]);
  const softEnum = fieldEditor?.softEnum;
  const isNamespaceSoftEnum =
    softEnum?.component === 'soft-enum-combobox' &&
    softEnum?.suggestionKind === 'workflow-data-store-namespace' &&
    (softEnum?.suggestionActionIds?.length ?? 0) > 0;
  const [dynamicNamespaceOptions, setDynamicNamespaceOptions] = useState<string[]>([]);
  useEffect(() => {
    if (!isNamespaceSoftEnum) return;
    let active = true;
    loadWorkflowDataStoreNamespaces().then((namespaces) => {
      if (active) setDynamicNamespaceOptions(namespaces);
    });
    return () => {
      active = false;
    };
  }, [isNamespaceSoftEnum]);
  const pickerResource = fieldEditor?.picker?.resource;
  const hasMultiUserPickerEditor =
    hasPickerEditor &&
    fieldType === 'array' &&
    Boolean(pickerResource && WORKFLOW_FIXED_PICKER_MULTI_RESOURCES.has(pickerResource)) &&
    fieldConstraints?.itemType === 'string';
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
  const [isEditingPrimitiveList, setIsEditingPrimitiveList] = useState(false);
  const [showCustomEditorFields, setShowCustomEditorFields] = useState(false);
  const customEditorComponent = fieldEditor?.kind === 'custom' ? fieldEditor.custom?.component : undefined;
  const customLiteralEditor = customEditorComponent
    ? renderWorkflowCustomLiteralEditor(customEditorComponent, { idPrefix, value, onChange, disabled })
    : null;

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
    if (hasStructuredPrimitiveArrayEditor && !isEditingPrimitiveList) {
      setListText(formatPrimitiveList(value));
      setListError(null);
    }
  }, [value, hasStructuredPrimitiveArrayEditor, isEditingPrimitiveList]);

  const nullableOptions: SelectOption[] = [
    { value: 'value', label: t('inputMappingEditor.nullable.useValue', { defaultValue: 'Use value' }) },
    { value: 'null', label: t('inputMappingEditor.nullable.setNull', { defaultValue: 'Set null' }) },
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
              onChange(buildDefaultWorkflowActionInputLiteralValue(field, { chosen: true }));
            }
          }}
          disabled={disabled}
          className="w-36"
        />
        {value !== null && editor}
      </div>
    );
  };

  // Purpose-built editors replace the generic nested-object editor when the value is fixed.
  if (customLiteralEditor && !showCustomEditorFields) {
    return (
      <div className="space-y-2">
        {customLiteralEditor}
        <Button
          id={`${idPrefix}-${customEditorComponent}-edit-fields`}
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-[rgb(var(--color-text-600))]"
          onClick={() => setShowCustomEditorFields(true)}
        >
          {t('inputMappingEditor.ticketAssignment.editFields', { defaultValue: 'Edit as individual fields' })}
        </Button>
      </div>
    );
  }

  // Handle picker-backed fields
  if (hasMultiUserPickerEditor) {
    return (
      <WorkflowActionInputFixedMultiPicker
        field={field}
        values={Array.isArray(value)
          ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          : []}
        onChange={(nextValues) => onChange(nextValues)}
        idPrefix={idPrefix}
        rootInputMapping={rootInputMapping}
        disabled={disabled}
      />
    );
  }

  if (hasPickerEditor) {
    return wrapNullableEditor(
      <FixedValueEditorShell
        field={field}
        idPrefix={idPrefix}
        value={value}
        onChange={onChange}
        disabled={disabled}
        inlineEditor={
          <WorkflowActionInputFixedPicker
            field={field}
            value={typeof value === 'string' ? value : null}
            onChange={(nextValue) => onChange(nextValue)}
            idPrefix={idPrefix}
            rootInputMapping={rootInputMapping}
            disabled={disabled}
            hideLabel
          />
        }
      />
    );
  }

  if (fieldType === 'string' && softEnum?.component === 'soft-enum-combobox') {
    const currentValue = typeof value === 'string' ? value : '';
    const localizedCuratedOptions =
      softEnum.suggestionKind === 'workflow-entity-type'
        ? workflowEntityTypeOptions
        : softEnum.suggestionKind === 'workflow-link-relation'
          ? workflowLinkRelationOptions
          : [];
    const optionLabels = new Map<string, string>();

    for (const option of localizedCuratedOptions) {
      optionLabels.set(option.value, option.label);
    }

    for (const optionValue of softEnum.curatedValues ?? []) {
      if (typeof optionValue === 'string' && optionValue.trim().length > 0 && !optionLabels.has(optionValue)) {
        optionLabels.set(optionValue, optionValue);
      }
    }

    for (const namespaceValue of dynamicNamespaceOptions) {
      if (namespaceValue.trim().length > 0 && !optionLabels.has(namespaceValue)) {
        optionLabels.set(namespaceValue, namespaceValue);
      }
    }

    if (currentValue && !optionLabels.has(currentValue)) {
      optionLabels.set(currentValue, currentValue);
    }

    const options: SearchableSelectOption[] = Array.from(optionLabels, ([optionValue, label]) => ({
      value: optionValue,
      label,
    }));

    return wrapNullableEditor(
      <SearchableSelect
        id={`${idPrefix}-literal-soft-enum`}
        options={options}
        value={currentValue}
        onChange={(nextValue) => onChange(nextValue)}
        placeholder={fieldEditor?.fixedValueHint ?? t('inputMappingEditor.softEnumPlaceholder', { defaultValue: 'Select or enter value' })}
        searchPlaceholder={t('inputMappingEditor.softEnumSearchPlaceholder', { defaultValue: 'Search or enter a custom value' })}
        emptyMessage={t('inputMappingEditor.softEnumNoResults', { defaultValue: 'No suggestions' })}
        allowCustomValue={softEnum.allowCustomValue !== false}
        customValueLabel={(nextValue) => t('inputMappingEditor.softEnumUseCustom', {
          defaultValue: 'Use "{{value}}"',
          value: nextValue,
        })}
        dropdownMode="overlay"
        disabled={disabled}
      />
    );
  }

  if (fieldEnum && fieldEnum.length > 0) {
    const enumOptions: SelectOption[] = fieldEnum.map(e => ({
      value: String(e ?? ''),
      label: field.optionLabels?.[String(e ?? '')] ?? String(e ?? '')
    }));

    return wrapNullableEditor(
      <CustomSelect
        id={`${idPrefix}-literal-enum`}
        options={enumOptions}
        value={value === undefined || value === null ? '' : String(value)}
        placeholder={field.explicitChoice?.prompt}
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
      { value: 'structured', label: t('inputMappingEditor.mode.structured', { defaultValue: 'Structured' }) },
      { value: 'json', label: t('inputMappingEditor.mode.rawJson', { defaultValue: 'Raw JSON' }) }
    ];

    const handleJsonChange = (text: string) => {
      setJsonText(text);
      try {
        const parsed = JSON.parse(text);
        setJsonError(null);
        onChange(parsed);
      } catch {
        setJsonError(t('inputMappingEditor.invalidJson', { defaultValue: 'Invalid JSON' }));
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
          title={t('inputMappingEditor.objectFields', { defaultValue: 'Object fields' })}
          actions={
            <Button
              id={`${idPrefix}-literal-object-reset`}
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => onChange(buildDefaultWorkflowActionInputLiteralValue(field, { chosen: true }))}
              disabled={disabled}
              className="h-7 px-2 text-gray-500 hover:text-gray-900"
            >
              {t('inputMappingEditor.reset', { defaultValue: 'Reset' })}
            </Button>
          }
        >
          {fieldChildren?.map((child) => {
            const childValue = nextValue[child.name] as MappingValue | undefined;
            const removeChild = () => {
              const rest: Record<string, unknown> = { ...(nextValue as Record<string, unknown>) };
              delete rest[child.name];
              onChange(rest as MappingValue);
            };
            // Optional sub-fields stay unset (and out of the saved value) until the user sets them,
            // instead of showing placeholder defaults such as false or 0 for every one.
            if (childValue === undefined && child.explicitChoice && child.enum?.length) {
              return (
                <div
                  key={child.name}
                  id={`${idPrefix}-literal-object-choice-${child.name}`}
                  className="space-y-2 rounded-md border border-dashed border-destructive/40 px-3 py-2"
                >
                  <WorkflowActionInputFieldInfo field={child} isMissingRequired compact />
                  <ExplicitChoiceOptions
                    id={`${idPrefix}-literal-object-choose-${child.name}`}
                    field={child}
                    disabled={disabled}
                    onChoose={(choice) => onChange({ ...nextValue, [child.name]: choice })}
                  />
                </div>
              );
            }
            if (childValue === undefined && !child.required) {
              return (
                <div
                  key={child.name}
                  id={`${idPrefix}-literal-object-unset-${child.name}`}
                  className="flex items-start justify-between gap-3 rounded-md border border-dashed border-[rgb(var(--color-border-200))] px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <WorkflowActionInputFieldInfo field={child} compact />
                  </div>
                  <Button
                    id={`${idPrefix}-literal-object-set-${child.name}`}
                    variant="ghost"
                    size="sm"
                    type="button"
                    disabled={disabled}
                    onClick={() => onChange({
                      ...nextValue,
                      [child.name]: createWorkflowActionInputValueForMode(
                        child,
                        undefined,
                        getDefaultWorkflowActionInputSourceMode(child)
                      ),
                    })}
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    {t('inputMappingEditor.setOptionalField', { defaultValue: 'Set' })}
                  </Button>
                </div>
              );
            }
            return (
              <div key={child.name} className="space-y-1">
                <MappingFieldEditor
                  field={child}
                  fieldPath={`${field.name}.${child.name}`}
                  value={childValue}
                  onChange={(nextChildValue) => {
                    if (nextChildValue === undefined) {
                      removeChild();
                      return;
                    }
                    onChange({
                      ...nextValue,
                      [child.name]: nextChildValue
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
                {!child.required && (
                  <Button
                    id={`${idPrefix}-literal-object-unset-button-${child.name}`}
                    variant="ghost"
                    size="sm"
                    type="button"
                    disabled={disabled}
                    onClick={removeChild}
                    className="h-6 px-2 text-xs text-[rgb(var(--color-text-500))]"
                  >
                    {t('inputMappingEditor.unsetOptionalField', { defaultValue: 'Leave {{name}} unset', name: child.name })}
                  </Button>
                )}
              </div>
            );
          })}
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
          if (child.required && !child.explicitChoice) {
            newRow[child.name] = buildDefaultWorkflowActionInputLiteralValue(child);
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
              title={t('inputMappingEditor.itemTitle', {
                defaultValue: 'Item {{index}}',
                index: rowIndex + 1,
              })}
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
                    {t('inputMappingEditor.reset', { defaultValue: 'Reset' })}
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
            {t('inputMappingEditor.addItem', { defaultValue: 'Add item' })}
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
            onFocus={() => setIsEditingPrimitiveList(true)}
            onBlur={() => setIsEditingPrimitiveList(false)}
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
            placeholder={t('inputMappingEditor.primitiveList.placeholder', {
              defaultValue: 'Enter one value per line, or comma-separated',
            })}
            className={listError ? 'border-destructive focus:ring-destructive focus:border-destructive' : ''}
            disabled={disabled}
          />
          <p className="text-[11px] text-gray-500">
            {t('inputMappingEditor.primitiveList.helperText', {
              defaultValue: 'Use newline, comma, or semicolon separators.',
            })}
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
              title={t('inputMappingEditor.itemTitle', {
                defaultValue: 'Item {{index}}',
                index: rowIndex + 1,
              })}
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
                    {t('inputMappingEditor.reset', { defaultValue: 'Reset' })}
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
            {t('inputMappingEditor.addItem', { defaultValue: 'Add item' })}
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

  // Free text is "text with fields": type text and insert workflow fields, single- or multi-line.
  if (isPlainTextField(field)) {
    const template = textTemplateFromValue(value, textScope) ?? (typeof value === 'string' ? value : '');
    return wrapNullableEditor(
      <WorkflowTextTemplateEditor
        idPrefix={idPrefix}
        scope={textScope}
        template={template}
        onChange={onChange}
        fieldOptions={fieldOptions}
        sampleContext={sampleContext}
        multiline={isWorkflowMultilineTextInput(field)}
        label={field.name}
        disabled={disabled}
      />
    );
  }

  // Default to string
  const stringInputType = fieldConstraints?.format === 'email' ? 'email' : 'text';
  const isMultilineString = inlineEditorMode === 'textarea';
  const showSingleLineStringInput =
    inlineEditorMode === 'input' ||
    (!fieldEditor?.inline && fieldEditor?.dialog === undefined);
  const inlineStringEditor = isMultilineString ? (
    <TextArea
      id={`${idPrefix}-literal-str`}
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={t('inputMappingEditor.stringPlaceholder', { defaultValue: 'Enter value...' })}
      rows={5}
      disabled={disabled}
    />
  ) : showSingleLineStringInput ? (
    <Input
      id={`${idPrefix}-literal-str`}
      type={stringInputType}
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={t('inputMappingEditor.stringPlaceholder', { defaultValue: 'Enter value...' })}
      disabled={disabled}
    />
  ) : null;
  return wrapNullableEditor(
    <FixedValueEditorShell
      field={field}
      idPrefix={idPrefix}
      value={value}
      onChange={onChange}
      disabled={disabled}
      inlineEditor={inlineStringEditor}
    />
  );
};

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
  actionId,
  sourceTypeMap,
  sourceKindMap,
  disabled,
  expressionContext: providedExpressionContext,
  referenceBrowseContext,
}) => {
  const { t } = useTranslation('msp/workflows');
  const { aiAssistantAvailable, openQuickAsk } = useQuickAsk();
  // Same count as the step card's badge: required inputs, nested ones included.
  const missingRequiredCount = useMemo(() => countMissingRequiredInputs(targetFields, value), [targetFields, value]);

  const filledFieldCount = useMemo(
    () => targetFields.filter((field) => isMappingValueSet(value[field.name], field.type)).length,
    [targetFields, value]
  );

  // §17.3.3 - Auto-mapping suggestions
  const suggestions = useMemo(() =>
    findAutoMappingSuggestions(
      targetFields,
      fieldOptions.map((option) => ({
        path: option.value,
        type: sourceTypeMap?.get(option.value) ?? inferTypeFromPath(option.value),
        kind: sourceKindMap?.get(option.value),
      })),
      value
    ),
    [targetFields, fieldOptions, sourceKindMap, sourceTypeMap, value]
  );
  // Bulk apply only fills empty required inputs with same-name, type-matched sources; the rest
  // stay per-field hints.
  const applicableSuggestions = useMemo(
    () =>
      selectBulkApplicableSuggestions(suggestions, targetFields, (fieldName) =>
        isMappingValueSet(value[fieldName], targetFields.find((field) => field.name === fieldName)?.type)
      ),
    [suggestions, targetFields, value]
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
    if (applicableSuggestions.length === 0) return;

    const newMappings = { ...value };
    applicableSuggestions.forEach(s => {
      newMappings[s.targetField] = { $expr: s.expression };
    });
    onChange(newMappings);
  }, [applicableSuggestions, value, onChange]);

  // Apply single suggestion
  const handleApplySuggestion = useCallback((suggestion: AutoMappingSuggestion) => {
    onChange({ ...value, [suggestion.targetField]: { $expr: suggestion.expression } });
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
    // A same-name, type-matched source fills the input directly; otherwise start in the field's
    // natural editor (picker, text, structured fields).
    const suggestion = suggestionMap.get(fieldName);
    if (isStrongSuggestion(suggestion, field)) {
      onChange({ ...value, [fieldName]: { $expr: suggestion!.expression } });
      return;
    }
    const defaultMode = getDefaultWorkflowActionInputSourceMode(field);
    onChange({
      ...value,
      [fieldName]: createWorkflowActionInputValueForMode(field, undefined, defaultMode),
    });
  }, [onChange, suggestionMap, targetFields, value]);

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

  // Update-action patch UX (Option C): schema-driven detection of a `patch`
  // object input. Whole-object references/expressions fall back to the
  // generic editor so power users keep full control.
  const patchField = useMemo(
    () => targetFields.find(isWorkflowUpdatePatchField),
    [targetFields]
  );
  const patchUxActive = Boolean(patchField) && isEditableWorkflowPatchValue(value[patchField?.name ?? 'patch']);
  const targetIdField = useMemo(() => {
    if (!patchField) return undefined;
    return targetFields.find(
      (field) => field !== patchField && field.required && field.name.endsWith('_id')
    );
  }, [patchField, targetFields]);
  const patchMainFields = useMemo(
    () => (patchField
      ? targetFields.filter((field) => field !== patchField && field.required)
      : []),
    [patchField, targetFields]
  );
  const patchAdvancedFields = useMemo(
    () => (patchField
      ? targetFields.filter((field) => field !== patchField && !field.required)
      : []),
    [patchField, targetFields]
  );
  const targetPhrase = patchField
    ? buildWorkflowUpdateTargetPhrase(t, targetIdField, targetIdField ? value[targetIdField.name] : undefined)
    : '';

  if (targetFields.length === 0) {
    return (
      <div className="text-sm text-gray-500 p-3 bg-gray-50 rounded border border-gray-200">
        {t('inputMappingEditor.empty', { defaultValue: 'This action has no input fields.' })}
      </div>
    );
  }

  return (
    <SourceKindContext.Provider value={sourceKindMap}>
    <div
      className="space-y-4"
      onKeyDown={keyboardHandlers.handleKeyDown}
      onFocus={keyboardHandlers.activate}
      onBlur={keyboardHandlers.deactivate}
      role="listbox"
      aria-label={t('inputMappingEditor.aria.listbox', { defaultValue: 'Action input fields' })}
      aria-activedescendant={
        keyboardState.focusedIndex >= 0
          ? `mapping-field-${stepId}-${allFieldNames[keyboardState.focusedIndex]}`
          : undefined
      }
    >
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
          <div>
            {t('inputMappingEditor.summary.filledCount', {
              defaultValue: '{{filled}} of {{total}} fields filled',
              filled: filledFieldCount,
              total: targetFields.length,
            })}
          </div>
          {missingRequiredCount > 0 && (
            <div
              className="text-xs text-destructive flex items-center gap-1"
              title={t('inputMappingEditor.summary.missingTitle', { defaultValue: 'Required fields are missing values' })}
            >
              <AlertTriangle className="w-3 h-3" />
              {t('inputMappingEditor.summary.missingCount', {
                defaultValue: '{{count}} required missing',
                count: missingRequiredCount,
              })}
            </div>
          )}
        </div>
        <div className="flex flex-col items-start gap-1">
          {applicableSuggestions.length > 0 && (
            <Button
              id={`auto-map-${stepId}`}
              variant="ghost"
              size="sm"
              onClick={handleAutoMapAll}
              disabled={disabled}
              className="text-xs text-primary-600 hover:text-primary-700"
              title={applicableSuggestions.map((s) => `${s.targetField} ← ${s.sourcePath}`).join('\n')}
            >
              <Wand2 className="w-3.5 h-3.5 mr-1" />
              {t('inputMappingEditor.applySuggestions', {
                defaultValue: 'Apply suggestions ({{count}})',
                count: applicableSuggestions.length,
              })}
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
              {t('inputMappingEditor.clearValues', { defaultValue: 'Clear values' })}
            </Button>
          )}
        </div>
      </div>

      <div
        className="space-y-2"
        role="group"
        aria-label={t('inputMappingEditor.aria.fieldList', { defaultValue: 'Action input fields list' })}
      >
        {(patchUxActive ? patchMainFields : targetFields).map(renderFieldEntry)}
        {patchUxActive && patchField && (
          <>
            <UpdatePatchSection
              patchField={patchField}
              value={value[patchField.name]}
              onChange={(nextValue) => handleFieldChange(patchField.name, nextValue)}
              rootInputMapping={value}
              fieldOptions={fieldOptions}
              stepId={stepId}
              actionId={actionId}
              disabled={disabled}
              sourceTypeMap={sourceTypeMap}
              expressionContext={expressionContext}
              referenceBrowseContext={referenceBrowseContext}
              targetPhrase={targetPhrase}
            />
            {patchAdvancedFields.length > 0 && (
              <StructuredLiteralGroup
                id={`update-patch-advanced-${stepId}`}
                title={t('inputMappingEditor.updatePatch.advancedTitle', { defaultValue: 'Advanced' })}
                defaultExpanded={false}
              >
                {patchAdvancedFields.map(renderFieldEntry)}
              </StructuredLiteralGroup>
            )}
          </>
        )}
      </div>
    </div>
    </SourceKindContext.Provider>
  );

  function renderFieldEntry(field: ActionInputField): React.ReactNode {
          const suggestion = suggestionMap.get(field.name);
          const isMissingRequired = countMissingRequiredInputs([field], value) > 0;
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
                  actionId={actionId}
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
                  title={t('inputMappingEditor.removeMapping', { defaultValue: 'Remove mapping (Delete/Backspace)' })}
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
                  {field.explicitChoice && field.enum?.length ? (
                    <ExplicitChoiceOptions
                      id={`choose-${stepId}-${field.name}`}
                      field={field}
                      disabled={disabled}
                      onChoose={(choice) => handleFieldChange(field.name, choice)}
                    />
                  ) : null}
                  {suggestion && (
                    <span className="flex min-w-0 items-center gap-1 text-xs text-primary-600">
                      <Sparkles className="w-3 h-3" />
                      <span className="truncate">← {suggestion.sourcePath}</span>
                      {suggestion.confidence === 'partial' && (
                        <span className="text-primary-400">
                          {t('inputMappingEditor.partialMatchSuffix', { defaultValue: '(similar name: check before using)' })}
                        </span>
                      )}
                      {suggestion.confidence === 'kind' && (() => {
                        // Say what the match is: "(also a contact)", not "same kind of record".
                        const kind = humanizeWorkflowRecordKind(field.editor?.picker?.resource ?? field.picker?.kind ?? '');
                        return (
                          <span className="text-primary-400">
                            {kind
                              ? takesAnArticle(kind)
                                ? t('inputMappingEditor.kindMatchSuffixAn', { defaultValue: '(also an {{kind}})', kind })
                                : t('inputMappingEditor.kindMatchSuffixA', { defaultValue: '(also a {{kind}})', kind })
                              : t('inputMappingEditor.kindMatchSuffix', { defaultValue: '(the same kind of record)' })}
                          </span>
                        );
                      })()}
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
                      title={t('inputMappingEditor.applySuggestionTitle', {
                        defaultValue: 'Apply suggestion: {{sourcePath}}',
                        sourcePath: suggestion.sourcePath,
                      })}
                    >
                      <Wand2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  {aiAssistantAvailable && (
                    (actionId === 'transform.query_json' && field.name === 'expression')
                    || (isRegexTransformActionId(actionId) && (field.name === 'pattern' || field.name === 'replacement'))
                  ) ? (
                    <button
                      id={`mapping-${stepId}-${field.name}-ask-ai`}
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium text-[rgb(var(--color-primary-700))] transition-colors hover:text-[rgb(var(--color-primary-900))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--color-primary-500))] focus:ring-offset-2 dark:text-[rgb(var(--color-primary-300))] dark:hover:text-[rgb(var(--color-primary-200))]"
                      title={t('inputMappingEditor.askAi.shortcutHint', {
                        defaultValue: isRegexTransformActionId(actionId) ? 'Open Quick Ask for regex guidance' : 'Open Quick Ask for JSONata guidance'
                      })}
                      aria-label={t('inputMappingEditor.askAi.ariaLabel', {
                        defaultValue: isRegexTransformActionId(actionId) ? 'Ask AI for regex help' : 'Ask AI for JSONata help'
                      })}
                      onClick={openQuickAsk}
                      disabled={disabled}
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      <span>{t('inputMappingEditor.askAi.title', { defaultValue: 'Ask AI' })}</span>
                    </button>
                  ) : null}
                  {/* A choice the author must make is answered with the option buttons, not Fill. */}
                  {!(field.explicitChoice && field.enum?.length) && (
                  <Button
                    id={`add-mapping-${stepId}-${field.name}`}
                    variant="ghost"
                    size="sm"
                    onClick={() => handleAddMapping(field.name)}
                    disabled={disabled}
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" />
                    {t('inputMappingEditor.fill', { defaultValue: 'Fill' })}
                  </Button>
                  )}
                </div>
              </div>
            </div>
          );
  }
};

export default InputMappingEditor;
