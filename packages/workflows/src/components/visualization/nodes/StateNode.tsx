import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { StateNodeData } from '../../../visualization/types/visualizationTypes';
import { Card } from '@alga-psa/ui/components/Card';

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
        return 'border-primary-500 bg-primary-500/10';
      case 'success':
        return 'border-success bg-success/10';
      case 'error':
        return 'border-destructive bg-destructive/10';
      case 'warning':
        return 'border-warning bg-warning/10';
      default:
        return 'border-border bg-background';
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
