import React from 'react';
import { EdgeProps, getBezierPath } from 'reactflow';

/**
 * Control flow edge component for workflow visualization
 * Represents a sequential control flow between nodes
 */
export function ControlFlowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  data,
  markerEnd,
  animated
}: EdgeProps) {
  const automationId = `workflow-edge-${id}`;
  
  // Calculate the path
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition
  });

  // Default style with improved visibility
  const defaultStyle = {
    stroke: '#666',
    strokeWidth: 2,
    ...style
  };

  return (
    <g id={automationId}>
      <path
        id={id}
        style={defaultStyle}
        className={`react-flow__edge-path ${animated ? 'animated' : ''}`}
        d={edgePath}
        markerEnd={markerEnd}
      />
      
      {/* Edge label */}
      {data?.label && (
        <text
          x={labelX}
          y={labelY}
          className="react-flow__edge-text"
          textAnchor="middle"
          dominantBaseline="middle"
          style={{
            fontSize: '10px',
            fill: '#888',
            pointerEvents: 'none',
            userSelect: 'none'
          }}
        >
          <tspan dy="-5">{data.label}</tspan>
        </text>
      )}
    </g>
  );
}

export default ControlFlowEdge;