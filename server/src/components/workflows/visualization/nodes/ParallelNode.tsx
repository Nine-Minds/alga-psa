import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { ParallelNodeData } from 'server/src/lib/workflow/visualization/types/visualizationTypes';
import { Card } from 'server/src/components/ui/Card';

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

  // Create handles for each branch
  const renderBranchHandles = () => {
    const handles = [];
    const branchCount = data.branchCount || 1;
    
    for (let i = 0; i < branchCount; i++) {
      handles.push(
        <Handle 
          key={`branch-${i}`}
          type="source" 
          position={Position.Bottom} 
          id={`branch-${i}`} 
          className="w-3 h-3 bg-violet-500"
          style={{ left: `${(i + 1) * (100 / (branchCount + 1))}%` }}
        />
      );
    }
    
    return handles;
  };

  return (
    <Card 
      className={`parallel-node p-3 rounded-md border-2 shadow-sm ${getStatusClass()}`} 
      id={automationId}
    >
      <Handle type="target" position={Position.Top} className="w-3 h-3 bg-gray-400" />
      
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
      
      {/* Render branch handles */}
      {renderBranchHandles()}
      
      {/* Join handle */}
      <Handle 
        type="source" 
        position={Position.Right} 
        id="join" 
        className="w-3 h-3 bg-gray-500"
      />
    </Card>
  );
}

export default ParallelNode;