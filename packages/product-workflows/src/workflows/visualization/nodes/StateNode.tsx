import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { StateNodeData } from '@server/lib/workflow/visualization/types/visualizationTypes';
import { Card } from '@server/components/ui/Card';

/**
 * State node component for workflow visualization
 * Represents a workflow state (context.setState)
 */
export function StateNode({ data, id }: NodeProps<StateNodeData>) {
  const automationId = `workflow-state-node-${id}`;
  
  // Determine node style based on status
  const getStatusClass = () => {
    switch (data.status) {
      case 'active':
        return 'border-blue-500 bg-blue-50';
      case 'success':
        return 'border-green-500 bg-green-50';
      case 'error':
        return 'border-red-500 bg-red-50';
      case 'warning':
        return 'border-yellow-500 bg-yellow-50';
      default:
        return 'border-gray-300 bg-white';
    }
  };

  return (
    <Card 
      className={`state-node p-3 rounded-md border-2 shadow-sm ${getStatusClass()}`} 
      id={automationId}
    >
      <Handle type="target" position={Position.Left} className="w-3 h-3 bg-gray-400" />
      
      <div className="node-header text-sm font-semibold text-gray-500 mb-1">
        State
      </div>
      
      <div className="node-content">
        <div className="state-name text-base font-bold mb-1">
          {data.label}
        </div>
        
        {data.sourceLocation && (
          <div className="source-location text-xs text-gray-400">
            Line: {data.sourceLocation.line}
          </div>
        )}
      </div>
      
      <Handle type="source" position={Position.Right} className="w-3 h-3 bg-gray-400" />
    </Card>
  );
}

export default StateNode;