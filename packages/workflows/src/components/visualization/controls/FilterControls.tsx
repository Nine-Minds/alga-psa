import React, { useState } from 'react';
import { useReactFlow } from 'reactflow';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';

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
        <div className="[&>div]:mb-0">
          <Checkbox
            id="filter-state-nodes"
            label="States"
            checked={visibleTypes.state}
            onChange={() => toggleNodeType('state')}
          />
        </div>
        
        <div className="[&>div]:mb-0">
          <Checkbox
            id="filter-action-nodes"
            label="Actions"
            checked={visibleTypes.action}
            onChange={() => toggleNodeType('action')}
          />
        </div>
        
        <div className="[&>div]:mb-0">
          <Checkbox
            id="filter-event-nodes"
            label="Events"
            checked={visibleTypes.event}
            onChange={() => toggleNodeType('event')}
          />
        </div>
        
        <div className="[&>div]:mb-0">
          <Checkbox
            id="filter-conditional-nodes"
            label="Conditionals"
            checked={visibleTypes.conditional}
            onChange={() => toggleNodeType('conditional')}
          />
        </div>
        
        <div className="[&>div]:mb-0">
          <Checkbox
            id="filter-loop-nodes"
            label="Loops"
            checked={visibleTypes.loop}
            onChange={() => toggleNodeType('loop')}
          />
        </div>
        
        <div className="[&>div]:mb-0">
          <Checkbox
            id="filter-parallel-nodes"
            label="Parallel"
            checked={visibleTypes.parallel}
            onChange={() => toggleNodeType('parallel')}
          />
        </div>
      </div>
    </div>
  );
}

export default FilterControls;