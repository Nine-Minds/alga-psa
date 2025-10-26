import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { EventNodeData } from '@server/lib/workflow/visualization/types/visualizationTypes';
import { Card } from '@server/components/ui/Card';

/**
 * Event node component for workflow visualization
 * Represents a workflow event operation (events.waitFor or events.emit)
 */
export function EventNode({ data, id }: NodeProps<EventNodeData>) {
  const automationId = `workflow-event-node-${id}`;
  const isWaiting = data.eventType === 'waiting';
  
  // Determine node style based on status and event type
  const getStatusClass = () => {
    const baseClass = isWaiting ? 'border-purple-300 bg-purple-50' : 'border-indigo-300 bg-indigo-50';
    
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
        return baseClass;
    }
  };

  return (
    <Card 
      className={`event-node p-3 rounded-md border-2 shadow-sm ${getStatusClass()}`} 
      id={automationId}
    >
      <Handle type="target" position={Position.Left} className="w-3 h-3 bg-gray-400" />
      
      <div className="node-header text-sm font-semibold text-gray-500 mb-1">
        {isWaiting ? 'Wait for Event' : 'Emit Event'}
      </div>
      
      <div className="node-content">
        <div className="event-name text-base font-bold mb-1">
          {data.label}
        </div>
        
        {data.eventNames && data.eventNames.length > 0 && (
          <div className="event-names text-xs text-gray-600 mb-1">
            {isWaiting 
              ? `Waiting for: ${data.eventNames.join(' or ')}`
              : `Emitting: ${data.eventNames[0]}`
            }
          </div>
        )}
        
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

export default EventNode;