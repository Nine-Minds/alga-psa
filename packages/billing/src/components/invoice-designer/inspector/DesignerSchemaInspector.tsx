/* eslint-disable custom-rules/no-feature-to-feature-imports -- Invoice designer inspector uses shared expression-authoring utilities to enumerate template field bindings */
import React, { useCallback, useMemo, useState } from 'react';
import { Input } from '@alga-psa/ui/components/Input';
import ColorPicker from '@alga-psa/ui/components/ColorPicker';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { type SharedExpressionPathOption } from '@alga-psa/workflows/expression-authoring';
import { getComponentSchema } from '../schema/componentSchema';
import type { DesignerNode } from '../state/designerStore';
import {
  resolveDefaultLayerRename,
  resolveNewNodeBaseStyle,
  useInvoiceDesignerStore,
} from '../state/designerStore';
import { suggestLayerName } from '../utils/structureEditing';
import type {
  DesignerInspectorField,
  DesignerInspectorPanel,
  DesignerInspectorTab,
  DesignerInspectorTranslation,
  DesignerInspectorVisibleWhen,
} from '../schema/inspectorSchema';
import { TableEditorWidget } from './widgets/TableEditorWidget';
import { TotalsRowsEditorWidget } from './widgets/TotalsRowsEditorWidget';
import { StandardLabelControl } from './widgets/StandardLabelControl';
import {
  createLabelTranslationMetadata,
  createTextTranslationMetadata,
  getNodeLabelTranslation,
  getNodeTextTranslation,
  resolveAutoTranslation,
  TRANSLATION_OPT_OUT_KEY,
} from '../utils/translatableText';
import { getNodeMetadata } from '../utils/nodeProps';
import { isPlainObject, readFieldValue, isFieldSetOnNode, isRuleVisible } from './fieldState';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { type InvoiceFieldCategory } from '../fields/fieldCatalog';
import { resolveDesignerDocumentKind } from '../utils/documentKind';
import {
  buildDocumentExpressionPathOptions,
  describeBindingOption,
  isDocumentFieldPath,
  resolveDocumentFieldLabel,
} from '../fields/documentBindingCatalog';
import {
  normalizeCssColor,
  normalizeCssLength,
  normalizeNumber,
  normalizeString,
  normalizeStringLive,
} from './normalizers';
import {
  formatCssLength,
  formatCssLengthBox,
  getCssLengthStep,
  parseCssLength,
  parseCssLengthBox,
  type CssLengthUnit,
} from './cssLengthFields';

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{6})$/;

const toPickerHexColor = (value: string): string | null => {
  if (!value) return null;
  return HEX_COLOR_RE.test(value) ? value : null;
};

type Props = {
  node: DesignerNode;
  nodesById: Map<string, DesignerNode>;
  /** The inspector tab being shown (panels without a tab belong to 'content'); omitted, every panel shows. */
  tab?: DesignerInspectorTab;
};

type ApplyNormalized = (path: string, next: unknown, commit: boolean) => void;

/** Renames a still-generated layer name to describe its content (see resolveDefaultLayerRename). */
const renameIfDefault = (nodeId: string, suggestion: string | null) => {
  const state = useInvoiceDesignerStore.getState();
  const renamed = resolveDefaultLayerRename(state.nodes, nodeId, suggestion);
  if (renamed) state.setNodeProp(nodeId, 'name', renamed, true);
};

type BindingOption = {
  path: string;
  label: string;
  category: InvoiceFieldCategory;
  description: string;
  searchText: string;
};

const toBindingOption = (option: SharedExpressionPathOption): BindingOption | null => {
  const described = describeBindingOption(option);
  if (!described) return null;
  return {
    path: option.path,
    ...described,
    searchText: `${described.label} ${option.path} ${described.description} ${described.category}`.toLowerCase(),
  };
};

type InsertTokenControlProps = {
  domId: string;
  onInsert: (path: string) => void;
};

/** Searchable "insert data field" for text blocks: adds a {{path}} token without typing it. */
const InsertTokenControl: React.FC<InsertTokenControlProps> = ({ domId, onInsert }) => {
  const { t } = useTranslation('msp/invoicing');
  const nodes = useInvoiceDesignerStore((state) => state.nodes);
  const documentKind = useMemo(() => resolveDesignerDocumentKind(nodes), [nodes]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const options = useMemo(() => {
    const byPath = new Map<string, BindingOption>();
    buildDocumentExpressionPathOptions({ mode: 'template', includeRootPaths: false, documentKind })
      .map(toBindingOption)
      .forEach((option) => {
        if (option && !byPath.has(option.path)) byPath.set(option.path, option);
      });
    const normalized = query.trim().toLowerCase();
    return Array.from(byPath.values())
      .filter((option) => normalized.length === 0 || option.searchText.includes(normalized))
      .slice(0, 50);
  }, [documentKind, query]);

  const choose = (path: string) => {
    onInsert(path);
    setOpen(false);
    setQuery('');
  };

  if (!open) {
    return (
      <button
        type="button"
        id={domId}
        className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 underline hover:no-underline"
        onClick={() => setOpen(true)}
      >
        {t('designer.inspector.insertDataField', { defaultValue: '+ Insert data field…' })}
      </button>
    );
  }

  return (
    <div
      className="mt-1 space-y-1 rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-[rgb(var(--color-card))] p-1.5"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <Input
        id={`${domId}-search`}
        autoFocus
        value={query}
        placeholder={t('designer.inspector.searchDataFields', { defaultValue: 'Search data fields…' })}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && options[0]) {
            event.preventDefault();
            choose(options[0].path);
          }
        }}
        className="text-xs"
      />
      <div className="max-h-48 overflow-y-auto" role="listbox" aria-label={t('designer.inspector.dataFields', { defaultValue: 'Data fields' })}>
        {options.map((option) => (
          <button
            key={option.path}
            type="button"
            role="option"
            aria-selected={false}
            className="block w-full rounded px-1.5 py-1 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
            onClick={() => choose(option.path)}
          >
            <span className="font-medium text-slate-800 dark:text-slate-200">{option.label}</span>{' '}
            <span className="font-mono text-[10px] text-slate-500">{`{{${option.path}}}`}</span>
          </button>
        ))}
      </div>
    </div>
  );
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

  const currentNode = useInvoiceDesignerStore((state) => state.nodesById[nodeId] as DesignerNode | undefined);
  const rebindDataField = useInvoiceDesignerStore((state) => state.rebindDataField);
  const [query, setQuery] = useState('');
  const [customMode, setCustomMode] = useState(() => normalizedBinding.length > 0 && !isDocumentFieldPath(normalizedBinding));
  const currentPlaceholder = useMemo(() => {
    if (!currentNode || !isPlainObject(currentNode.props)) {
      return '';
    }
    const metadata = isPlainObject(currentNode.props.metadata) ? currentNode.props.metadata : null;
    return typeof metadata?.placeholder === 'string' ? metadata.placeholder.trim() : '';
  }, [currentNode]);
  const autoPlaceholderLabel = useMemo(() => resolveDocumentFieldLabel(normalizedBinding), [normalizedBinding]);
  React.useEffect(() => {
    setCustomMode(normalizedBinding.length > 0 && !isDocumentFieldPath(normalizedBinding));
    setQuery('');
  }, [nodeId, normalizedBinding]);

  const options = useMemo(() => {
    const seen = new Set<string>();
    return buildDocumentExpressionPathOptions({
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

  const chooseOption = (option: BindingOption) => {
    const shouldSyncPlaceholder =
      currentPlaceholder.length === 0 || currentPlaceholder === autoPlaceholderLabel;
    if (shouldSyncPlaceholder) {
      applyNormalized('metadata.placeholder', option.label, false);
    }
    // Format, label and layer name follow the binding as one undo step (shared with the FIELDS tab).
    rebindDataField(nodeId, option.path, option.label);
    setQuery('');
  };

  const resultsRef = React.useRef<HTMLDivElement | null>(null);

  const currentLabel = normalizedBinding ? resolveDocumentFieldLabel(normalizedBinding) : 'No field selected';

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
      <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-2 dark:border-[rgb(var(--color-border-200))] dark:bg-[rgb(var(--color-border-100))]">
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
        onKeyDown={(event) => {
          // Enter takes the best match; ArrowDown moves into the results.
          if (event.key === 'Enter' && filteredOptions[0]) {
            event.preventDefault();
            chooseOption(filteredOptions[0]);
          } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            resultsRef.current?.querySelector<HTMLButtonElement>('button[data-binding-option]')?.focus();
          }
        }}
      />
      <div
        ref={resultsRef}
        role="listbox"
        aria-label={label}
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
                    role="option"
                    aria-selected={selected}
                    className={`w-full rounded border px-2 py-1.5 text-left transition-colors ${
                      selected
                        ? 'border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-100'
                        : 'border-slate-200 bg-white text-slate-800 hover:border-blue-200 hover:bg-blue-50/40 dark:border-slate-700 dark:bg-[rgb(var(--color-card))] dark:text-slate-200 dark:hover:border-blue-700 dark:hover:bg-blue-900/20'
                    }`}
                    data-automation-id={`${domId}-option-${option.path.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                    onClick={() => chooseOption(option)}
                    onKeyDown={(event) => {
                      // Arrow keys walk the result list; the list's own buttons handle Enter.
                      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                        event.preventDefault();
                        const buttons = Array.from(
                          resultsRef.current?.querySelectorAll<HTMLButtonElement>('button[data-binding-option]') ?? []
                        );
                        const index = buttons.indexOf(event.currentTarget);
                        buttons[index + (event.key === 'ArrowDown' ? 1 : -1)]?.focus();
                      }
                    }}
                    data-binding-option
                  >
                    <span className="block text-xs font-medium break-words">{option.label}</span>
                    <span className="block text-[10px] font-mono text-slate-500 break-all">{option.path}</span>
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

type InspectorPanelProps = {
  panelId: string;
  title: string;
  setSummary: string | null;
  children: React.ReactNode;
};

/** An inspector section whose header says how many of its properties the block sets. */
const InspectorPanel: React.FC<InspectorPanelProps> = ({ panelId, title, setSummary, children }) => (
  <section
    className="rounded border border-slate-200 dark:border-[rgb(var(--color-border-200))] bg-white dark:bg-[rgb(var(--color-card))] px-3 py-2"
    data-automation-id={`designer-inspector-panel-${panelId}`}
    aria-label={title}
  >
    <div className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
      <span>{title}</span>
      {setSummary && (
        <span className="rounded-full bg-blue-50 dark:bg-blue-900/40 px-1.5 text-[10px] font-medium text-blue-700 dark:text-blue-300">
          {setSummary}
        </span>
      )}
    </div>
    <div className="mt-2 space-y-2">{children}</div>
  </section>
);

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
          showPlaceholderInDropdown={false}
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

type BoxSide = 'top' | 'right' | 'bottom' | 'left';
const BOX_SIDES: BoxSide[] = ['top', 'right', 'bottom', 'left'];

const CssLengthBoxField: React.FC<CssLengthFieldProps> = ({
  domId,
  label,
  path,
  rawValue,
  allowedUnits,
  defaultUnit,
  applyNormalized,
}) => {
  const { t } = useTranslation('msp/invoicing');
  const parsed = useMemo(
    () => parseCssLengthBox(rawValue, { allowedUnits, defaultUnit }),
    [allowedUnits, defaultUnit, rawValue]
  );
  // Sides are independent unless the author asks for one value on all sides;
  // the toggle's state is always visible (one input vs four).
  const [linked, setLinked] = useState(false);
  // Drafts let a side be emptied while typing without disturbing the others.
  const [drafts, setDrafts] = useState<Partial<Record<BoxSide | 'all', string>>>({});

  const sideValue = (side: BoxSide): number => parsed[side] ?? 0;
  const displayValue = (key: BoxSide | 'all'): string => {
    if (drafts[key] !== undefined) return drafts[key] as string;
    const value = key === 'all' ? parsed.top : parsed[key];
    return value === null ? '' : String(value);
  };

  const write = (values: Record<BoxSide, number>, unit: CssLengthUnit, commit: boolean) => {
    applyNormalized(path, formatCssLengthBox(values, unit), commit);
  };

  const handleChange = (key: BoxSide | 'all', raw: string, commit: boolean) => {
    const trimmed = raw.trim();
    const numeric = trimmed.length === 0 ? (commit ? 0 : null) : Number(trimmed);
    if (commit) {
      setDrafts((prev) => ({ ...prev, [key]: undefined }));
    } else {
      setDrafts((prev) => ({ ...prev, [key]: raw }));
    }
    if (numeric === null || !Number.isFinite(numeric)) {
      return;
    }
    const current = { top: sideValue('top'), right: sideValue('right'), bottom: sideValue('bottom'), left: sideValue('left') };
    const next = key === 'all'
      ? { top: numeric, right: numeric, bottom: numeric, left: numeric }
      : { ...current, [key]: numeric };
    write(next, parsed.unit, commit);
  };

  const handleLinkToggle = () => {
    if (linked) {
      setLinked(false);
      return;
    }
    setLinked(true);
    const value = parsed.top ?? 0;
    write({ top: value, right: value, bottom: value, left: value }, parsed.unit, true);
  };

  const handleUnitChange = (nextUnit: CssLengthUnit) => {
    write({ top: sideValue('top'), right: sideValue('right'), bottom: sideValue('bottom'), left: sideValue('left') }, nextUnit, true);
  };

  const sideLabels: Record<BoxSide | 'all', string> = {
    top: t('designer.inspector.box.top', { defaultValue: 'Top' }),
    right: t('designer.inspector.box.right', { defaultValue: 'Right' }),
    bottom: t('designer.inspector.box.bottom', { defaultValue: 'Bottom' }),
    left: t('designer.inspector.box.left', { defaultValue: 'Left' }),
    all: t('designer.inspector.box.all', { defaultValue: 'All sides' }),
  };

  const renderInput = (key: BoxSide | 'all') => (
    <div key={key} className="space-y-1">
      <label className="block text-[10px] uppercase tracking-wide text-slate-500" htmlFor={`${domId}-${key}`}>
        {sideLabels[key]}
      </label>
      <input
        id={`${domId}-${key}`}
        type="number"
        className="h-9 w-full rounded-md border border-[rgb(var(--color-border-400))] bg-white px-2 py-1 text-[rgb(var(--color-text-900))] shadow-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[rgb(var(--color-primary-500))] dark:bg-[rgb(var(--color-card))]"
        step={getCssLengthStep(parsed.unit)}
        value={displayValue(key)}
        data-automation-id={`${domId}-${key}`}
        onChange={(event) => handleChange(key, event.target.value, false)}
        onBlur={(event) => handleChange(key, event.target.value, true)}
        onWheel={(event) => (event.target as HTMLInputElement).blur()}
      />
    </div>
  );

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[10px] text-slate-500">{label}</span>
        <button
          type="button"
          className={[
            'rounded border px-2 py-1 text-[11px] font-medium transition-colors',
            linked
              ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
              : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:bg-slate-800',
          ].join(' ')}
          aria-pressed={linked}
          data-automation-id={`${domId}-link-all`}
          onClick={handleLinkToggle}
        >
          {t('designer.inspector.box.sameOnAllSides', { defaultValue: 'Same on all sides' })}
        </button>
      </div>
      {linked ? (
        renderInput('all')
      ) : (
        <div className="grid grid-cols-4 gap-1.5">{BOX_SIDES.map((side) => renderInput(side))}</div>
      )}
      <div className="mt-2 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-slate-500">{t('designer.inspector.box.unit', { defaultValue: 'Unit' })}</span>
        <CustomSelect
          id={`${domId}-unit`}
          value={parsed.unit}
          onValueChange={(value: string) => handleUnitChange(value as CssLengthUnit)}
          options={(allowedUnits ?? ['px', '%', 'rem']).map((unit) => ({ value: unit, label: unit }))}
          size="sm"
          showPlaceholderInDropdown={false}
        />
      </div>
      {parsed.isCustom && parsed.raw ? (
        <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
          {t('designer.inspector.box.customValue', {
            defaultValue: 'Custom CSS value kept until you edit a side: {{value}}',
            value: parsed.raw,
          })}
        </p>
      ) : null}
    </div>
  );
};

export const DesignerSchemaInspector: React.FC<Props> = ({ node, nodesById, tab }) => {
  const { t } = useTranslation('msp/invoicing');
  const translateFieldLabel = useCallback(
    (panel: DesignerInspectorPanel, field: DesignerInspectorField) =>
      t(`designer.schema.panels.${panel.id}.fields.${field.id}.label`, { defaultValue: 'label' in field ? (field as { label?: string }).label ?? field.id : field.id }),
    [t],
  );
  const translateOption = useCallback(
    (panel: DesignerInspectorPanel, field: DesignerInspectorField, optionValue: string, optionLabel: string) =>
      t(`designer.schema.panels.${panel.id}.fields.${field.id}.options.${optionValue}`, { defaultValue: optionLabel }),
    [t],
  );
  const setNodeProp = useInvoiceDesignerStore((state) => state.setNodeProp);
  const unsetNodeProp = useInvoiceDesignerStore((state) => state.unsetNodeProp);

  const schema = useMemo(() => getComponentSchema(node.type), [node.type]);
  const panels = (schema.inspector?.panels ?? []).filter((panel) => !tab || (panel.tab ?? 'content') === tab);
  const parent = useMemo(
    () => (node.parentId ? nodesById.get(node.parentId) ?? null : null),
    [node.parentId, nodesById]
  );

  const resolveValue = useCallback((field: DesignerInspectorField): unknown => readFieldValue(node, field), [node]);

  const isFieldSet = (field: DesignerInspectorField): boolean => isFieldSetOnNode(node, field);

  // Visible labels carry a dot when the block sets that property.
  const renderFieldLabel = (panel: DesignerInspectorPanel, field: DesignerInspectorField) => (
    <>
      {isFieldSet(field) && (
        <span aria-hidden className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-blue-500 align-middle" />
      )}
      {translateFieldLabel(panel, field)}
    </>
  );

  const resolveVisibleWhenValue = useCallback(
    (rule: DesignerInspectorVisibleWhen | undefined): boolean => isRuleVisible(rule, node, parent),
    [node, parent]
  );

  // While typing, an emptied field must stay empty: unsetting the prop mid-edit
  // lets defaults reappear under the caret. Blur commits the canonical (unset) value.
  const applyLive = useCallback(
    (path: string, raw: string, normalize: (raw: string) => unknown) => {
      if (raw.trim().length === 0) {
        setNodeProp(node.id, path, '', false);
        return;
      }
      const next = normalize(raw);
      if (typeof next !== 'undefined') {
        setNodeProp(node.id, path, next, false);
      }
    },
    [node.id, setNodeProp]
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

  // Placeholders are examples, not values: say so, or an empty field reads as set.
  const examplePlaceholder = (placeholder: string | undefined): string | undefined =>
    placeholder ? t('designer.inspector.examplePlaceholder', { defaultValue: 'e.g. {{value}}', value: placeholder }) : undefined;

  const renderTranslation = (
    translation: DesignerInspectorTranslation | undefined,
    domId: string
  ): React.ReactNode => {
    if (!translation) return null;
    const apply = (metadata: Record<string, unknown>) => {
      const entries = Object.entries(metadata);
      entries.forEach(([key, value], index) =>
        setNodeProp(node.id, `metadata.${key}`, value, index === entries.length - 1)
      );
    };
    return translation === 'text-content' ? (
      <StandardLabelControl
        domId={`${domId}-translation`}
        translation={getNodeTextTranslation(node)}
        onUseStandardLabel={(ref) => {
          unsetNodeProp(node.id, `metadata.${TRANSLATION_OPT_OUT_KEY}`, false);
          apply(createTextTranslationMetadata(ref));
          renameIfDefault(node.id, suggestLayerName({ i18nKey: ref.i18nKey }));
        }}
        onUseFixedText={() => {
          unsetNodeProp(node.id, 'metadata.__astContentPreviewText', false);
          unsetNodeProp(node.id, 'metadata.astContentExpression', false);
          setNodeProp(node.id, `metadata.${TRANSLATION_OPT_OUT_KEY}`, true, true);
        }}
      />
    ) : (
      <StandardLabelControl
        domId={`${domId}-translation`}
        translation={getNodeLabelTranslation(node)}
        onUseStandardLabel={(ref) => {
          unsetNodeProp(node.id, `metadata.${TRANSLATION_OPT_OUT_KEY}`, false);
          apply(createLabelTranslationMetadata(ref));
        }}
        onUseFixedText={() => {
          unsetNodeProp(node.id, 'metadata.__astLabelI18n', false);
          setNodeProp(node.id, `metadata.${TRANSLATION_OPT_OUT_KEY}`, true, true);
        }}
      />
    );
  };

  // After a translatable text is committed: link it when it is exactly a standard label.
  const autoLinkTranslation = (translation: DesignerInspectorTranslation | undefined, raw: string) => {
    if (!translation) return;
    const metadata = getNodeMetadata(node);
    const ref = resolveAutoTranslation(raw, metadata[TRANSLATION_OPT_OUT_KEY]);
    const current = translation === 'text-content' ? getNodeTextTranslation(node) : getNodeLabelTranslation(node);
    if (translation === 'text-content') {
      renameIfDefault(node.id, suggestLayerName(ref ? { i18nKey: ref.i18nKey } : { text: raw }));
    }
    if (!ref || current?.i18nKey === ref.i18nKey) return;
    const patch = translation === 'text-content' ? createTextTranslationMetadata(ref) : createLabelTranslationMetadata(ref);
    const entries = Object.entries(patch);
    entries.forEach(([key, value], index) => setNodeProp(node.id, `metadata.${key}`, value, index === entries.length - 1));
  };

  const renderField = (panel: DesignerInspectorPanel, field: DesignerInspectorField) => {
    if (!resolveVisibleWhenValue(field.visibleWhen)) {
      return null;
    }
    const domId = field.domId ?? `designer-inspector-${panel.id}-${field.id}`;

    if (field.kind === 'string') {
      const value = resolveValue(field);
      const valueAsString = typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
      return (
        <div key={field.id}>
          <label htmlFor={domId} className="text-xs text-slate-500 block mb-1">
            {renderFieldLabel(panel, field)}
          </label>
          <Input
            id={domId}
            value={valueAsString}
            placeholder={examplePlaceholder(field.placeholder)}
            data-template-insert-target={field.enableExpressionInsert ? field.path : undefined}
            onChange={(event) => applyLive(field.path, event.target.value, normalizeStringLive)}
            onBlur={(event) => {
              applyNormalized(field.path, normalizeString(event.target.value), true);
              autoLinkTranslation(field.translation, event.target.value);
            }}
          />
          {renderTranslation(field.translation, domId)}
        </div>
      );
    }

    if (field.kind === 'textarea') {
      const value = resolveValue(field);
      const valueAsString = typeof value === 'string' ? value : '';
      return (
        <div key={field.id}>
          <label htmlFor={domId} className="text-xs text-slate-500 block mb-1">
            {renderFieldLabel(panel, field)}
          </label>
          <textarea
            id={domId}
            className="w-full border border-slate-300 rounded-md px-2 py-1 text-sm"
            value={valueAsString}
            placeholder={field.placeholder}
            data-template-insert-target={field.enableExpressionInsert ? field.path : undefined}
            onChange={(event) => applyLive(field.path, event.target.value, normalizeStringLive)}
            onBlur={(event) => {
              applyNormalized(field.path, normalizeString(event.target.value), true);
              autoLinkTranslation(field.translation, event.target.value);
            }}
          />
          {field.enableExpressionInsert && (
            <InsertTokenControl
              domId={`${domId}-insert-field`}
              onInsert={(path) => {
                const token = `{{${path}}}`;
                const next = valueAsString.trim().length > 0 ? `${valueAsString.replace(/\s+$/, '')} ${token}` : token;
                applyNormalized(field.path, next, true);
                autoLinkTranslation(field.translation, next);
              }}
            />
          )}
          {renderTranslation(field.translation, domId)}
        </div>
      );
    }

    if (field.kind === 'number') {
      const value = resolveValue(field);
      const valueAsString = typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
      return (
        <div key={field.id}>
          <label htmlFor={domId} className="text-xs text-slate-500 block mb-1">
            {renderFieldLabel(panel, field)}
          </label>
          <Input
            id={domId}
            type="number"
            min={0}
            value={valueAsString}
            placeholder={examplePlaceholder(field.placeholder)}
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
      const valueAsString =
        typeof value === 'string' || typeof value === 'number' ? String(value) : field.options[0]?.value ?? '';
      return (
        <div key={field.id}>
          <label htmlFor={domId} className="text-xs text-slate-500 block mb-1">
            {renderFieldLabel(panel, field)}
          </label>
          <CustomSelect
            id={domId}
            options={field.options.map((option) => ({ value: option.value, label: translateOption(panel, field, option.value, option.label) }))}
            value={valueAsString}
            onValueChange={(value: string) => applyNormalized(field.path, value === '' ? undefined : value, true)}
            size="sm"
            showPlaceholderInDropdown={false}
          />
        </div>
      );
    }

    if (field.kind === 'icon-enum') {
      const value = resolveValue(field);
      const valueAsString = typeof value === 'string' ? value : field.options[0]?.value ?? '';
      const columns = field.columns ?? Math.min(field.options.length, 3);
      return (
        <div key={field.id}>
          <p className="text-xs text-slate-500 block mb-1">{translateFieldLabel(panel, field)}</p>
          <div id={domId} className="grid gap-1" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
            {field.options.map((option) => {
              const Icon = option.icon;
              const isSelected = option.value === valueAsString;
              return (
                <Tooltip key={option.value} content={option.tooltip ?? option.label}>
                  <button
                    type="button"
                    onClick={() => setNodeProp(node.id, field.path, option.value, true)}
                    className={[
                      'min-h-8 py-1 rounded border transition-colors inline-flex flex-col items-center justify-center gap-0.5',
                      isSelected
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                        : 'border-slate-200 dark:border-[rgb(var(--color-border-200))] text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                    ].join(' ')}
                    aria-pressed={isSelected}
                    aria-label={`${translateFieldLabel(panel, field)}: ${option.label}`}
                    data-automation-id={`designer-inspector-icon-enum-${field.id}-${option.value}`}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                    <span className="text-[10px] leading-none">{translateOption(panel, field, option.value, option.label)}</span>
                  </button>
                </Tooltip>
              );
            })}
          </div>
        </div>
      );
    }

    if (field.kind === 'css-length') {
      const value = resolveValue(field);
      const valueAsString = typeof value === 'string' ? value : '';
      return (
        <div key={field.id}>
          <label htmlFor={domId} className="text-[10px] text-slate-500 block mb-1">
            {renderFieldLabel(panel, field)}
          </label>
          <Input
            id={domId}
            value={valueAsString}
            placeholder={examplePlaceholder(field.placeholder)}
            onChange={(event) => applyLive(field.path, event.target.value, normalizeCssLength)}
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
          label={translateFieldLabel(panel, field)}
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
          label={translateFieldLabel(panel, field)}
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
            {renderFieldLabel(panel, field)}
          </label>
          <div className="flex items-center gap-2">
            <Input
              id={domId}
              className="flex-1"
              value={valueAsString}
              placeholder={examplePlaceholder(field.placeholder)}
              onChange={(event) => applyLive(field.path, event.target.value, normalizeCssColor)}
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
          {renderFieldLabel(panel, field)}
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
            label={translateFieldLabel(panel, field)}
            path={field.path}
            value={typeof value === 'string' ? value : ''}
            applyNormalized={applyNormalized}
          />
        );
      }
      if (field.widget === 'totals-rows-editor') {
        return <TotalsRowsEditorWidget key={`${node.id}-${field.id}`} node={node} />;
      }
      return null;
    }

    return null;
  };

  if (panels.length === 0) {
    return null;
  }

  const visiblePanels = panels.filter((panel) => resolveVisibleWhenValue(panel.visibleWhen));
  return (
    <div className="space-y-3 [&_input::placeholder]:italic [&_textarea::placeholder]:italic" data-automation-id="designer-schema-inspector">
      {visiblePanels.map((panel) => {
        const setCount = panel.fields.filter(
          (field) => resolveVisibleWhenValue(field.visibleWhen) && isFieldSet(field)
        ).length;
        return (
          <InspectorPanel
            key={panel.id}
            panelId={panel.id}
            title={t(`designer.schema.panels.${panel.id}.title`, { defaultValue: panel.title })}
            setSummary={
              setCount > 0 ? t('designer.inspector.setCount', { defaultValue: '{{count}} set', count: setCount }) : null
            }
          >
            {panel.fields.map((field) => renderField(panel, field))}
          </InspectorPanel>
        );
      })}
    </div>
  );
};
