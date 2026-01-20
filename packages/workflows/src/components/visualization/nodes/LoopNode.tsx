import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { LoopNodeData } from '../../../visualization/types/visualizationTypes';
import { Card } from '@alga-psa/ui/components/Card';

/**
 * Loop node component for workflow visualization
 * Represents a loop statement (for, while, do-while)
 */
export function LoopNode({ data, id }: NodeProps<LoopNodeData>) {
  const automationId = `workflow-loop-node-${id}`;
  
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
        return 'border-teal-300 bg-teal-50';
    }
  };

  // Get loop type icon
  const getLoopTypeIcon = () => {
    switch (data.loopType) {
      case 'for':
        return '↻';
      case 'while':
        return '⟳';
      case 'doWhile':
        return '⥁';
      default:
        return '↻';
    }
  };

  // Format condition for display
  const formatCondition = () => {
    if (!data.condition) return '';
    
    // Truncate long conditions
    return data.condition.length > 50
      ? data.condition.substring(0, 50) + '...'
      : data.condition;
  };

  return (
    <Card 
      className={`loop-node p-3 rounded-md border-2 shadow-sm ${getStatusClass()}`} 
      id={automationId}
    >
      <Handle type="target" position={Position.Left} className="w-3 h-3 bg-gray-400" />
      
      <div className="node-header text-sm font-semibold text-gray-500 mb-1 flex items-center">
        <span className="mr-1">{getLoopTypeIcon()}</span>
        <span>Loop ({data.loopType})</span>
      </div>
      
      <div className="node-content">
        <div className="loop-label text-base font-bold mb-1">
          {data.label}
        </div>
        
        <div className="loop-condition text-xs text-gray-600 mb-1 font-mono">
          {formatCondition()}
        </div>
        
        {data.sourceLocation && (
          <div className="source-location text-xs text-gray-400">
            Line: {data.sourceLocation.line}
          </div>
        )}
      </div>
      
      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 bg-teal-500"
      />
    </Card>
  );
}

export default LoopNode;
