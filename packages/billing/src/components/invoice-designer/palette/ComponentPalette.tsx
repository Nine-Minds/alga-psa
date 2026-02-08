import React, { useState } from 'react';
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

const ComponentCard: React.FC<{
  component: ComponentDefinition;
  onInsert?: (componentType: ComponentDefinition['type']) => void;
}> = ({ component, onInsert }) => {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `component-${component.type}`,
    data: {
      source: 'component',
      componentType: component.type,
    },
  });

  return (
    <div
      ref={setNodeRef}
      className={`w-full text-left rounded-md border px-3 py-2 mb-2 transition shadow-sm hover:shadow-md ${
        isDragging ? 'opacity-60 border-dashed' : 'bg-white'
      }`}
      data-component-type={component.type}
      {...listeners}
      {...attributes}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">{component.label}</p>
          <p className="text-xs text-gray-500">{component.description}</p>
        </div>
        {onInsert && (
          <button
            type="button"
            className="h-6 w-6 shrink-0 rounded border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
            data-automation-id={`designer-palette-add-${component.type}`}
            aria-label={`Add ${component.label}`}
            title={`Add ${component.label}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onInsert(component.type);
            }}
          >
            +
          </button>
        )}
      </div>
    </div>
  );
};

const PresetCard: React.FC<{
  presetId: string;
  label: string;
  description: string;
  onInsert?: (presetId: string) => void;
}> = ({ presetId, label, description, onInsert }) => {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `preset-${presetId}`,
    data: { source: 'preset', presetId },
  });

  return (
    <div
      ref={setNodeRef}
      className={`w-full text-left rounded-md border px-3 py-2 mb-2 transition shadow-sm hover:shadow-md ${
        isDragging ? 'opacity-60 border-dashed' : 'bg-white'
      }`}
      {...listeners}
      {...attributes}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">{label}</p>
          <p className="text-xs text-gray-500">{description}</p>
        </div>
        {onInsert && (
          <button
            type="button"
            className="h-6 w-6 shrink-0 rounded border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
            data-automation-id={`designer-palette-add-preset-${presetId}`}
            aria-label={`Add ${label}`}
            title={`Add ${label}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onInsert(presetId);
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
  const [activeTab, setActiveTab] = useState<'components' | 'outline'>('components');

  return (
    <div className="flex flex-col h-full border-r border-slate-200 bg-slate-50">
      <div className="px-4 pt-3 pb-0 border-b border-slate-200 bg-white">
        <div className="flex space-x-4">
          <button
            className={clsx(
              "pb-2 text-sm font-medium border-b-2 transition-colors",
              activeTab === 'components' ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700"
            )}
            onClick={() => setActiveTab('components')}
          >
            COMPONENTS
          </button>
          <button
            className={clsx(
              "pb-2 text-sm font-medium border-b-2 transition-colors",
              activeTab === 'outline' ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700"
            )}
            onClick={() => setActiveTab('outline')}
          >
            OUTLINE
          </button>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'components' ? (
          <div className="px-4 py-3 space-y-4">
             <p className="text-xs text-slate-500 mb-2">Drag components onto the canvas or click + to insert.</p>
            <section>
              <h4 className="text-xs font-bold text-slate-600 uppercase mb-2">Layout Presets</h4>
              {LAYOUT_PRESETS.map((preset) => (
                <PresetCard
                  key={preset.id}
                  presetId={preset.id}
                  label={preset.label}
                  description={preset.description}
                  onInsert={onInsertPreset}
                />
              ))}
            </section>
            <hr className="border-slate-200" />
            {Object.entries(paletteGroups).map(([category, components]) => (
              <section key={category}>
                <h4 className="text-xs font-bold text-slate-600 uppercase mb-2">{category}</h4>
                {components.map((component) => (
                  <ComponentCard key={component.type} component={component} onInsert={onInsertComponent} />
                ))}
              </section>
            ))}
          </div>
        ) : (
          <OutlineView />
        )}
      </div>
    </div>
  );
};
