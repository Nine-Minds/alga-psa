import React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { COMPONENT_CATALOG, ComponentDefinition } from '../constants/componentCatalog';

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

const PaletteCard: React.FC<{ component: ComponentDefinition }> = ({ component }) => {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette-${component.type}`,
    data: {
      fromPalette: true,
      type: component.type,
      defaultSize: component.defaultSize,
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

export const ComponentPalette: React.FC<PaletteProps> = () => {
  return (
    <div className="flex flex-col h-full border-r border-slate-200 bg-slate-50">
      <div className="px-4 py-3 border-b border-slate-200">
        <h3 className="text-sm font-semibold text-slate-800 uppercase tracking-wide">Component Library</h3>
        <p className="text-xs text-slate-500">Drag components onto the canvas.</p>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {Object.entries(paletteGroups).map(([category, components]) => (
          <section key={category}>
            <h4 className="text-xs font-bold text-slate-600 uppercase mb-2">{category}</h4>
            {components.map((component) => (
              <PaletteCard key={component.type} component={component} />
            ))}
          </section>
        ))}
      </div>
    </div>
  );
};
