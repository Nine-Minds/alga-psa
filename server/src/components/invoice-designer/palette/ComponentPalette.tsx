import React, { useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { COMPONENT_CATALOG, ComponentDefinition } from '../constants/componentCatalog';
import { LAYOUT_PRESETS } from '../constants/presets';
import { OutlineView } from './OutlineView';
import clsx from 'clsx';

interface PaletteProps {
  onSearch?: (query: string) => void;
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

const ComponentCard: React.FC<{ component: ComponentDefinition }> = ({ component }) => {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `component-${component.type}`,
    data: {
      source: 'component',
      componentType: component.type,
    },
  });

  return (
    <button
      ref={setNodeRef}
      className={`w-full text-left rounded-md border px-3 py-2 mb-2 transition shadow-sm hover:shadow-md focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none ${
        isDragging ? 'opacity-60 border-dashed' : 'bg-white'
      }`}
      data-component-type={component.type}
      {...listeners}
      {...attributes}
      type="button"
    >
      <p className="text-sm font-semibold text-gray-900">{component.label}</p>
      <p className="text-xs text-gray-500">{component.description}</p>
    </button>
  );
};

const PresetCard: React.FC<{ presetId: string; label: string; description: string }> = ({ presetId, label, description }) => {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `preset-${presetId}`,
    data: { source: 'preset', presetId },
  });

  return (
    <button
      ref={setNodeRef}
      className={`w-full text-left rounded-md border px-3 py-2 mb-2 transition shadow-sm hover:shadow-md focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none ${
        isDragging ? 'opacity-60 border-dashed' : 'bg-white'
      }`}
      type="button"
      {...listeners}
      {...attributes}
    >
      <p className="text-sm font-semibold text-gray-900">{label}</p>
      <p className="text-xs text-gray-500">{description}</p>
    </button>
  );
};

export const ComponentPalette: React.FC<PaletteProps> = () => {
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
             <p className="text-xs text-slate-500 mb-2">Drag components onto the canvas.</p>
            <section>
              <h4 className="text-xs font-bold text-slate-600 uppercase mb-2">Layout Presets</h4>
              {LAYOUT_PRESETS.map((preset) => (
                <PresetCard key={preset.id} presetId={preset.id} label={preset.label} description={preset.description} />
              ))}
            </section>
            <hr className="border-slate-200" />
            {Object.entries(paletteGroups).map(([category, components]) => (
              <section key={category}>
                <h4 className="text-xs font-bold text-slate-600 uppercase mb-2">{category}</h4>
                {components.map((component) => (
                  <ComponentCard key={component.type} component={component} />
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
