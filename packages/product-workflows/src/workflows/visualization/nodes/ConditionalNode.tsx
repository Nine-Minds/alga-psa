import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { ConditionalNodeData } from '@server/lib/workflow/visualization/types/visualizationTypes';
import { Card } from '@server/components/ui/Card';

/**
 * Conditional node component for workflow visualization
 * Represents a conditional statement (if/else)
 */
export function ConditionalNode({ data, id }: NodeProps<ConditionalNodeData>) {
  const automationId = `workflow-conditional-node-${id}`;
  
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
        return 'border-orange-300 bg-orange-50';
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
      className={`conditional-node p-3 rounded-md border-2 shadow-sm ${getStatusClass()}`}
      id={automationId}
    >
      {/* Input handle - where edges connect to this node */}
      <Handle
        type="target"
        position={Position.Left}
        id="left"
        className="w-3 h-3 bg-gray-400"
      />
      
      <div className="node-header text-sm font-semibold text-gray-500 mb-1">
        Conditional
      </div>
      
      <div className="node-content">
        <div className="conditional-label text-base font-bold mb-1">
          {data.label}
        </div>
        
        <div className="conditional-condition text-xs text-gray-600 mb-1 font-mono">
          {formatCondition()}
        </div>
        
        {data.sourceLocation && (
          <div className="source-location text-xs text-gray-400">
            Line: {data.sourceLocation.line}
          </div>
        )}
      </div>
      
      {/* Output handles - where edges start from this node */}
      {/* True branch handle - positioned at the top right */}
      <Handle
        type="source"
        position={Position.Right}
        id="right-true"
        className="w-3 h-3 bg-green-500"
        style={{ top: '30%' }}
      />
      
      {/* False branch handle - positioned at the bottom right */}
      <Handle
        type="source"
        position={Position.Right}
        id="right-false"
        className="w-3 h-3 bg-red-500"
        style={{ top: '70%' }}
      />
      
      {/* Keep the original right handle for backward compatibility */}
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        className="w-3 h-3 bg-gray-400 opacity-0"
      />
    </Card>
  );
}

export default ConditionalNode;