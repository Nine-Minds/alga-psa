/* eslint-disable custom-rules/no-feature-to-feature-imports -- Invoice designer palette uses shared expression-authoring utilities to enumerate available template fields */
import React, { useMemo, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import {
  buildInvoiceExpressionPathOptions,
  type SharedExpressionPathOption,
} from '@alga-psa/workflows/expression-authoring';
import { COMPONENT_CATALOG, ComponentDefinition } from '../constants/componentCatalog';
import { LAYOUT_PRESETS } from '../constants/presets';
import { OutlineView } from './OutlineView';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import clsx from 'clsx';
import { useInvoiceDesignerStore } from '../state/designerStore';
import { resolveDesignerDocumentKind } from '../utils/documentKind';
import { getTemplateFieldDefinition, type InvoiceFieldCategory } from '../fields/fieldCatalog';

interface PaletteProps {
  onSearch?: (query: string) => void;
  onInsertComponent?: (componentType: ComponentDefinition['type']) => void;
  onInsertPreset?: (presetId: string) => void;
  onInsertTemplateVariable?: (bindingPath: string) => void;
}

const groupByCategory = (components: ComponentDefinition[]) => {
  return components.reduce<Record<string, ComponentDefinition[]>>((acc, component) => {
    if (!acc[component.category]) {
      acc[component.category] = [];
    }
    acc[component.category].push(component);
    return acc;
  }, {});
};

const paletteGroups = groupByCategory(COMPONENT_CATALOG);

type TemplateVariableOption = {
  path: string;
  label: string;
  category: InvoiceFieldCategory;
  description: string;
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

const toTemplateVariableOption = (option: SharedExpressionPathOption): TemplateVariableOption | null => {
  const knownField = getTemplateFieldDefinition(option.path);
  if (knownField) {
    return {
      path: knownField.path,
      label: knownField.label,
      category: knownField.category,
      description: knownField.description,
    };
  }
  const category = categoryLabelByRoot[option.root];
  if (!category) return null;
  const pathSegments = option.path.split('.');
  if (pathSegments.length < 2 || !option.isLeaf) return null;
  const fieldName = pathSegments[pathSegments.length - 1]?.replace(/\[\]/g, '') ?? option.path;
  const categoryPrefix = category === 'Line Item' ? 'Item' : category;
  const fieldLabel = toTitleCase(fieldName);
  return {
    path: option.path,
    label: category === 'Invoice' ? fieldLabel : `${categoryPrefix} ${fieldLabel}`,
    category,
    description: option.description ?? option.path,
  };
};

const groupTemplateVariablesByCategory = (variables: TemplateVariableOption[]) =>
  variables.reduce<Record<InvoiceFieldCategory, TemplateVariableOption[]>>((acc, variable) => {
    if (!acc[variable.category]) {
      acc[variable.category] = [] as TemplateVariableOption[];
    }
    acc[variable.category].push(variable);
    return acc;
  }, {} as Record<InvoiceFieldCategory, TemplateVariableOption[]>);

type PaletteDragData =
  | {
      source: 'component';
      componentType: ComponentDefinition['type'];
    }
  | {
      source: 'preset';
      presetId: string;
    };

interface CompactPaletteRowProps {
  draggableId: string;
  draggableData: PaletteDragData;
  label: string;
  description: string;
  icon: string;
  dataComponentType?: string;
  addAutomationId?: string;
  addAriaLabel?: string;
  onAdd?: () => void;
}

const CompactPaletteRow: React.FC<CompactPaletteRowProps> = ({
  draggableId,
  draggableData,
  label,
  description,
  icon,
  dataComponentType,
  addAutomationId,
  addAriaLabel,
  onAdd,
}) => {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: draggableId,
    data: draggableData,
  });

  return (
    <div
      ref={setNodeRef}
      className={clsx(
        'group w-full cursor-grab active:cursor-grabbing rounded border px-2 py-1.5 transition-colors',
        isDragging
          ? 'opacity-60 border-dashed border-slate-300 dark:border-slate-600 bg-white dark:bg-[rgb(var(--color-card))]'
          : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-[rgb(var(--color-card))] hover:bg-blue-50/40 dark:hover:bg-blue-900/20 hover:border-blue-200 dark:hover:border-blue-700 focus-within:bg-blue-50/40 dark:focus-within:bg-blue-900/20 focus-within:border-blue-300 dark:focus-within:border-blue-700'
      )}
      data-component-type={dataComponentType}
      {...listeners}
      {...attributes}
      title={description}
    >
      <div className="flex items-center justify-between gap-1.5">
        <div className="min-w-0 flex flex-1 items-center gap-1.5">
          <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded bg-slate-100 dark:bg-slate-700 text-[9px] font-semibold text-slate-600 dark:text-slate-300">
            {icon}
          </span>
          <span className="truncate text-xs font-medium text-slate-800 dark:text-slate-200">{label}</span>
          <span className="hidden truncate text-[10px] text-slate-400 group-hover:inline">{description}</span>
        </div>
        {onAdd && (
          <button
            type="button"
            className="h-5 w-5 shrink-0 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-[11px] font-semibold leading-none text-slate-600 dark:text-slate-400 transition-colors hover:bg-slate-100 dark:hover:bg-slate-700 group-hover:border-blue-400 group-hover:bg-blue-50 dark:group-hover:bg-blue-900/30 group-hover:text-blue-700 dark:group-hover:text-blue-400 group-focus-within:border-blue-400 group-focus-within:bg-blue-50 dark:group-focus-within:bg-blue-900/30 group-focus-within:text-blue-700 dark:group-focus-within:text-blue-400"
            data-automation-id={addAutomationId}
            aria-label={addAriaLabel}
            title={addAriaLabel}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onAdd();
            }}
          >
            +
          </button>
        )}
      </div>
    </div>
  );
};

interface TemplateVariableRowProps {
  option: TemplateVariableOption;
  onInsert?: (bindingPath: string) => void;
}

const TemplateVariableRow: React.FC<TemplateVariableRowProps> = ({ option, onInsert }) => {
  const { t } = useTranslation('msp/invoicing');
  const token = `{{${option.path}}}`;
  const automationKey = option.path.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const keySlug = option.path.replace(/\./g, '_');
  const translatedLabel = t(`designer.fields.${keySlug}.label`, { defaultValue: option.label });
  const translatedDescription = t(`designer.fields.${keySlug}.description`, { defaultValue: option.description });
  return (
    <button
      type="button"
      className={clsx(
        'w-full rounded border px-2 py-1.5 text-left transition-colors',
        'border-slate-200 dark:border-slate-600 bg-white dark:bg-[rgb(var(--color-card))]',
        'hover:bg-blue-50/40 dark:hover:bg-blue-900/20 hover:border-blue-200 dark:hover:border-blue-700',
        'focus:outline-none focus:ring-2 focus:ring-blue-500/40'
      )}
      onClick={() => onInsert?.(option.path)}
      title={translatedDescription}
      data-automation-id={`designer-template-variable-${automationKey}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium text-slate-800 dark:text-slate-200">{translatedLabel}</span>
        <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-600 dark:bg-slate-700 dark:text-slate-300">
          {token}
        </span>
      </div>
      <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">{translatedDescription}</p>
    </button>
  );
};

export const ComponentPalette: React.FC<PaletteProps> = ({
  onInsertComponent,
  onInsertPreset,
  onInsertTemplateVariable,
}) => {
  const { t } = useTranslation('msp/invoicing');
  const nodes = useInvoiceDesignerStore((state) => state.nodes);
  const documentKind = useMemo(() => resolveDesignerDocumentKind(nodes), [nodes]);
  const [activeTab, setActiveTab] = useState<'blocks' | 'presets' | 'fields' | 'outline'>('blocks');
  const [searchQuery, setSearchQuery] = useState('');

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const filteredPaletteGroups = useMemo<Record<string, ComponentDefinition[]>>(() => {
    if (!normalizedQuery) {
      return paletteGroups;
    }
    return Object.entries(paletteGroups).reduce<Record<string, ComponentDefinition[]>>((acc, [category, components]) => {
      const filtered = components.filter((component) => {
        const haystack = `${component.label} ${component.description}`.toLowerCase();
        return haystack.includes(normalizedQuery);
      });
      if (filtered.length > 0) {
        acc[category] = filtered;
      }
      return acc;
    }, {});
  }, [normalizedQuery]);

  const filteredPresets = useMemo(() => {
    if (!normalizedQuery) {
      return LAYOUT_PRESETS;
    }
    return LAYOUT_PRESETS.filter((preset) =>
      `${preset.label} ${preset.description}`.toLowerCase().includes(normalizedQuery)
    );
  }, [normalizedQuery]);

  const templateVariableGroups = useMemo(() => {
    const pathOptions = buildInvoiceExpressionPathOptions({
      mode: 'template',
      includeRootPaths: false,
      documentKind,
    });

    const variables = pathOptions
      .map(toTemplateVariableOption)
      .filter((option): option is TemplateVariableOption => option !== null);

    return groupTemplateVariablesByCategory(variables);
  }, [documentKind]);

  const filteredTemplateVariableGroups = useMemo<Record<string, TemplateVariableOption[]>>(() => {
    if (!normalizedQuery) {
      return templateVariableGroups;
    }
    return Object.entries(templateVariableGroups).reduce<Record<string, TemplateVariableOption[]>>(
      (acc, [category, variables]) => {
        const filtered = variables.filter((option) => {
          const haystack = `${option.label} ${option.path} ${option.description}`.toLowerCase();
          return haystack.includes(normalizedQuery);
        });
        if (filtered.length > 0) {
          acc[category] = filtered;
        }
        return acc;
      },
      {}
    );
  }, [normalizedQuery, templateVariableGroups]);

  return (
    <div className="flex flex-col h-full border-r border-slate-200 dark:border-[rgb(var(--color-border-200))] bg-slate-50 dark:bg-[rgb(var(--color-card))]">
      <div className="border-b border-slate-200 dark:border-[rgb(var(--color-border-200))] bg-white dark:bg-[rgb(var(--color-card))] px-3 py-2">
        <div className="flex gap-3">
          <button
            className={clsx(
              'pb-1 text-[11px] font-semibold tracking-wide border-b-2 transition-colors',
              activeTab === 'blocks' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
            )}
            onClick={() => setActiveTab('blocks')}
          >
            {t('designer.palette.tabs.blocks', { defaultValue: 'BLOCKS' })}
          </button>
          <button
            className={clsx(
              'pb-1 text-[11px] font-semibold tracking-wide border-b-2 transition-colors',
              activeTab === 'presets' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
            )}
            onClick={() => setActiveTab('presets')}
          >
            {t('designer.palette.tabs.presets', { defaultValue: 'PRESETS' })}
          </button>
          <button
            className={clsx(
              'pb-1 text-[11px] font-semibold tracking-wide border-b-2 transition-colors',
              activeTab === 'fields' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
            )}
            onClick={() => setActiveTab('fields')}
          >
            {t('designer.palette.tabs.fields', { defaultValue: 'FIELDS' })}
          </button>
          <button
            className={clsx(
              'pb-1 text-[11px] font-semibold tracking-wide border-b-2 transition-colors',
              activeTab === 'outline' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
            )}
            onClick={() => setActiveTab('outline')}
          >
            {t('designer.palette.tabs.outline', { defaultValue: 'OUTLINE' })}
          </button>
        </div>
        {activeTab !== 'outline' && (
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="mt-2 h-7 w-full rounded border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-[rgb(var(--color-background))] px-2 text-xs text-slate-700 dark:text-slate-300 outline-none focus:border-blue-400"
            placeholder={
              activeTab === 'blocks'
                ? t('designer.palette.search.blocks', { defaultValue: 'Search blocks...' })
                : activeTab === 'presets'
                  ? t('designer.palette.search.presets', { defaultValue: 'Search presets...' })
                  : t('designer.palette.search.fields', { defaultValue: 'Search fields...' })
            }
            data-automation-id="designer-palette-search"
          />
        )}
      </div>
      
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'blocks' ? (
          <div className="px-2 py-2 space-y-2">
            <p className="px-1 text-[11px] text-slate-500 dark:text-slate-400">{t('designer.palette.dragHint', { defaultValue: 'Drag or tap `+` to insert.' })}</p>
            {Object.entries(filteredPaletteGroups).map(([category, components]) => (
              <section key={category}>
                <h4 className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {t(`designer.palette.categories.${category.toLowerCase()}`, { defaultValue: category })}
                </h4>
                {components.map((component) => {
                  const translatedLabel = t(`designer.blocks.${component.type}.label`, { defaultValue: component.label });
                  return (
                    <CompactPaletteRow
                      key={component.type}
                      draggableId={`component-${component.type}`}
                      draggableData={{ source: 'component', componentType: component.type }}
                      label={translatedLabel}
                      description={t(`designer.blocks.${component.type}.description`, { defaultValue: component.description })}
                      icon={component.category.charAt(0)}
                      dataComponentType={component.type}
                      addAutomationId={`designer-palette-add-${component.type}`}
                      addAriaLabel={t('designer.palette.addAriaLabel', { defaultValue: 'Add {{label}}', label: translatedLabel })}
                      onAdd={onInsertComponent ? () => onInsertComponent(component.type) : undefined}
                    />
                  );
                })}
              </section>
            ))}
            {Object.keys(filteredPaletteGroups).length === 0 && (
              <p className="px-1 text-xs text-slate-500">{t('designer.palette.noBlocksMatch', { defaultValue: 'No blocks match this search.' })}</p>
            )}
          </div>
        ) : activeTab === 'presets' ? (
          <div className="px-2 py-2">
            <div className="rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50/70 dark:bg-blue-900/20 p-2 shadow-[inset_3px_0_0_0_rgb(59,130,246)]">
              <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-400">
                {t('designer.palette.presets.sectionTitle', { defaultValue: 'Macro Templates' })}
              </p>
              <p className="mb-2 px-1 text-[11px] text-blue-700/80 dark:text-blue-400/80">{t('designer.palette.presets.sectionDescription', { defaultValue: 'Preset bundles for common invoice sections.' })}</p>
              <div className="space-y-1">
                {filteredPresets.map((preset) => {
                  const translatedLabel = t(`designer.presets.${preset.id}.label`, { defaultValue: preset.label });
                  return (
                    <CompactPaletteRow
                      key={preset.id}
                      draggableId={`preset-${preset.id}`}
                      draggableData={{ source: 'preset', presetId: preset.id }}
                      label={translatedLabel}
                      description={t(`designer.presets.${preset.id}.description`, { defaultValue: preset.description })}
                      icon="P"
                      addAutomationId={`designer-palette-add-preset-${preset.id}`}
                      addAriaLabel={t('designer.palette.addAriaLabel', { defaultValue: 'Add {{label}}', label: translatedLabel })}
                      onAdd={onInsertPreset ? () => onInsertPreset(preset.id) : undefined}
                    />
                  );
                })}
                {filteredPresets.length === 0 && (
                  <p className="px-1 text-xs text-blue-700/80">{t('designer.palette.noPresetsMatch', { defaultValue: 'No presets match this search.' })}</p>
                )}
              </div>
            </div>
          </div>
        ) : activeTab === 'fields' ? (
          <div className="px-2 py-2 space-y-2">
            <p className="px-1 text-[11px] text-slate-500 dark:text-slate-400">
              {t('designer.palette.fields.insertHint', { defaultValue: 'Click a field to insert into the focused text input.' })}
            </p>
            {Object.entries(filteredTemplateVariableGroups).map(([category, variables]) => (
              <section key={category}>
                <h4 className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {t(`designer.palette.fields.categories.${category.toLowerCase().replace(/\s+/g, '-')}`, { defaultValue: category })}
                </h4>
                <div className="space-y-1">
                  {variables.map((option) => (
                    <TemplateVariableRow
                      key={option.path}
                      option={option}
                      onInsert={onInsertTemplateVariable}
                    />
                  ))}
                </div>
              </section>
            ))}
            {Object.keys(filteredTemplateVariableGroups).length === 0 && (
              <p className="px-1 text-xs text-slate-500">{t('designer.palette.noFieldsMatch', { defaultValue: 'No fields match this search.' })}</p>
            )}
          </div>
        ) : (
          <OutlineView />
        )}
      </div>
    </div>
  );
};
