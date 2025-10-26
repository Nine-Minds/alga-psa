import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { ParallelNodeData } from '@server/lib/workflow/visualization/types/visualizationTypes';
import { Card } from '@server/components/ui/Card';

/**
 * Parallel node component for workflow visualization
 * Represents a parallel execution (Promise.all)
 */
export function ParallelNode({ data, id }: NodeProps<ParallelNodeData>) {
  const automationId = `workflow-parallel-node-${id}`;
  
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
        return 'border-violet-300 bg-violet-50';
    }
  };

  // No need for multiple branch handles anymore

  return (
    <Card 
      className={`parallel-node p-3 rounded-md border-2 shadow-sm ${getStatusClass()}`} 
      id={automationId}
    >
      <Handle type="target" position={Position.Left} className="w-3 h-3 bg-gray-400" />
      
      <div className="node-header text-sm font-semibold text-gray-500 mb-1 flex items-center">
        <span className="mr-1">⫲⫳</span>
        <span>Parallel Execution</span>
      </div>
      
      <div className="node-content">
        <div className="parallel-label text-base font-bold mb-1">
          {data.label}
        </div>
        
        <div className="branch-count text-xs text-gray-600 mb-1">
          {data.branchCount} parallel branch{data.branchCount !== 1 ? 'es' : ''}
        </div>
        
        {data.sourceLocation && (
          <div className="source-location text-xs text-gray-400">
            Line: {data.sourceLocation.line}
          </div>
        )}
      </div>
      
      {/* Single source handle */}
      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 bg-violet-500"
      />
    </Card>
  );
}

export default ParallelNode;