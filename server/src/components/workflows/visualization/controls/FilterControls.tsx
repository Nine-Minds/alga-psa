import React, { useState } from 'react';
import { useReactFlow } from 'reactflow';

/**
 * Filter controls component for workflow visualization
 * Provides options to filter nodes by type
 */
export function FilterControls() {
  const { getNodes, setNodes } = useReactFlow();
  
  // Track which node types are visible
  const [visibleTypes, setVisibleTypes] = useState({
    state: true,
    action: true,
    event: true,
    conditional: true,
    loop: true,
    parallel: true
  });

  // Toggle visibility of a node type
  const toggleNodeType = (type: keyof typeof visibleTypes) => {
    const newVisibleTypes = {
      ...visibleTypes,
      [type]: !visibleTypes[type]
    };
    
    setVisibleTypes(newVisibleTypes);
    
    // Update node visibility
    const nodes = getNodes();
    setNodes(
      nodes.map(node => ({
        ...node,
        hidden: !newVisibleTypes[node.type as keyof typeof visibleTypes]
      }))
    );
  };

  return (
    <div className="filter-controls bg-white rounded-md shadow-sm border border-gray-200 p-2">
      <div className="text-sm font-semibold text-gray-700 mb-2">Filter Nodes</div>
      
      <div className="flex flex-col space-y-1">
        <label className="flex items-center space-x-2 text-sm">
          <input
            type="checkbox"
            checked={visibleTypes.state}
            onChange={() => toggleNodeType('state')}
            id="filter-state-nodes"
            className="rounded text-blue-500"
          />
          <span className="text-gray-700">States</span>
        </label>
        
        <label className="flex items-center space-x-2 text-sm">
          <input
            type="checkbox"
            checked={visibleTypes.action}
            onChange={() => toggleNodeType('action')}
            id="filter-action-nodes"
            className="rounded text-blue-500"
          />
          <span className="text-gray-700">Actions</span>
        </label>
        
        <label className="flex items-center space-x-2 text-sm">
          <input
            type="checkbox"
            checked={visibleTypes.event}
            onChange={() => toggleNodeType('event')}
            id="filter-event-nodes"
            className="rounded text-blue-500"
          />
          <span className="text-gray-700">Events</span>
        </label>
        
        <label className="flex items-center space-x-2 text-sm">
          <input
            type="checkbox"
            checked={visibleTypes.conditional}
            onChange={() => toggleNodeType('conditional')}
            id="filter-conditional-nodes"
            className="rounded text-blue-500"
          />
          <span className="text-gray-700">Conditionals</span>
        </label>
        
        <label className="flex items-center space-x-2 text-sm">
          <input
            type="checkbox"
            checked={visibleTypes.loop}
            onChange={() => toggleNodeType('loop')}
            id="filter-loop-nodes"
            className="rounded text-blue-500"
          />
          <span className="text-gray-700">Loops</span>
        </label>
        
        <label className="flex items-center space-x-2 text-sm">
          <input
            type="checkbox"
            checked={visibleTypes.parallel}
            onChange={() => toggleNodeType('parallel')}
            id="filter-parallel-nodes"
            className="rounded text-blue-500"
          />
          <span className="text-gray-700">Parallel</span>
        </label>
      </div>
    </div>
  );
}

export default FilterControls;