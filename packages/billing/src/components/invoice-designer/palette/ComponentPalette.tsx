import React, { useMemo, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { COMPONENT_CATALOG, ComponentDefinition } from '../constants/componentCatalog';
import { LAYOUT_PRESETS } from '../constants/presets';
import { OutlineView } from './OutlineView';
import clsx from 'clsx';

interface PaletteProps {
  onSearch?: (query: string) => void;
  onInsertComponent?: (componentType: ComponentDefinition['type']) => void;
  onInsertPreset?: (presetId: string) => void;
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
          ? 'opacity-60 border-dashed border-slate-300 bg-white'
          : 'border-slate-200 bg-white hover:bg-blue-50/40 hover:border-blue-200 focus-within:bg-blue-50/40 focus-within:border-blue-300'
      )}
      data-component-type={dataComponentType}
      {...listeners}
      {...attributes}
      title={description}
    >
      <div className="flex items-center justify-between gap-1.5">
        <div className="min-w-0 flex flex-1 items-center gap-1.5">
          <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded bg-slate-100 text-[9px] font-semibold text-slate-600">
            {icon}
          </span>
          <span className="truncate text-xs font-medium text-slate-800">{label}</span>
          <span className="hidden truncate text-[10px] text-slate-400 group-hover:inline">{description}</span>
        </div>
        {onAdd && (
          <button
            type="button"
            className="h-5 w-5 shrink-0 rounded border border-slate-300 bg-white text-[11px] font-semibold leading-none text-slate-600 transition-colors hover:bg-slate-100 group-hover:border-blue-400 group-hover:bg-blue-50 group-hover:text-blue-700 group-focus-within:border-blue-400 group-focus-within:bg-blue-50 group-focus-within:text-blue-700"
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

export const ComponentPalette: React.FC<PaletteProps> = ({ onInsertComponent, onInsertPreset }) => {
  const [activeTab, setActiveTab] = useState<'blocks' | 'presets' | 'outline'>('blocks');
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

  return (
    <div className="flex flex-col h-full border-r border-slate-200 bg-slate-50">
      <div className="border-b border-slate-200 bg-white px-3 py-2">
        <div className="flex gap-3">
          <button
            className={clsx(
              'pb-1 text-[11px] font-semibold tracking-wide border-b-2 transition-colors',
              activeTab === 'blocks' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            )}
            onClick={() => setActiveTab('blocks')}
          >
            BLOCKS
          </button>
          <button
            className={clsx(
              'pb-1 text-[11px] font-semibold tracking-wide border-b-2 transition-colors',
              activeTab === 'presets' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            )}
            onClick={() => setActiveTab('presets')}
          >
            PRESETS
          </button>
          <button
            className={clsx(
              'pb-1 text-[11px] font-semibold tracking-wide border-b-2 transition-colors',
              activeTab === 'outline' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            )}
            onClick={() => setActiveTab('outline')}
          >
            OUTLINE
          </button>
        </div>
        {activeTab !== 'outline' && (
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="mt-2 h-7 w-full rounded border border-slate-200 bg-slate-50 px-2 text-xs text-slate-700 outline-none focus:border-blue-400"
            placeholder={activeTab === 'blocks' ? 'Search blocks...' : 'Search presets...'}
            data-automation-id="designer-palette-search"
          />
        )}
      </div>
      
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'blocks' ? (
          <div className="px-2 py-2 space-y-2">
            <p className="px-1 text-[11px] text-slate-500">Drag or tap `+` to insert.</p>
            {Object.entries(filteredPaletteGroups).map(([category, components]) => (
              <section key={category}>
                <h4 className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">{category}</h4>
                {components.map((component) => (
                  <CompactPaletteRow
                    key={component.type}
                    draggableId={`component-${component.type}`}
                    draggableData={{ source: 'component', componentType: component.type }}
                    label={component.label}
                    description={component.description}
                    icon={component.category.charAt(0)}
                    dataComponentType={component.type}
                    addAutomationId={`designer-palette-add-${component.type}`}
                    addAriaLabel={`Add ${component.label}`}
                    onAdd={onInsertComponent ? () => onInsertComponent(component.type) : undefined}
                  />
                ))}
              </section>
            ))}
            {Object.keys(filteredPaletteGroups).length === 0 && (
              <p className="px-1 text-xs text-slate-500">No blocks match this search.</p>
            )}
          </div>
        ) : activeTab === 'presets' ? (
          <div className="px-2 py-2">
            <div className="rounded-md border border-blue-200 bg-blue-50/70 p-2 shadow-[inset_3px_0_0_0_rgb(59,130,246)]">
              <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-blue-700">
                Macro Templates
              </p>
              <p className="mb-2 px-1 text-[11px] text-blue-700/80">Preset bundles for common invoice sections.</p>
              <div className="space-y-1">
                {filteredPresets.map((preset) => (
                  <CompactPaletteRow
                    key={preset.id}
                    draggableId={`preset-${preset.id}`}
                    draggableData={{ source: 'preset', presetId: preset.id }}
                    label={preset.label}
                    description={preset.description}
                    icon="P"
                    addAutomationId={`designer-palette-add-preset-${preset.id}`}
                    addAriaLabel={`Add ${preset.label}`}
                    onAdd={onInsertPreset ? () => onInsertPreset(preset.id) : undefined}
                  />
                ))}
                {filteredPresets.length === 0 && (
                  <p className="px-1 text-xs text-blue-700/80">No presets match this search.</p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <OutlineView />
        )}
      </div>
    </div>
  );
};
