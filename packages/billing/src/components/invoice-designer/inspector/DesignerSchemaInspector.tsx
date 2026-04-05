import React, { useCallback, useMemo, useState } from 'react';
import { Input } from '@alga-psa/ui/components/Input';
import ColorPicker from '@alga-psa/ui/components/ColorPicker';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import {
  buildInvoiceExpressionPathOptions,
  type SharedExpressionPathOption,
} from '@alga-psa/workflows/expression-authoring';
import { getComponentSchema } from '../schema/componentSchema';
import type { DesignerNode } from '../state/designerStore';
import { useInvoiceDesignerStore } from '../state/designerStore';
import type {
  DesignerInspectorField,
  DesignerInspectorPanel,
  DesignerInspectorVisibleWhen,
} from '../schema/inspectorSchema';
import { TableEditorWidget } from './widgets/TableEditorWidget';
import {
  getTemplateFieldDefinition,
  humanizeBindingToken,
  type InvoiceFieldCategory,
} from '../fields/fieldCatalog';
import { resolveDesignerDocumentKind } from '../utils/documentKind';
import {
  normalizeCssColor,
  normalizeCssLength,
  normalizeNumber,
  normalizeString,
  normalizeStringLive,
} from './normalizers';
import {
  areCssLengthBoxValuesLinked,
  formatCssLength,
  formatCssLengthBox,
  getCssLengthStep,
  parseCssLength,
  parseCssLengthBox,
  type CssLengthUnit,
} from './cssLengthFields';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isIntegerKey = (key: string): boolean => key !== '' && String(Number.parseInt(key, 10)) === key;

const getIn = (value: unknown, path: string[]): unknown => {
  if (path.length === 0) return value;
  const [head, ...tail] = path;
  if (isIntegerKey(head)) {
    const index = Number.parseInt(head, 10);
    if (!Array.isArray(value)) return undefined;
    return getIn(value[index], tail);
  }
  if (!isPlainObject(value)) return undefined;
  return getIn(value[head], tail);
};

const splitDotPath = (path: string): string[] => path.split('.').map((segment) => segment.trim()).filter(Boolean);

// Inspector schemas currently use legacy root-level paths like `metadata.foo` and `layout.display`.
// The canonical node shape stores authored values under `props.*`.
const normalizeInspectorPath = (input: string): string => {
  const path = input.trim();
  if (path.startsWith('props.')) return path;
  if (path === 'name') return 'props.name';
  if (path === 'metadata' || path.startsWith('metadata.')) return `props.${path}`;
  if (path === 'layout' || path.startsWith('layout.')) return `props.${path}`;
  if (path === 'style' || path.startsWith('style.')) return `props.${path}`;
  return path;
};

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{6})$/;

const toPickerHexColor = (value: string): string | null => {
  if (!value) return null;
  return HEX_COLOR_RE.test(value) ? value : null;
};

type Props = {
  node: DesignerNode;
  nodesById: Map<string, DesignerNode>;
};

type ApplyNormalized = (path: string, next: unknown, commit: boolean) => void;

type BindingOption = {
  path: string;
  label: string;
  category: InvoiceFieldCategory;
  description: string;
  searchText: string;
};

const categoryLabelByRoot: Record<string, InvoiceFieldCategory> = {
  invoice: 'Invoice',
  customer: 'Customer',
  quote: 'Quote',
  quoteTotals: 'Quote Totals',
  client: 'Client',
  contact: 'Contact',
  tenant: 'Tenant',
  item: 'Line Item',
};

const toTitleCase = (value: string) =>
  value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());

const toBindingOption = (option: SharedExpressionPathOption): BindingOption | null => {
  const knownField = getTemplateFieldDefinition(option.path);
  if (knownField) {
    return {
      path: knownField.path,
      label: knownField.label,
      category: knownField.category,
      description: knownField.description,
      searchText: `${knownField.label} ${knownField.path} ${knownField.description} ${knownField.category}`.toLowerCase(),
    };
  }
  const category = categoryLabelByRoot[option.root];
  if (!category) return null;
  const pathSegments = option.path.split('.');
  if (pathSegments.length < 2 || !option.isLeaf) return null;
  const fieldName = pathSegments[pathSegments.length - 1]?.replace(/\[\]/g, '') ?? option.path;
  const categoryPrefix = category === 'Line Item' ? 'Item' : category;
  const label = category === 'Invoice' ? toTitleCase(fieldName) : `${categoryPrefix} ${toTitleCase(fieldName)}`;
  const description = option.description ?? option.path;
  return {
    path: option.path,
    label,
    category,
    description,
    searchText: `${label} ${option.path} ${description} ${category}`.toLowerCase(),
  };
};

type FieldBindingPickerProps = {
  nodeId: string;
  domId: string;
  label: string;
  path: string;
  value: string;
  applyNormalized: ApplyNormalized;
};

const FieldBindingPicker: React.FC<FieldBindingPickerProps> = ({
  nodeId,
  domId,
  label,
  path,
  value,
  applyNormalized,
}) => {
  const nodes = useInvoiceDesignerStore((state) => state.nodes);
  const documentKind = useMemo(() => resolveDesignerDocumentKind(nodes), [nodes]);
  const normalizedBinding = value.trim();
  const selectedDefinition = getTemplateFieldDefinition(normalizedBinding);
  const [query, setQuery] = useState('');
  const [customMode, setCustomMode] = useState(() => normalizedBinding.length > 0 && !selectedDefinition);

  React.useEffect(() => {
    setCustomMode(normalizedBinding.length > 0 && !getTemplateFieldDefinition(normalizedBinding));
    setQuery('');
  }, [nodeId, normalizedBinding]);

  const options = useMemo(() => {
    const seen = new Set<string>();
    return buildInvoiceExpressionPathOptions({
      mode: 'template',
      includeRootPaths: false,
      documentKind,
    })
      .map(toBindingOption)
      .filter((option): option is BindingOption => option !== null)
      .filter((option) => {
        if (seen.has(option.path)) {
          return false;
        }
        seen.add(option.path);
        return true;
      })
      .sort((left, right) => {
        if (left.category !== right.category) {
          return left.category.localeCompare(right.category);
        }
        return left.label.localeCompare(right.label);
      });
  }, [documentKind]);

  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return options;
    }
    return options.filter((option) => option.searchText.includes(normalizedQuery));
  }, [options, query]);

  const groupedOptions = useMemo(
    () =>
      filteredOptions.reduce<Record<string, BindingOption[]>>((acc, option) => {
        if (!acc[option.category]) {
          acc[option.category] = [];
        }
        acc[option.category].push(option);
        return acc;
      }, {}),
    [filteredOptions]
  );

  const currentLabel =
    selectedDefinition?.label ?? (normalizedBinding ? humanizeBindingToken(normalizedBinding) : 'No field selected');

  if (customMode) {
    return (
      <div key={`${nodeId}-${path}`} className="space-y-2">
        <label htmlFor={domId} className="text-xs text-slate-500 block mb-1">
          {label}
        </label>
        <Input
          id={domId}
          value={value}
          placeholder="invoice.number"
          data-template-insert-target={path}
          onChange={(event) => applyNormalized(path, normalizeStringLive(event.target.value), false)}
          onBlur={(event) => applyNormalized(path, normalizeString(event.target.value), true)}
        />
        <p className="text-[11px] text-slate-500">
          Type any binding path when the field you need is not listed.
        </p>
        <button
          type="button"
          className="rounded border border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:border-slate-400 hover:bg-slate-50"
          data-automation-id={`${domId}-use-picker`}
          onClick={() => {
            setQuery(normalizedBinding);
            setCustomMode(false);
          }}
        >
          Use field picker
        </button>
      </div>
    );
  }

  return (
    <div key={`${nodeId}-${path}`} className="space-y-2">
      <label htmlFor={`${domId}-search`} className="text-xs text-slate-500 block mb-1">
        {label}
      </label>
      <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-2 dark:border-[rgb(var(--color-border-200))] dark:bg-[rgb(var(--color-surface-100))]">
        <div className="text-[10px] uppercase tracking-wide text-slate-500">Current</div>
        <div className="text-sm font-medium text-slate-800 dark:text-slate-200">{currentLabel}</div>
        <div className="text-[11px] font-mono text-slate-500">{normalizedBinding || 'Unbound'}</div>
      </div>
      <Input
        id={`${domId}-search`}
        value={query}
        placeholder="Search fields..."
        data-automation-id={`${domId}-search`}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div
        className="max-h-56 space-y-2 overflow-y-auto rounded-md border border-slate-200 bg-white px-2 py-2 dark:border-[rgb(var(--color-border-200))] dark:bg-[rgb(var(--color-card))]"
        data-automation-id={`${domId}-results`}
      >
        {filteredOptions.length === 0 ? (
          <p className="text-[11px] text-slate-500">No matching fields.</p>
        ) : (
          Object.entries(groupedOptions).map(([category, categoryOptions]) => (
            <div key={category} className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{category}</p>
              {categoryOptions.map((option) => {
                const selected = option.path === normalizedBinding;
                return (
                  <button
                    key={option.path}
                    type="button"
                    className={`w-full rounded border px-2 py-1.5 text-left transition-colors ${
                      selected
                        ? 'border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-100'
                        : 'border-slate-200 bg-white text-slate-800 hover:border-blue-200 hover:bg-blue-50/40 dark:border-slate-700 dark:bg-[rgb(var(--color-card))] dark:text-slate-200 dark:hover:border-blue-700 dark:hover:bg-blue-900/20'
                    }`}
                    data-automation-id={`${domId}-option-${option.path.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                    onClick={() => {
                      applyNormalized(path, option.path, true);
                      setQuery('');
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium">{option.label}</span>
                      <span className="shrink-0 text-[10px] font-mono text-slate-500">{option.path}</span>
                    </div>
                    <p className="mt-1 text-[10px] text-slate-500">{option.description}</p>
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
      <button
        type="button"
        className="rounded border border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:border-slate-400 hover:bg-slate-50"
        data-automation-id={`${domId}-use-custom`}
        onClick={() => setCustomMode(true)}
      >
        Use custom path
      </button>
    </div>
  );
};

type CssLengthFieldProps = {
  domId: string;
  label: string;
  path: string;
  rawValue: string | undefined;
  allowedUnits?: CssLengthUnit[];
  defaultUnit?: CssLengthUnit;
  applyNormalized: ApplyNormalized;
};

const CssLengthStepperField: React.FC<CssLengthFieldProps> = ({
  domId,
  label,
  path,
  rawValue,
  allowedUnits,
  defaultUnit,
  applyNormalized,
}) => {
  const parsed = useMemo(
    () => parseCssLength(rawValue, { allowedUnits, defaultUnit }),
    [allowedUnits, defaultUnit, rawValue]
  );
  const valueAsString = parsed.value === null ? '' : String(parsed.value);

  const applyValue = (raw: string, commit: boolean) => {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      applyNormalized(path, undefined, commit);
      return;
    }
    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric)) {
      return;
    }
    applyNormalized(path, formatCssLength(numeric, parsed.unit), commit);
  };

  const handleUnitChange = (nextUnit: CssLengthUnit) => {
    if (parsed.value === null) {
      return;
    }
    applyNormalized(path, formatCssLength(parsed.value, nextUnit), true);
  };

  return (
    <div>
      <label htmlFor={domId} className="text-[10px] text-slate-500 block mb-1">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={domId}
          type="number"
          className="h-10 w-full rounded-md border border-[rgb(var(--color-border-400))] bg-white px-3 py-2 text-[rgb(var(--color-text-900))] shadow-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[rgb(var(--color-primary-500))] dark:bg-[rgb(var(--color-card))]"
          step={getCssLengthStep(parsed.unit)}
          value={valueAsString}
          data-automation-id={`${domId}-value`}
          onChange={(event) => applyValue(event.target.value, false)}
          onBlur={(event) => applyValue(event.target.value, true)}
          onWheel={(event) => (event.target as HTMLInputElement).blur()}
        />
        <CustomSelect
          id={`${domId}-unit`}
          value={parsed.unit}
          onValueChange={(value: string) => handleUnitChange(value as CssLengthUnit)}
          options={(allowedUnits ?? ['px', '%', 'rem']).map((unit) => ({ value: unit, label: unit }))}
          size="sm"
        />
      </div>
      {parsed.isCustom && parsed.raw ? (
        <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
          Custom CSS value preserved until edited: {parsed.raw}
        </p>
      ) : null}
    </div>
  );
};

const CssLengthBoxField: React.FC<CssLengthFieldProps> = ({
  domId,
  label,
  path,
  rawValue,
  allowedUnits,
  defaultUnit,
  applyNormalized,
}) => {
  const parsed = useMemo(
    () => parseCssLengthBox(rawValue, { allowedUnits, defaultUnit }),
    [allowedUnits, defaultUnit, rawValue]
  );
  const [linked, setLinked] = useState(() => areCssLengthBoxValuesLinked(parsed));

  const currentValues = {
    top: parsed.top,
    right: parsed.right,
    bottom: parsed.bottom,
    left: parsed.left,
  };

  const coerceNumber = (value: number | null): number => value ?? 0;

  const applyBoxValues = (
    values: { top: number | null; right: number | null; bottom: number | null; left: number | null },
    unit: CssLengthUnit,
    commit: boolean
  ) => {
    applyNormalized(path, formatCssLengthBox(values, unit), commit);
  };

  const handleSideChange = (
    side: 'top' | 'right' | 'bottom' | 'left',
    raw: string,
    commit: boolean
  ) => {
    const trimmed = raw.trim();
    const nextValue = trimmed.length === 0 ? null : Number(trimmed);
    if (trimmed.length > 0 && !Number.isFinite(nextValue)) {
      return;
    }

    const baseValues = {
      top: coerceNumber(currentValues.top),
      right: coerceNumber(currentValues.right),
      bottom: coerceNumber(currentValues.bottom),
      left: coerceNumber(currentValues.left),
    };
    const nextValues = linked
      ? { top: nextValue, right: nextValue, bottom: nextValue, left: nextValue }
      : { ...baseValues, [side]: nextValue };
    applyBoxValues(nextValues, parsed.unit, commit);
  };

  const handleLinkToggle = () => {
    if (linked) {
      setLinked(false);
      return;
    }

    const linkedValue =
      currentValues.top ?? currentValues.right ?? currentValues.bottom ?? currentValues.left ?? 0;
    const nextValues = {
      top: linkedValue,
      right: linkedValue,
      bottom: linkedValue,
      left: linkedValue,
    };
    setLinked(true);
    applyBoxValues(nextValues, parsed.unit, true);
  };

  const handleUnitChange = (nextUnit: CssLengthUnit) => {
    const hasAnyValue = Object.values(currentValues).some((value) => value !== null);
    if (!hasAnyValue) {
      return;
    }
    applyBoxValues(
      {
        top: coerceNumber(currentValues.top),
        right: coerceNumber(currentValues.right),
        bottom: coerceNumber(currentValues.bottom),
        left: coerceNumber(currentValues.left),
      },
      nextUnit,
      true
    );
  };

  const renderSideInput = (side: 'top' | 'right' | 'bottom' | 'left', shortLabel: string) => (
    <div key={side} className="space-y-1">
      <label className="block text-[10px] uppercase tracking-wide text-slate-500" htmlFor={`${domId}-${side}`}>
        {shortLabel}
      </label>
      <input
        id={`${domId}-${side}`}
        type="number"
        className="h-10 w-full rounded-md border border-[rgb(var(--color-border-400))] bg-white px-3 py-2 text-[rgb(var(--color-text-900))] shadow-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[rgb(var(--color-primary-500))] dark:bg-[rgb(var(--color-card))]"
        step={getCssLengthStep(parsed.unit)}
        value={currentValues[side] === null ? '' : String(currentValues[side])}
        data-automation-id={`${domId}-${side}`}
        onChange={(event) => handleSideChange(side, event.target.value, false)}
        onBlur={(event) => handleSideChange(side, event.target.value, true)}
        onWheel={(event) => (event.target as HTMLInputElement).blur()}
      />
    </div>
  );

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <label className="text-[10px] text-slate-500" htmlFor={`${domId}-top`}>
          {label}
        </label>
        <button
          type="button"
          className="rounded border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:bg-slate-800"
          aria-pressed={linked}
          data-automation-id={`${domId}-link-all`}
          onClick={handleLinkToggle}
        >
          Link all
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {renderSideInput('top', 'Top')}
        {renderSideInput('right', 'Right')}
        {renderSideInput('bottom', 'Bottom')}
        {renderSideInput('left', 'Left')}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-slate-500">Unit</span>
        <CustomSelect
          id={`${domId}-unit`}
          value={parsed.unit}
          onValueChange={(value: string) => handleUnitChange(value as CssLengthUnit)}
          options={(allowedUnits ?? ['px', '%', 'rem']).map((unit) => ({ value: unit, label: unit }))}
          size="sm"
        />
      </div>
      {parsed.isCustom && parsed.raw ? (
        <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
          Custom CSS value preserved until edited: {parsed.raw}
        </p>
      ) : null}
    </div>
  );
};

export const DesignerSchemaInspector: React.FC<Props> = ({ node, nodesById }) => {
  const setNodeProp = useInvoiceDesignerStore((state) => state.setNodeProp);
  const unsetNodeProp = useInvoiceDesignerStore((state) => state.unsetNodeProp);

  const schema = useMemo(() => getComponentSchema(node.type), [node.type]);
  const panels = schema.inspector?.panels ?? [];
  const parent = useMemo(
    () => (node.parentId ? nodesById.get(node.parentId) ?? null : null),
    [node.parentId, nodesById]
  );

  const resolveValue = useCallback(
    (field: DesignerInspectorField): unknown => {
      if (!('path' in field)) {
        return undefined;
      }
      return getIn(node, splitDotPath(normalizeInspectorPath(field.path)));
    },
    [node]
  );

  const resolveVisibleWhenValue = useCallback(
    (rule: DesignerInspectorVisibleWhen | undefined): boolean => {
      if (!rule || rule.kind === 'always') return true;
      if (rule.kind === 'nodeIsContainer') {
        return Array.isArray(node.allowedChildren) && node.allowedChildren.length > 0;
      }
      if (rule.kind === 'pathEquals') {
        const value = getIn(node, splitDotPath(normalizeInspectorPath(rule.path)));
        return value === rule.value;
      }
      if (rule.kind === 'parentPathEquals') {
        if (!parent) return false;
        const value = getIn(parent, splitDotPath(normalizeInspectorPath(rule.path)));
        return value === rule.value;
      }
      return true;
    },
    [node, parent]
  );

  const applyNormalized = useCallback(
    (path: string, next: unknown, commit: boolean) => {
      if (typeof next === 'undefined') {
        unsetNodeProp(node.id, path, commit);
        return;
      }
      setNodeProp(node.id, path, next, commit);
    },
    [node.id, setNodeProp, unsetNodeProp]
  );

  const renderField = (panel: DesignerInspectorPanel, field: DesignerInspectorField) => {
    if (!resolveVisibleWhenValue(field.visibleWhen)) {
      return null;
    }
    const domId = field.domId ?? `designer-inspector-${panel.id}-${field.id}`;

    if (field.kind === 'string') {
      const value = resolveValue(field);
      const valueAsString = typeof value === 'string' ? value : '';
      return (
        <div key={field.id}>
          <label htmlFor={domId} className="text-xs text-slate-500 block mb-1">
            {field.label}
          </label>
          <Input
            id={domId}
            value={valueAsString}
            placeholder={field.placeholder}
            data-template-insert-target={field.enableExpressionInsert ? field.path : undefined}
            onChange={(event) => applyNormalized(field.path, normalizeStringLive(event.target.value), false)}
            onBlur={(event) => applyNormalized(field.path, normalizeString(event.target.value), true)}
          />
        </div>
      );
    }

    if (field.kind === 'textarea') {
      const value = resolveValue(field);
      const valueAsString = typeof value === 'string' ? value : '';
      return (
        <div key={field.id}>
          <label htmlFor={domId} className="text-xs text-slate-500 block mb-1">
            {field.label}
          </label>
          <textarea
            id={domId}
            className="w-full border border-slate-300 rounded-md px-2 py-1 text-sm"
            value={valueAsString}
            placeholder={field.placeholder}
            data-template-insert-target={field.enableExpressionInsert ? field.path : undefined}
            onChange={(event) => applyNormalized(field.path, normalizeStringLive(event.target.value), false)}
            onBlur={(event) => applyNormalized(field.path, normalizeString(event.target.value), true)}
          />
        </div>
      );
    }

    if (field.kind === 'number') {
      const value = resolveValue(field);
      const valueAsString = typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
      return (
        <div key={field.id}>
          <label htmlFor={domId} className="text-xs text-slate-500 block mb-1">
            {field.label}
          </label>
          <Input
            id={domId}
            type="number"
            min={0}
            value={valueAsString}
            placeholder={field.placeholder}
            onChange={(event) => {
              applyNormalized(field.path, normalizeNumber(event.target.value), false);
            }}
            onBlur={(event) => {
              applyNormalized(field.path, normalizeNumber(event.target.value), true);
            }}
            onWheel={(event) => (event.target as HTMLInputElement).blur()}
          />
        </div>
      );
    }

    if (field.kind === 'enum') {
      const value = resolveValue(field);
      const valueAsString = typeof value === 'string' ? value : field.options[0]?.value ?? '';
      return (
        <div key={field.id}>
          <label htmlFor={domId} className="text-xs text-slate-500 block mb-1">
            {field.label}
          </label>
          <CustomSelect
            id={domId}
            options={field.options.map((option) => ({ value: option.value, label: option.label }))}
            value={valueAsString}
            onValueChange={(value: string) => setNodeProp(node.id, field.path, value, true)}
            size="sm"
          />
        </div>
      );
    }

    if (field.kind === 'css-length') {
      const value = resolveValue(field);
      const valueAsString = typeof value === 'string' ? value : '';
      return (
        <div key={field.id}>
          <label htmlFor={domId} className="text-[10px] text-slate-500 block mb-1">
            {field.label}
          </label>
          <Input
            id={domId}
            value={valueAsString}
            placeholder={field.placeholder}
            onChange={(event) => applyNormalized(field.path, normalizeCssLength(event.target.value), false)}
            onBlur={(event) => applyNormalized(field.path, normalizeCssLength(event.target.value), true)}
          />
        </div>
      );
    }

    if (field.kind === 'css-length-stepper') {
      const value = resolveValue(field);
      return (
        <CssLengthStepperField
          key={field.id}
          domId={domId}
          label={field.label}
          path={field.path}
          rawValue={typeof value === 'string' ? value : undefined}
          allowedUnits={field.allowedUnits}
          defaultUnit={field.defaultUnit}
          applyNormalized={applyNormalized}
        />
      );
    }

    if (field.kind === 'css-length-box') {
      const value = resolveValue(field);
      return (
        <CssLengthBoxField
          key={`${node.id}-${field.id}`}
          domId={domId}
          label={field.label}
          path={field.path}
          rawValue={typeof value === 'string' ? value : undefined}
          allowedUnits={field.allowedUnits}
          defaultUnit={field.defaultUnit}
          applyNormalized={applyNormalized}
        />
      );
    }

    if (field.kind === 'css-color') {
      const value = resolveValue(field);
      const valueAsString = typeof value === 'string' ? value : '';
      const pickerColor = toPickerHexColor(valueAsString);
      return (
        <div key={field.id}>
          <label htmlFor={domId} className="text-[10px] text-slate-500 block mb-1">
            {field.label}
          </label>
          <div className="flex items-center gap-2">
            <Input
              id={domId}
              className="flex-1"
              value={valueAsString}
              placeholder={field.placeholder}
              onChange={(event) => applyNormalized(field.path, normalizeCssColor(event.target.value), false)}
              onBlur={(event) => applyNormalized(field.path, normalizeCssColor(event.target.value), true)}
            />
            <ColorPicker
              currentBackgroundColor={pickerColor}
              currentTextColor={null}
              onSave={(backgroundColor) => applyNormalized(field.path, normalizeCssColor(backgroundColor ?? ''), true)}
              showTextColor={false}
              previewType="circle"
              colorMode="solid"
              trigger={
                <button
                  type="button"
                  id={`${domId}-color-picker`}
                  className="h-10 w-10 shrink-0 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-[rgb(var(--color-card))] p-1 transition-colors hover:border-slate-400 dark:hover:border-slate-500"
                  title={`Pick ${field.label.toLowerCase()}`}
                  aria-label={`Pick ${field.label.toLowerCase()}`}
                >
                  <span
                    className="block h-full w-full rounded"
                    style={{ backgroundColor: pickerColor ?? 'transparent' }}
                  />
                </button>
              }
            />
          </div>
        </div>
      );
    }

    if (field.kind === 'boolean') {
      const value = resolveValue(field);
      const checked = Boolean(value);
      return (
        <label key={field.id} className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
          <input
            id={domId}
            type="checkbox"
            checked={checked}
            onChange={(event) => setNodeProp(node.id, field.path, event.target.checked, true)}
          />
          {field.label}
        </label>
      );
    }

    if (field.kind === 'widget') {
      if (field.widget === 'table-editor') {
        return <TableEditorWidget key={field.id} node={node} />;
      }
      if (field.widget === 'field-binding-picker') {
        const value = resolveValue(field);
        return (
          <FieldBindingPicker
            key={`${node.id}-${field.id}`}
            nodeId={node.id}
            domId={domId}
            label={field.label}
            path={field.path}
            value={typeof value === 'string' ? value : ''}
            applyNormalized={applyNormalized}
          />
        );
      }
      return null;
    }

    return null;
  };

  if (panels.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3" data-automation-id="designer-schema-inspector">
      {panels
        .filter((panel) => resolveVisibleWhenValue(panel.visibleWhen))
        .map((panel) => (
          <div key={panel.id} className="rounded border border-slate-200 dark:border-[rgb(var(--color-border-200))] bg-white dark:bg-[rgb(var(--color-card))] px-3 py-2 space-y-2">
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">{panel.title}</p>
            <div className="space-y-2">{panel.fields.map((field) => renderField(panel, field))}</div>
          </div>
        ))}
    </div>
  );
};
