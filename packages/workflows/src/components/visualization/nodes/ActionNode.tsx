import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { ActionNodeData } from 'server/src/lib/workflow/visualization/types/visualizationTypes';
import { Card } from '@alga-psa/ui/components/Card';

/**
 * Action node component for workflow visualization
 * Represents a workflow action call (actions.someAction)
 */
export function ActionNode({ data, id }: NodeProps<ActionNodeData>) {
  const automationId = `workflow-action-node-${id}`;
  
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

  // Format arguments for display
  const formatArguments = () => {
    if (!data.arguments || data.arguments.length === 0) {
      return null;
    }
    
    try {
      return JSON.stringify(data.arguments)
        .slice(1, -1) // Remove the outer brackets
        .substring(0, 50) + (JSON.stringify(data.arguments).length > 52 ? '...' : '');
    } catch (e) {
      return 'Arguments: [...]';
    }
  };

  return (
    <Card 
      className={`action-node p-3 rounded-md border-2 shadow-sm ${getStatusClass()}`} 
      id={automationId}
    >
      <Handle type="target" position={Position.Left} id="left" className="w-3 h-3 bg-gray-400" />
      
      <div className="node-header text-sm font-semibold text-gray-500 mb-1">
        Action
      </div>
      
      <div className="node-content">
        <div className="action-name text-base font-bold mb-1">
          {data.label}
        </div>
        
        {data.arguments && data.arguments.length > 0 && (
          <div className="action-arguments text-xs text-gray-600 mb-1">
            {formatArguments()}
          </div>
        )}
        
        {data.result && (
          <div className="action-result text-xs bg-gray-100 p-1 rounded">
            {typeof data.result === 'object' 
              ? JSON.stringify(data.result).substring(0, 50) + (JSON.stringify(data.result).length > 50 ? '...' : '')
              : String(data.result).substring(0, 50) + (String(data.result).length > 50 ? '...' : '')
            }
          </div>
        )}
        
        {data.sourceLocation && (
          <div className="source-location text-xs text-gray-400 mt-1">
            Line: {data.sourceLocation.line}
          </div>
        )}
      </div>
      
      <Handle type="source" position={Position.Right} id="right" className="w-3 h-3 bg-gray-400" />
    </Card>
  );
}

export default ActionNode;