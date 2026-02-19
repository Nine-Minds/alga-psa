import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { ParallelNodeData } from '../../../visualization/types/visualizationTypes';
import { Card } from '@alga-psa/ui/components/Card';

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
        return 'border-primary-500 bg-primary-500/10';
      case 'success':
        return 'border-success bg-success/10';
      case 'error':
        return 'border-destructive bg-destructive/10';
      case 'warning':
        return 'border-warning bg-warning/10';
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
