'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { TFunction } from 'i18next';
import { generateUUID } from '@alga-psa/core';
import type {
  TemplateAggregateTransform,
  TemplateAggregation,
  TemplateFilterTransform,
  TemplateGroupTransform,
  TemplatePredicate,
  TemplateSortKey,
  TemplateSortTransform,
  TemplateTransformOperation,
} from '@alga-psa/types';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { AsyncSearchableSelect } from '@alga-psa/ui/components/AsyncSearchableSelect';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Input } from '@alga-psa/ui/components/Input';
import ViewSwitcher from '@alga-psa/ui/components/ViewSwitcher';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { exportWorkspaceToTemplateAst } from '../ast/workspaceAst';
import {
  DEFAULT_PREVIEW_SAMPLE_ID,
  INVOICE_PREVIEW_SAMPLE_SCENARIOS,
} from '../preview/sampleScenarios';
import {
  DEFAULT_QUOTE_PREVIEW_SAMPLE_ID,
  QUOTE_PREVIEW_SAMPLE_SCENARIOS,
} from '../preview/quoteSampleScenarios';
import type { PreviewSessionState, PreviewSourceKind } from '../preview/previewSessionState';
import { createEmptyDesignerTransformWorkspace, useInvoiceDesignerStore } from '../state/designerStore';
import { evaluateTemplateAst, TemplateEvaluationError } from '../../../lib/invoice-template-ast/evaluator';
import { INVOICE_TEMPLATE_BINDING_ALIASES } from '../../../lib/invoice-template-ast/bindingAliases';
import { validateTemplateAst } from '../../../lib/invoice-template-ast/schema';
import { resolveDesignerDocumentKind } from '../utils/documentKind';
import {
  cloneDesignerTransformWorkspace,
  suggestTransformOutputBindingId,
  validateDesignerTransformWorkspace,
} from './transformWorkspace';

type CollectionOption = {
  value: string;
  label: string;
  path: string;
  rowCount: number | null;
  source: 'binding' | 'preview-data' | 'current';
};

type PreviewIssue = {
  key: string;
  tone: 'warning' | 'destructive';
  text: string;
};

type Props = {
  // The workspace only reads the session, so it accepts any designer's detail payload shape.
  previewState: PreviewSessionState<unknown>;
  previewData: object | null;
  activeSample: { id: string; label: string; description: string } | null;
  onSourceKindChange: (source: PreviewSourceKind) => void;
  onSampleChange: (sampleId: string) => void;
  onExistingInvoiceChange: (invoiceId: string) => void;
  onClearExistingInvoice: () => void;
  loadExistingInvoiceOptions: (args: { search: string; page: number; limit: number }) => Promise<{
    options: Array<{ value: string; label: string }>;
    total: number;
  }>;
};

// Option labels are built per render so they can reach `t`.
const buildPreviewSourceOptions = (t: TFunction): { value: PreviewSourceKind; label: string }[] => [
  { value: 'sample', label: t('designer.workspace.preview.source.sample', { defaultValue: 'Sample' }) },
  { value: 'existing', label: t('designer.workspace.preview.source.existing', { defaultValue: 'Existing' }) },
];

const buildFilterOperatorOptions = (t: TFunction) => [
  { value: 'eq', label: t('invoiceDesigner.transforms.operators.eq', { defaultValue: 'Equals' }) },
  { value: 'neq', label: t('invoiceDesigner.transforms.operators.neq', { defaultValue: 'Not equal' }) },
  { value: 'gt', label: t('invoiceDesigner.transforms.operators.gt', { defaultValue: 'Greater than' }) },
  { value: 'gte', label: t('invoiceDesigner.transforms.operators.gte', { defaultValue: 'Greater or equal' }) },
  { value: 'lt', label: t('invoiceDesigner.transforms.operators.lt', { defaultValue: 'Less than' }) },
  { value: 'lte', label: t('invoiceDesigner.transforms.operators.lte', { defaultValue: 'Less or equal' }) },
  { value: 'in', label: t('invoiceDesigner.transforms.operators.in', { defaultValue: 'In list' }) },
];

const buildSortDirectionOptions = (t: TFunction) => [
  { value: 'asc', label: t('invoiceDesigner.transforms.sortDirections.asc', { defaultValue: 'Ascending' }) },
  { value: 'desc', label: t('invoiceDesigner.transforms.sortDirections.desc', { defaultValue: 'Descending' }) },
];

const buildAggregationOptions = (t: TFunction) => [
  { value: 'sum', label: t('invoiceDesigner.transforms.aggregations.sum', { defaultValue: 'Sum' }) },
  { value: 'count', label: t('invoiceDesigner.transforms.aggregations.count', { defaultValue: 'Count' }) },
  { value: 'avg', label: t('invoiceDesigner.transforms.aggregations.avg', { defaultValue: 'Average' }) },
  { value: 'min', label: t('invoiceDesigner.transforms.aggregations.min', { defaultValue: 'Minimum' }) },
  { value: 'max', label: t('invoiceDesigner.transforms.aggregations.max', { defaultValue: 'Maximum' }) },
];

type ComparisonPredicate = Extract<TemplatePredicate, { type: 'comparison' }>;

const createLocalId = (prefix: string) => `${prefix}-${generateUUID()}`;

const cloneJson = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asTrimmedString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const getPathValue = (target: unknown, path: string): unknown => {
  if (!path) {
    return target;
  }

  return path.split('.').reduce<unknown>((current, segment) => {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      return current[Number(segment)];
    }
    if (typeof current === 'object') {
      return (current as Record<string, unknown>)[segment];
    }
    return undefined;
  }, target);
};

const formatValuePreview = (value: unknown): string => {
  if (value === null) return 'null';
  if (typeof value === 'undefined') return 'undefined';
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

const parsePredicateValue = (rawValue: string, operator: ComparisonPredicate['op']) => {
  const trimmed = rawValue.trim();
  if (operator === 'in') {
    if (!trimmed) {
      return [];
    }
    return trimmed.split(',').map((part) => part.trim()).filter(Boolean);
  }
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (trimmed !== '' && !Number.isNaN(Number(trimmed))) {
    return Number(trimmed);
  }
  return rawValue;
};

const describeOperation = (operation: TemplateTransformOperation, t: TFunction): string => {
  switch (operation.type) {
    case 'filter':
      if (operation.predicate.type !== 'comparison') {
        return t('invoiceDesigner.transforms.operations.advancedPredicate', { defaultValue: 'Advanced predicate' });
      }
      return `${operation.predicate.path || 'field'} ${operation.predicate.op} ${formatValuePreview(operation.predicate.value)}`;
    case 'sort':
      return operation.keys.map((key) => `${key.path || 'field'} ${key.direction ?? 'asc'}`).join(', ');
    case 'group':
      return t('invoiceDesigner.transforms.operations.groupBy', {
        defaultValue: 'Group by {{field}}',
        field: operation.key || 'field',
      });
    case 'aggregate':
      return operation.aggregations.map((entry) => `${entry.op} ${entry.path ?? 'rows'} -> ${entry.id}`).join(', ');
    default:
      return t('invoiceDesigner.transforms.operations.readOnly', { defaultValue: 'Preserved read-only in V1' });
  }
};

const discoverFieldPaths = (value: unknown, prefix = '', depth = 0, result = new Set<string>()): Set<string> => {
  if (depth > 3 || value === null || typeof value === 'undefined') {
    return result;
  }

  if (Array.isArray(value)) {
    if (prefix) {
      result.add(prefix);
    }
    const firstRecord = value.find((entry) => isRecord(entry));
    if (firstRecord) {
      discoverFieldPaths(firstRecord, prefix ? `${prefix}.*` : '*', depth + 1, result);
    }
    return result;
  }

  if (!isRecord(value)) {
    if (prefix) {
      result.add(prefix);
    }
    return result;
  }

  for (const [key, child] of Object.entries(value)) {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    result.add(nextPrefix);
    if (isRecord(child) || Array.isArray(child)) {
      discoverFieldPaths(child, nextPrefix, depth + 1, result);
    }
  }

  return result;
};

const discoverCollectionPaths = (value: unknown, prefix = '', result = new Set<string>()): Set<string> => {
  if (Array.isArray(value)) {
    if (prefix) {
      result.add(prefix);
    }
    return result;
  }

  if (!isRecord(value)) {
    return result;
  }

  for (const [key, child] of Object.entries(value)) {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    discoverCollectionPaths(child, nextPrefix, result);
  }

  return result;
};

const getSourceCollection = (
  previewData: object | null,
  sourceBindingId: string,
  collectionPathById: Map<string, string>
): Array<Record<string, unknown>> => {
  if (!previewData || !sourceBindingId) {
    return [];
  }

  const resolvedPath = collectionPathById.get(sourceBindingId) ?? sourceBindingId;
  const value = getPathValue(previewData, resolvedPath);
  return Array.isArray(value) ? value.filter(isRecord) : [];
};

const coerceComparisonPredicate = (
  predicate: TemplatePredicate,
  fieldPaths: string[]
): ComparisonPredicate => {
  if (predicate.type === 'comparison') {
    return predicate;
  }
  return {
    type: 'comparison',
    path: fieldPaths[0] ?? '',
    op: 'eq',
    value: '',
  };
};

const TransformsWorkspace: React.FC<Props> = ({
  previewState,
  previewData,
  activeSample,
  onSourceKindChange,
  onSampleChange,
  onExistingInvoiceChange,
  onClearExistingInvoice,
  loadExistingInvoiceOptions,
}) => {
  const { t } = useTranslation('msp/invoicing');
  const nodes = useInvoiceDesignerStore((state) => state.nodes);
  const rootId = useInvoiceDesignerStore((state) => state.rootId);
  const snapToGrid = useInvoiceDesignerStore((state) => state.snapToGrid);
  const gridSize = useInvoiceDesignerStore((state) => state.gridSize);
  const showGuides = useInvoiceDesignerStore((state) => state.showGuides);
  const showRulers = useInvoiceDesignerStore((state) => state.showRulers);
  const canvasScale = useInvoiceDesignerStore((state) => state.canvasScale);
  const transforms = useInvoiceDesignerStore((state) => state.transforms);
  const setTransforms = useInvoiceDesignerStore((state) => state.setTransforms);
  const [selectedOperationId, setSelectedOperationId] = useState<string | null>(null);
  const [outputBindingDraft, setOutputBindingDraft] = useState('');

  // The workspace serves every designer, so the source panel names the documents this template is
  // actually bound to (quotes, sales orders) instead of always saying "invoice".
  const previewDocumentKind = useMemo(() => resolveDesignerDocumentKind(nodes), [nodes]);
  const sampleScenarios = previewDocumentKind === 'quote'
    ? QUOTE_PREVIEW_SAMPLE_SCENARIOS
    : previewDocumentKind === 'sales-order'
      ? []
      : INVOICE_PREVIEW_SAMPLE_SCENARIOS;
  const defaultSampleId = previewDocumentKind === 'quote'
    ? DEFAULT_QUOTE_PREVIEW_SAMPLE_ID
    : DEFAULT_PREVIEW_SAMPLE_ID;
  const existingSourceLabels = previewDocumentKind === 'quote'
    ? {
      search: t('designer.workspace.preview.searchQuotes', { defaultValue: 'Search quotes...' }),
      empty: t('designer.workspace.preview.noQuotesFound', { defaultValue: 'No quotes found.' }),
      select: t('designer.workspace.preview.selectQuote', { defaultValue: 'Select quote' }),
      loading: t('designer.workspace.preview.loadingQuoteDetails', { defaultValue: 'Loading quote details...' }),
    }
    : previewDocumentKind === 'sales-order'
      ? {
        search: t('documentTemplates.editor.preview.searchDocuments', { defaultValue: 'Search sales orders...' }),
        empty: t('documentTemplates.editor.preview.noDocumentsFound', { defaultValue: 'No sales orders found.' }),
        select: t('documentTemplates.editor.preview.selectDocument', { defaultValue: 'Select Sales Order' }),
        loading: t('designer.workspace.preview.loadingDocumentDetails', { defaultValue: 'Loading document details...' }),
      }
      : {
        search: t('designer.workspace.preview.searchInvoices', { defaultValue: 'Search invoices...' }),
        empty: t('designer.workspace.preview.noInvoicesFound', { defaultValue: 'No invoices found.' }),
        select: t('invoiceDesigner.transforms.source.selectInvoice', { defaultValue: 'Select invoice' }),
        loading: t('designer.workspace.preview.loadingDetails', { defaultValue: 'Loading invoice details...' }),
      };

  const workspaceSnapshot = useMemo(
    () => ({
      rootId,
      nodesById: Object.fromEntries(
        nodes.map((node) => [
          node.id,
          {
            id: node.id,
            type: node.type,
            props: node.props,
            children: node.children,
          },
        ])
      ),
      transforms,
      snapToGrid,
      gridSize,
      showGuides,
      showRulers,
      canvasScale,
    }),
    [canvasScale, gridSize, nodes, rootId, showGuides, showRulers, snapToGrid, transforms]
  );

  const workspaceWithoutTransforms = useMemo(
    () => ({
      ...workspaceSnapshot,
      transforms: createEmptyDesignerTransformWorkspace(),
    }),
    [workspaceSnapshot]
  );

  const baseAst = useMemo(
    () => exportWorkspaceToTemplateAst(workspaceWithoutTransforms),
    [workspaceWithoutTransforms]
  );

  const collectionPathById = useMemo(() => {
    const entries = Object.entries(baseAst.bindings?.collections ?? {});
    return new Map(entries.map(([bindingId, binding]) => [bindingId, binding.path]));
  }, [baseAst]);

  const sourceCollection = useMemo(
    () => getSourceCollection(previewData, transforms.sourceBindingId, collectionPathById),
    [collectionPathById, previewData, transforms.sourceBindingId]
  );

  const sourceFieldPaths = useMemo(
    () => Array.from(discoverFieldPaths(sourceCollection[0] ?? {})).filter((path) => !path.includes('*')).sort(),
    [sourceCollection]
  );

  const sourceCollectionOptions = useMemo(() => {
    const options: CollectionOption[] = Object.entries(baseAst.bindings?.collections ?? {}).map(([bindingId, binding]) => ({
      value: bindingId,
      label: `${bindingId} (${binding.path})`,
      path: binding.path,
      rowCount: Array.isArray(getPathValue(previewData, binding.path)) ? (getPathValue(previewData, binding.path) as unknown[]).length : null,
      source: 'binding',
    }));

    discoverCollectionPaths(previewData).forEach((path) => {
      if (options.some((option) => option.path === path || option.value === path)) {
        return;
      }
      const value = getPathValue(previewData, path);
      options.push({
        value: path,
        label: `${path} (preview data)`,
        path,
        rowCount: Array.isArray(value) ? value.length : null,
        source: 'preview-data',
      });
    });

    if (
      transforms.sourceBindingId &&
      !options.some((option) => option.value === transforms.sourceBindingId)
    ) {
      options.unshift({
        value: transforms.sourceBindingId,
        label: `${transforms.sourceBindingId} (current)`,
        path: collectionPathById.get(transforms.sourceBindingId) ?? transforms.sourceBindingId,
        rowCount: sourceCollection.length,
        source: 'current',
      });
    }

    return options.sort((left, right) => left.label.localeCompare(right.label));
  }, [baseAst, collectionPathById, previewData, sourceCollection.length, transforms.sourceBindingId]);

  const selectedSourceOption = useMemo(
    () => sourceCollectionOptions.find((option) => option.value === transforms.sourceBindingId) ?? null,
    [sourceCollectionOptions, transforms.sourceBindingId]
  );

  const selectedOperation = useMemo(
    () => transforms.operations.find((operation) => operation.id === selectedOperationId) ?? null,
    [selectedOperationId, transforms.operations]
  );

  useEffect(() => {
    setOutputBindingDraft(transforms.outputBindingId);
  }, [transforms.outputBindingId]);

  useEffect(() => {
    if (transforms.operations.length === 0) {
      if (selectedOperationId !== null) {
        setSelectedOperationId(null);
      }
      return;
    }

    if (!selectedOperationId || !transforms.operations.some((operation) => operation.id === selectedOperationId)) {
      setSelectedOperationId(transforms.operations[0]?.id ?? null);
    }
  }, [selectedOperationId, transforms.operations]);

  const transformValidationIssues = useMemo(
    () => validateDesignerTransformWorkspace(transforms),
    [transforms]
  );

  const outputPreview = useMemo(() => {
    if (!previewData) {
      return {
        issues: [] as PreviewIssue[],
        rowPaths: [] as string[],
        groups: null as Array<Record<string, unknown>> | null,
        rows: [] as Array<Record<string, unknown>>,
      };
    }

    try {
      const ast = exportWorkspaceToTemplateAst(workspaceSnapshot);
      const validationResult = validateTemplateAst(ast);
      if (!validationResult.success) {
        const validationErrors = 'errors' in validationResult ? validationResult.errors : [];
        return {
          issues: validationErrors.map((error, index) => ({
            key: `${error.path}-${index}`,
            tone: 'destructive' as const,
            text: `${error.path || '<root>'}: ${error.message}`,
          })),
          rowPaths: [],
          groups: null,
          rows: [],
        };
      }

      const documentKind = resolveDesignerDocumentKind(nodes);
      const evaluation = evaluateTemplateAst(
        validationResult.ast,
        previewData as unknown as Record<string, unknown>,
        documentKind === 'quote'
          ? undefined
          : { bindingAliases: INVOICE_TEMPLATE_BINDING_ALIASES }
      );
      const outputRows = Array.isArray(evaluation.output) ? evaluation.output.filter(isRecord) : [];
      return {
        issues: [] as PreviewIssue[],
        rowPaths: Array.from(discoverFieldPaths(outputRows[0] ?? {})).filter((path) => !path.includes('*')).sort(),
        groups: evaluation.groups ? (evaluation.groups as unknown as Array<Record<string, unknown>>) : null,
        rows: outputRows,
      };
    } catch (error) {
      if (error instanceof TemplateEvaluationError) {
        return {
          issues: error.issues.map((issue, index) => ({
            key: `${issue.code}-${issue.operationId ?? 'global'}-${index}`,
            tone: 'destructive' as const,
            text: issue.operationId ? `${issue.message} [${issue.operationId}]` : issue.message,
          })),
          rowPaths: [],
          groups: null,
          rows: [],
        };
      }
      if (error instanceof Error) {
        return {
          issues: [
            {
              key: 'export-error',
              tone: 'destructive' as const,
              text: error.message,
            },
          ],
          rowPaths: [],
          groups: null,
          rows: [],
        };
      }
      return {
        issues: [
          {
            key: 'unknown-error',
            tone: 'destructive' as const,
            text: t('invoiceDesigner.transforms.output.previewFailed', { defaultValue: 'Transforms preview failed.' }),
          },
        ],
        rowPaths: [],
        groups: null,
        rows: [],
      };
    }
  }, [nodes, previewData, t, workspaceSnapshot]);

  const combinedIssues = useMemo(
    () => [
      ...transformValidationIssues.map((issue, index) => ({
        key: `${issue.code}-${issue.operationId ?? 'global'}-${index}`,
        tone: issue.code === 'INVALID_SEQUENCE' ? ('destructive' as const) : ('warning' as const),
        text: issue.message,
      })),
      ...outputPreview.issues,
    ],
    [outputPreview.issues, transformValidationIssues]
  );

  const updateTransforms = (updater: (current: typeof transforms) => typeof transforms, commit = true) => {
    const next = updater(cloneDesignerTransformWorkspace(transforms));
    setTransforms(next, commit);
  };

  const ensureOutputBindingId = (sourceBindingId: string, currentOutputBindingId: string) =>
    currentOutputBindingId.trim().length > 0 ? currentOutputBindingId : suggestTransformOutputBindingId(sourceBindingId);

  const addOperation = (type: 'filter' | 'sort' | 'group' | 'aggregate') => {
    const firstField = sourceFieldPaths[0] ?? '';
    const numericField = sourceCollection.find((row) => isRecord(row))
      ? sourceFieldPaths.find((path) => typeof getPathValue(sourceCollection[0], path) === 'number') ?? firstField
      : firstField;

    const operation: TemplateTransformOperation =
      type === 'filter'
        ? ({
            id: createLocalId('filter'),
            type: 'filter',
            predicate: {
              type: 'comparison',
              path: firstField,
              op: 'eq',
              value: '',
            },
          } satisfies TemplateFilterTransform)
        : type === 'sort'
          ? ({
              id: createLocalId('sort'),
              type: 'sort',
              keys: [
                {
                  path: firstField,
                  direction: 'asc',
                },
              ],
            } satisfies TemplateSortTransform)
          : type === 'group'
            ? ({
                id: createLocalId('group'),
                type: 'group',
                key: firstField,
                label: '',
              } satisfies TemplateGroupTransform)
            : ({
                id: createLocalId('aggregate'),
                type: 'aggregate',
                aggregations: [
                  {
                    id: 'sumTotal',
                    op: 'sum',
                    path: numericField,
                  },
                ],
              } satisfies TemplateAggregateTransform);

    updateTransforms((current) => ({
      ...current,
      operations: [...current.operations, operation],
    }));
    setSelectedOperationId(operation.id);
  };

  const updateOperation = (operationId: string, updater: (operation: TemplateTransformOperation) => TemplateTransformOperation, commit = true) => {
    updateTransforms(
      (current) => ({
        ...current,
        operations: current.operations.map((operation) =>
          operation.id === operationId ? updater(cloneJson(operation)) : operation
        ),
      }),
      commit
    );
  };

  const removeOperation = (operationId: string) => {
    const index = transforms.operations.findIndex((operation) => operation.id === operationId);
    updateTransforms((current) => ({
      ...current,
      operations: current.operations.filter((operation) => operation.id !== operationId),
    }));
    const fallback = transforms.operations[index + 1] ?? transforms.operations[index - 1] ?? null;
    setSelectedOperationId(fallback?.id ?? null);
  };

  const duplicateOperation = (operationId: string) => {
    const index = transforms.operations.findIndex((operation) => operation.id === operationId);
    const source = transforms.operations[index];
    if (!source) {
      return;
    }
    const duplicate = cloneJson(source) as TemplateTransformOperation;
    duplicate.id = createLocalId(source.type);
    updateTransforms((current) => {
      const operations = [...current.operations];
      operations.splice(index + 1, 0, duplicate);
      return {
        ...current,
        operations,
      };
    });
    setSelectedOperationId(duplicate.id);
  };

  const moveOperation = (operationId: string, direction: -1 | 1) => {
    const index = transforms.operations.findIndex((operation) => operation.id === operationId);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= transforms.operations.length) {
      return;
    }
    updateTransforms((current) => {
      const operations = [...current.operations];
      const [moved] = operations.splice(index, 1);
      if (!moved) {
        return current;
      }
      operations.splice(targetIndex, 0, moved);
      return {
        ...current,
        operations,
      };
    });
  };

  const renderInspector = () => {
    if (!selectedOperation) {
      return (
        <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-[rgb(var(--color-background))] px-3 py-6 text-sm text-slate-500 dark:text-slate-400">
          {t('invoiceDesigner.transforms.inspector.empty', {
            defaultValue: 'Select a transform card to edit its settings.',
          })}
        </div>
      );
    }

    if (selectedOperation.type === 'filter') {
      const predicate = coerceComparisonPredicate(selectedOperation.predicate, sourceFieldPaths);
      return (
        <div className="space-y-3">
          {selectedOperation.predicate.type !== 'comparison' && (
            <Alert variant="info">
              <AlertDescription>
                {t('invoiceDesigner.transforms.inspector.advancedPredicateNotice', {
                  defaultValue:
                    'This filter uses an advanced predicate shape. Editing here converts it to a simple comparison.',
                })}
              </AlertDescription>
            </Alert>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
              {t('invoiceDesigner.transforms.inspector.field', { defaultValue: 'Field' })}
            </label>
            <CustomSelect
              id={`transform-filter-field-${selectedOperation.id}`}
              options={sourceFieldPaths.map((path) => ({ value: path, label: path }))}
              value={predicate.path}
              onValueChange={(value: string) =>
                updateOperation(selectedOperation.id, (operation) => ({
                  ...operation,
                  predicate: {
                    ...coerceComparisonPredicate(
                      operation.type === 'filter' ? operation.predicate : predicate,
                      sourceFieldPaths
                    ),
                    path: value,
                  },
                }))
              }
              size="sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
              {t('invoiceDesigner.transforms.inspector.operator', { defaultValue: 'Operator' })}
            </label>
            <CustomSelect
              id={`transform-filter-operator-${selectedOperation.id}`}
              options={buildFilterOperatorOptions(t)}
              value={predicate.op}
              onValueChange={(value: string) =>
                updateOperation(selectedOperation.id, (operation) => ({
                  ...operation,
                  predicate: {
                    ...coerceComparisonPredicate(
                      operation.type === 'filter' ? operation.predicate : predicate,
                      sourceFieldPaths
                    ),
	                    op: value as ComparisonPredicate['op'],
                    value:
                      value === 'in'
                        ? []
                        : coerceComparisonPredicate(
                            operation.type === 'filter' ? operation.predicate : predicate,
                            sourceFieldPaths
                          ).value,
                  },
                }))
              }
              size="sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
              {predicate.op === 'in'
                ? t('invoiceDesigner.transforms.inspector.valueList', { defaultValue: 'Values (comma separated)' })
                : t('invoiceDesigner.transforms.inspector.value', { defaultValue: 'Value' })}
            </label>
            <Input
              id={`transform-filter-value-${selectedOperation.id}`}
              value={Array.isArray(predicate.value) ? predicate.value.join(', ') : String(predicate.value ?? '')}
              onChange={(event) =>
                updateOperation(
                  selectedOperation.id,
                  (operation) => ({
                    ...operation,
                    predicate: {
                      ...coerceComparisonPredicate(
                        operation.type === 'filter' ? operation.predicate : predicate,
                        sourceFieldPaths
                      ),
                      value: parsePredicateValue(event.target.value, predicate.op),
                    },
                  }),
                  false
                )
              }
              onBlur={(event) =>
                updateOperation(selectedOperation.id, (operation) => ({
                  ...operation,
                  predicate: {
                    ...coerceComparisonPredicate(
                      operation.type === 'filter' ? operation.predicate : predicate,
                      sourceFieldPaths
                    ),
                    value: parsePredicateValue(event.target.value, predicate.op),
                  },
                }))
              }
            />
          </div>
        </div>
      );
    }

    if (selectedOperation.type === 'sort') {
      const keys = selectedOperation.keys;
      return (
        <div className="space-y-3">
          {keys.map((key, index) => (
            <div key={`${selectedOperation.id}-${index}`} className="rounded-md border border-slate-200 dark:border-[rgb(var(--color-border-200))] bg-slate-50 dark:bg-[rgb(var(--color-background))] p-3 space-y-2">
	              <div className="flex items-center justify-between">
	                <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">{t('invoiceDesigner.transforms.inspector.sortKey', { defaultValue: 'Sort key {{index}}', index: index + 1 })}</p>
	                <Button
	                  id={`transform-sort-remove-${selectedOperation.id}-${index}`}
	                  variant="outline"
	                  size="xs"
	                  disabled={keys.length === 1}
                  onClick={() =>
                    updateOperation(selectedOperation.id, (operation) => ({
                      ...operation,
                      keys: operation.type === 'sort'
                        ? operation.keys.filter((_entry, entryIndex) => entryIndex !== index)
                        : keys,
                    }))
                  }
                >
                  {t('invoiceDesigner.transforms.inspector.remove', { defaultValue: 'Remove' })}
                </Button>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
                  {t('invoiceDesigner.transforms.inspector.field', { defaultValue: 'Field' })}
                </label>
                <CustomSelect
                  id={`transform-sort-field-${selectedOperation.id}-${index}`}
                  options={sourceFieldPaths.map((path) => ({ value: path, label: path }))}
                  value={key.path}
                  onValueChange={(value: string) =>
                    updateOperation(selectedOperation.id, (operation) => ({
                      ...operation,
                      keys: operation.type === 'sort'
                        ? operation.keys.map((entry, entryIndex) =>
                            entryIndex === index ? { ...entry, path: value } : entry
                          )
                        : keys,
                    }))
                  }
                  size="sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
                  {t('invoiceDesigner.transforms.inspector.direction', { defaultValue: 'Direction' })}
                </label>
                <CustomSelect
                  id={`transform-sort-direction-${selectedOperation.id}-${index}`}
                  options={buildSortDirectionOptions(t)}
                  value={key.direction ?? 'asc'}
                  onValueChange={(value: string) =>
                    updateOperation(selectedOperation.id, (operation) => ({
                      ...operation,
                      keys: operation.type === 'sort'
                        ? operation.keys.map((entry, entryIndex) =>
                            entryIndex === index ? { ...entry, direction: value as TemplateSortKey['direction'] } : entry
                          )
                        : keys,
                    }))
                  }
                  size="sm"
                />
              </div>
            </div>
          ))}
	          <Button
	            id={`transform-sort-add-${selectedOperation.id}`}
	            variant="outline"
	            size="sm"
	            onClick={() =>
              updateOperation(selectedOperation.id, (operation) => ({
                ...operation,
                keys: operation.type === 'sort'
                  ? [...operation.keys, { path: sourceFieldPaths[0] ?? '', direction: 'asc' }]
                  : keys,
              }))
            }
          >
            {t('invoiceDesigner.transforms.inspector.addSortKey', { defaultValue: '+ Sort key' })}
          </Button>
        </div>
      );
    }

    if (selectedOperation.type === 'group') {
      return (
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
              {t('invoiceDesigner.transforms.inspector.groupField', { defaultValue: 'Group field' })}
            </label>
            <CustomSelect
              id={`transform-group-key-${selectedOperation.id}`}
              options={sourceFieldPaths.map((path) => ({ value: path, label: path }))}
              value={selectedOperation.key}
              onValueChange={(value: string) =>
                updateOperation(selectedOperation.id, (operation) => ({
                  ...operation,
                  key: value,
                }))
              }
              size="sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
              {t('invoiceDesigner.transforms.inspector.groupLabel', { defaultValue: 'Label (optional)' })}
            </label>
            <Input
              id={`transform-group-label-${selectedOperation.id}`}
              value={selectedOperation.label ?? ''}
              onChange={(event) =>
                updateOperation(
                  selectedOperation.id,
                  (operation) => ({
                    ...operation,
                    label: event.target.value,
                  }),
                  false
                )
              }
              onBlur={(event) =>
                updateOperation(selectedOperation.id, (operation) => ({
                  ...operation,
                  label: event.target.value,
                }))
              }
            />
          </div>
        </div>
      );
    }

    if (selectedOperation.type === 'aggregate') {
      const aggregations = selectedOperation.aggregations;
      return (
        <div className="space-y-3">
          {aggregations.map((aggregation, index) => (
            <div key={`${selectedOperation.id}-${index}`} className="rounded-md border border-slate-200 dark:border-[rgb(var(--color-border-200))] bg-slate-50 dark:bg-[rgb(var(--color-background))] p-3 space-y-2">
	              <div className="flex items-center justify-between">
	                <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">{t('invoiceDesigner.transforms.inspector.aggregation', { defaultValue: 'Aggregation {{index}}', index: index + 1 })}</p>
	                <Button
	                  id={`transform-aggregate-remove-${selectedOperation.id}-${index}`}
	                  variant="outline"
	                  size="xs"
	                  disabled={aggregations.length === 1}
                  onClick={() =>
                    updateOperation(selectedOperation.id, (operation) => ({
                      ...operation,
                      aggregations: operation.type === 'aggregate'
                        ? operation.aggregations.filter((_entry, entryIndex) => entryIndex !== index)
                        : aggregations,
                    }))
                  }
                >
                  {t('invoiceDesigner.transforms.inspector.remove', { defaultValue: 'Remove' })}
                </Button>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
                  {t('invoiceDesigner.transforms.inspector.outputId', { defaultValue: 'Output ID' })}
                </label>
                <Input
                  id={`transform-aggregate-id-${selectedOperation.id}-${index}`}
                  value={aggregation.id}
                  onChange={(event) =>
                    updateOperation(
                      selectedOperation.id,
                      (operation) => ({
                        ...operation,
                        aggregations: operation.type === 'aggregate'
                          ? operation.aggregations.map((entry, entryIndex) =>
                              entryIndex === index ? { ...entry, id: event.target.value } : entry
                            )
                          : aggregations,
                      }),
                      false
                    )
                  }
                  onBlur={(event) =>
                    updateOperation(selectedOperation.id, (operation) => ({
                      ...operation,
                      aggregations: operation.type === 'aggregate'
                        ? operation.aggregations.map((entry, entryIndex) =>
                            entryIndex === index ? { ...entry, id: event.target.value.trim() } : entry
                          )
                        : aggregations,
                    }))
                  }
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
                  {t('invoiceDesigner.transforms.inspector.operation', { defaultValue: 'Operation' })}
                </label>
                <CustomSelect
                  id={`transform-aggregate-op-${selectedOperation.id}-${index}`}
                  options={buildAggregationOptions(t)}
                  value={aggregation.op}
                  onValueChange={(value: string) =>
                    updateOperation(selectedOperation.id, (operation) => ({
                      ...operation,
                      aggregations: operation.type === 'aggregate'
                        ? operation.aggregations.map((entry, entryIndex) =>
                            entryIndex === index
                              ? {
                                  ...entry,
                                  op: value as TemplateAggregation['op'],
                                  ...(value === 'count' ? { path: undefined } : {}),
                                }
                              : entry
                          )
                        : aggregations,
                    }))
                  }
                  size="sm"
                />
              </div>
              {aggregation.op !== 'count' && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
                    {t('invoiceDesigner.transforms.inspector.field', { defaultValue: 'Field' })}
                  </label>
                  <CustomSelect
                    id={`transform-aggregate-path-${selectedOperation.id}-${index}`}
                    options={sourceFieldPaths.map((path) => ({ value: path, label: path }))}
                    value={aggregation.path ?? ''}
                    onValueChange={(value: string) =>
                      updateOperation(selectedOperation.id, (operation) => ({
                        ...operation,
                        aggregations: operation.type === 'aggregate'
                          ? operation.aggregations.map((entry, entryIndex) =>
                              entryIndex === index ? { ...entry, path: value } : entry
                            )
                          : aggregations,
                      }))
                    }
                    size="sm"
                  />
                </div>
              )}
            </div>
          ))}
	          <Button
	            id={`transform-aggregate-add-${selectedOperation.id}`}
	            variant="outline"
	            size="sm"
	            onClick={() =>
              updateOperation(selectedOperation.id, (operation) => ({
                ...operation,
                aggregations: operation.type === 'aggregate'
                  ? [
                      ...operation.aggregations,
                      {
                        id: `agg${operation.aggregations.length + 1}`,
                        op: 'sum',
                        path: sourceFieldPaths[0] ?? '',
                      },
                    ]
                  : aggregations,
              }))
            }
          >
            {t('invoiceDesigner.transforms.inspector.addAggregation', { defaultValue: '+ Aggregation' })}
          </Button>
        </div>
      );
    }

    return (
      <Alert variant="info">
        <AlertDescription>
          {t('invoiceDesigner.transforms.inspector.unsupportedOperation', {
            defaultValue:
              'This operation type is preserved in the workspace, but the V1 designer edits only filter, sort, group, and aggregate operations.',
          })}
        </AlertDescription>
      </Alert>
    );
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[280px_minmax(300px,1fr)_minmax(320px,1fr)]">
      <div className="space-y-4">
        <section className="rounded-lg border border-slate-200 dark:border-[rgb(var(--color-border-200))] bg-white dark:bg-[rgb(var(--color-card))] px-4 py-3 space-y-3">
          <div>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              {t('invoiceDesigner.transforms.source.title', { defaultValue: 'Source data' })}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('invoiceDesigner.transforms.source.description', {
                defaultValue: 'Pick preview data and choose the collection binding to shape.',
              })}
            </p>
          </div>
          <ViewSwitcher
            currentView={previewState.sourceKind}
            onChange={onSourceKindChange}
            options={buildPreviewSourceOptions(t)}
          />

          {previewState.sourceKind === 'sample' ? (
            <div className="space-y-1">
              {sampleScenarios.length > 0 && (
                <>
                  <label htmlFor="invoice-designer-transforms-sample-select" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {t('invoiceDesigner.transforms.source.sampleScenario', { defaultValue: 'Sample scenario' })}
                  </label>
                  <CustomSelect
                    id="invoice-designer-transforms-sample-select"
                    options={sampleScenarios.map((scenario) => ({
                      value: scenario.id,
                      label: scenario.label,
                    }))}
                    value={activeSample?.id ?? defaultSampleId ?? ''}
                    onValueChange={onSampleChange}
                    size="sm"
                  />
                </>
              )}
              {activeSample && <p className="text-xs text-slate-500 dark:text-slate-400">{activeSample.description}</p>}
            </div>
          ) : (
            <div className="space-y-2">
              <AsyncSearchableSelect
                id="invoice-designer-transforms-existing-select"
                value={previewState.selectedInvoiceId ?? ''}
                onChange={(value: string) => {
                  if (!value) {
                    onClearExistingInvoice();
                    return;
                  }
                  onExistingInvoiceChange(value);
                }}
                loadOptions={loadExistingInvoiceOptions}
                placeholder={existingSourceLabels.search}
                searchPlaceholder={t('designer.workspace.preview.searchInvoicesHint', {
                  defaultValue: 'Search by number or client...',
                })}
                emptyMessage={existingSourceLabels.empty}
                dropdownMode="overlay"
                label={existingSourceLabels.select}
              />
              {previewState.isInvoiceDetailLoading && (
                <p className="rounded border border-slate-200 dark:border-[rgb(var(--color-border-200))] bg-slate-50 dark:bg-[rgb(var(--color-background))] px-2 py-1 text-xs text-slate-500 dark:text-slate-400">
                  {existingSourceLabels.loading}
                </p>
              )}
              {previewState.invoiceDetailError && (
                <p className="rounded border border-destructive/30 bg-destructive/10 px-2 py-1 text-xs text-destructive">
                  {previewState.invoiceDetailError}
                </p>
              )}
            </div>
          )}

          <div className="space-y-1">
            <label htmlFor="invoice-designer-transforms-source-binding" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              {t('invoiceDesigner.transforms.source.collection', { defaultValue: 'Source collection' })}
            </label>
            <CustomSelect
              id="invoice-designer-transforms-source-binding"
              options={sourceCollectionOptions.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
              value={transforms.sourceBindingId}
              onValueChange={(value: string) =>
                updateTransforms((current) => ({
                  ...current,
                  sourceBindingId: value,
                  outputBindingId: ensureOutputBindingId(value, current.outputBindingId),
                }))
              }
              size="sm"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="invoice-designer-transforms-output-binding" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              {t('invoiceDesigner.transforms.source.outputBindingId', { defaultValue: 'Output binding ID' })}
            </label>
            <Input
              id="invoice-designer-transforms-output-binding"
              value={outputBindingDraft}
              onChange={(event) => setOutputBindingDraft(event.target.value)}
              onBlur={() =>
                updateTransforms((current) => ({
                  ...current,
                  outputBindingId: outputBindingDraft.trim(),
                }))
              }
              placeholder="items.transformed"
            />
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 dark:border-[rgb(var(--color-border-200))] bg-white dark:bg-[rgb(var(--color-card))] px-4 py-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              {t('invoiceDesigner.transforms.metadata.title', { defaultValue: 'Source metadata' })}
            </p>
            <span className="rounded bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-xs text-slate-600 dark:text-slate-400">
              {t('invoiceDesigner.transforms.rowCount', { defaultValue: '{{count}} rows', count: sourceCollection.length })}
            </span>
          </div>
          <div className="space-y-1 text-xs text-slate-600 dark:text-slate-400">
            <p>
              <span className="font-semibold text-slate-700 dark:text-slate-300">{t('invoiceDesigner.transforms.metadata.binding', { defaultValue: 'Binding:' })}</span>{' '}
              {transforms.sourceBindingId || t('invoiceDesigner.transforms.metadata.bindingNone', { defaultValue: 'None' })}
            </p>
            <p>
              <span className="font-semibold text-slate-700 dark:text-slate-300">{t('invoiceDesigner.transforms.metadata.resolvedPath', { defaultValue: 'Resolved path:' })}</span>{' '}
              {selectedSourceOption?.path ?? t('invoiceDesigner.transforms.metadata.pathNotResolved', { defaultValue: 'Not resolved' })}
            </p>
          </div>
          {sourceFieldPaths.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {sourceFieldPaths.map((path) => (
                <code key={path} className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-700 dark:text-slate-300">
                  {path}
                </code>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('invoiceDesigner.transforms.metadata.noFields', {
                defaultValue: 'Choose preview data and a collection binding to discover fields.',
              })}
            </p>
          )}
        </section>
      </div>

      <div className="space-y-4">
        <section className="rounded-lg border border-slate-200 dark:border-[rgb(var(--color-border-200))] bg-white dark:bg-[rgb(var(--color-card))] px-4 py-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                {t('invoiceDesigner.transforms.pipeline.title', { defaultValue: 'Transform pipeline' })}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('invoiceDesigner.transforms.pipeline.description', { defaultValue: 'Operations run top to bottom.' })}
              </p>
            </div>
          </div>
	          <div className="flex flex-wrap gap-2">
	            <Button id="transform-add-filter" size="sm" variant="outline" onClick={() => addOperation('filter')}>
	              {t('invoiceDesigner.transforms.pipeline.addFilter', { defaultValue: '+ Filter' })}
	            </Button>
	            <Button id="transform-add-sort" size="sm" variant="outline" onClick={() => addOperation('sort')}>
	              {t('invoiceDesigner.transforms.pipeline.addSort', { defaultValue: '+ Sort' })}
	            </Button>
	            <Button id="transform-add-group" size="sm" variant="outline" onClick={() => addOperation('group')}>
	              {t('invoiceDesigner.transforms.pipeline.addGroup', { defaultValue: '+ Group' })}
	            </Button>
	            <Button id="transform-add-aggregate" size="sm" variant="outline" onClick={() => addOperation('aggregate')}>
	              {t('invoiceDesigner.transforms.pipeline.addAggregate', { defaultValue: '+ Aggregate' })}
	            </Button>
	          </div>

          {transforms.operations.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-[rgb(var(--color-background))] px-3 py-6 text-sm text-slate-500 dark:text-slate-400">
              {t('invoiceDesigner.transforms.pipeline.empty', {
                defaultValue: 'Add operations to build the transform pipeline.',
              })}
            </div>
          ) : (
            <div className="space-y-2">
              {transforms.operations.map((operation, index) => {
                const isSelected = operation.id === selectedOperationId;
                return (
                  <div
                    key={operation.id}
                    role="button"
                    tabIndex={0}
                    className={`w-full rounded-lg border px-3 py-3 text-left transition ${
                      isSelected
                        ? 'border-sky-300 dark:border-sky-700 bg-sky-50 dark:bg-sky-900/30 shadow-sm'
                        : 'border-slate-200 dark:border-[rgb(var(--color-border-200))] bg-white dark:bg-[rgb(var(--color-card))] hover:border-slate-300 dark:hover:border-slate-500'
                    }`}
                    onClick={() => setSelectedOperationId(operation.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedOperationId(operation.id);
                      }
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-semibold text-slate-600 dark:text-slate-400">
                            {index + 1}
                          </span>
                          <span className="text-sm font-semibold capitalize text-slate-800 dark:text-slate-200">{operation.type}</span>
                        </div>
                        <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">{describeOperation(operation, t)}</p>
                      </div>
	                      <div className="flex shrink-0 items-center gap-1">
	                        <Button
	                          id={`transform-move-up-${operation.id}`}
	                          variant="outline"
	                          size="icon"
	                          className="h-7 w-7"
                          disabled={index === 0}
                          onClick={(event) => {
                            event.stopPropagation();
                            moveOperation(operation.id, -1);
                          }}
                          aria-label={t('invoiceDesigner.transforms.pipeline.moveUp', {
                            defaultValue: 'Move {{operation}} up',
                            operation: operation.id,
                          })}
                        >
                          ↑
                        </Button>
	                        <Button
	                          id={`transform-move-down-${operation.id}`}
	                          variant="outline"
	                          size="icon"
	                          className="h-7 w-7"
                          disabled={index === transforms.operations.length - 1}
                          onClick={(event) => {
                            event.stopPropagation();
                            moveOperation(operation.id, 1);
                          }}
                          aria-label={t('invoiceDesigner.transforms.pipeline.moveDown', {
                            defaultValue: 'Move {{operation}} down',
                            operation: operation.id,
                          })}
                        >
                          ↓
                        </Button>
	                        <Button
	                          id={`transform-duplicate-${operation.id}`}
	                          variant="outline"
	                          size="icon"
	                          className="h-7 w-7"
                          onClick={(event) => {
                            event.stopPropagation();
                            duplicateOperation(operation.id);
                          }}
                          aria-label={t('invoiceDesigner.transforms.pipeline.duplicate', {
                            defaultValue: 'Duplicate {{operation}}',
                            operation: operation.id,
                          })}
                        >
                          ⧉
                        </Button>
	                        <Button
	                          id={`transform-delete-${operation.id}`}
	                          variant="outline"
	                          size="icon"
	                          className="h-7 w-7"
                          onClick={(event) => {
                            event.stopPropagation();
                            removeOperation(operation.id);
                          }}
                          aria-label={t('invoiceDesigner.transforms.pipeline.delete', {
                            defaultValue: 'Delete {{operation}}',
                            operation: operation.id,
                          })}
                        >
                          ×
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-lg border border-slate-200 dark:border-[rgb(var(--color-border-200))] bg-white dark:bg-[rgb(var(--color-card))] px-4 py-3 space-y-3">
          <div>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              {t('designer.inspector.title', { defaultValue: 'Inspector' })}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('invoiceDesigner.transforms.inspector.description', {
                defaultValue: 'Edit the selected transform operation.',
              })}
            </p>
          </div>
          {renderInspector()}
        </section>
      </div>

      <div className="space-y-4">
        <section className="rounded-lg border border-slate-200 dark:border-[rgb(var(--color-border-200))] bg-white dark:bg-[rgb(var(--color-card))] px-4 py-3 space-y-3">
          <div>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              {t('invoiceDesigner.transforms.output.title', { defaultValue: 'Output preview' })}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('invoiceDesigner.transforms.output.description', {
                defaultValue: 'Preview rows generated from the current transform pipeline.',
              })}
            </p>
          </div>

          {combinedIssues.length > 0 && (
            <div className="space-y-2">
              {combinedIssues.map((issue) => (
                <Alert key={issue.key} variant={issue.tone === 'destructive' ? 'destructive' : 'warning'}>
                  <AlertDescription>{issue.text}</AlertDescription>
                </Alert>
              ))}
            </div>
          )}

          {outputPreview.rowPaths.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                {t('invoiceDesigner.transforms.output.rowPaths', { defaultValue: 'Available row paths' })}
              </p>
              <div className="flex flex-wrap gap-1">
                {outputPreview.rowPaths.map((path) => (
                  <code key={path} className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-700 dark:text-slate-300">
                    {path}
                  </code>
                ))}
              </div>
            </div>
          )}

          {outputPreview.groups ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                <span>
                  {t('invoiceDesigner.transforms.output.groupedRows', {
                    defaultValue: '{{count}} grouped rows',
                    count: outputPreview.groups.length,
                  })}
                </span>
                <span>
                  {t('invoiceDesigner.transforms.output.binding', {
                    defaultValue: 'Binding: {{binding}}',
                    binding:
                      transforms.outputBindingId ||
                      t('invoiceDesigner.transforms.output.bindingNotSet', { defaultValue: 'Not set' }),
                  })}
                </span>
              </div>
              {outputPreview.groups.slice(0, 5).map((group, index) => (
                <div key={`group-${index}`} className="rounded-md border border-slate-200 dark:border-[rgb(var(--color-border-200))] bg-slate-50 dark:bg-[rgb(var(--color-background))] p-3 space-y-1 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {t('invoiceDesigner.transforms.output.groupKey', {
                        defaultValue: 'key: {{value}}',
                        value: formatValuePreview(group.key),
                      })}
                    </span>
                    <span className="text-slate-500 dark:text-slate-400">
                      {t('invoiceDesigner.transforms.output.groupItems', {
                        defaultValue: '{{count}} items',
                        count: Array.isArray(group.items) ? group.items.length : 0,
                      })}
                    </span>
                  </div>
                  <pre className="overflow-x-auto rounded bg-white dark:bg-[rgb(var(--color-card))] p-2 text-[11px] text-slate-700 dark:text-slate-300">
                    {JSON.stringify(group.aggregates ?? {}, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          ) : outputPreview.rows.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                <span>
                  {t('invoiceDesigner.transforms.rowCount', {
                    defaultValue: '{{count}} rows',
                    count: outputPreview.rows.length,
                  })}
                </span>
                <span>
                  {t('invoiceDesigner.transforms.output.binding', {
                    defaultValue: 'Binding: {{binding}}',
                    binding:
                      transforms.outputBindingId ||
                      t('invoiceDesigner.transforms.output.bindingNotSet', { defaultValue: 'Not set' }),
                  })}
                </span>
              </div>
              <div className="space-y-2">
                {outputPreview.rows.slice(0, 5).map((row, index) => (
                  <pre key={`row-${index}`} className="overflow-x-auto rounded bg-slate-50 dark:bg-[rgb(var(--color-background))] p-2 text-[11px] text-slate-700 dark:text-slate-300">
                    {JSON.stringify(row, null, 2)}
                  </pre>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-[rgb(var(--color-background))] px-3 py-6 text-sm text-slate-500 dark:text-slate-400">
              {previewData
                ? t('invoiceDesigner.transforms.output.emptyConfigure', {
                    defaultValue: 'Configure the source, output binding, and operations to preview transformed rows.',
                  })
                : t('invoiceDesigner.transforms.output.emptyNoData', {
                    defaultValue: 'Choose preview data to inspect transformed output.',
                  })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default TransformsWorkspace;
