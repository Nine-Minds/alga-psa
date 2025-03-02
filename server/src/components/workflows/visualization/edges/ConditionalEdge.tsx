import React from 'react';
import { EdgeProps, getBezierPath } from 'reactflow';

/**
 * Extended edge props with sourceHandle
 */
interface ConditionalEdgeProps extends EdgeProps {
  sourceHandle?: string;
}

/**
 * Conditional edge component for workflow visualization
 * Represents a conditional branch in the control flow
 */
export function ConditionalEdge({
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
  sourceHandle,
  animated
}: ConditionalEdgeProps) {
  const automationId = `workflow-conditional-edge-${id}`;
  
  // Determine if this is the true or false branch
  const isTrueBranch = sourceHandle === 'true';
  
  // Calculate the path
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition
  });

  // Default style with color based on branch type
  const defaultStyle = {
    stroke: isTrueBranch ? '#2ecc71' : '#e74c3c',
    strokeWidth: 1.5,
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
      <text
        x={labelX}
        y={labelY}
        className="react-flow__edge-text"
        textAnchor="middle"
        dominantBaseline="middle"
        style={{
          fontSize: '10px',
          fill: isTrueBranch ? '#2ecc71' : '#e74c3c',
          fontWeight: 'bold',
          pointerEvents: 'none',
          userSelect: 'none'
        }}
      >
        <tspan dy="-5">{isTrueBranch ? 'True' : 'False'}</tspan>
        {data?.label && (
          <tspan x={labelX} dy="12">{data.label}</tspan>
        )}
      </text>
    </g>
  );
}

export default ConditionalEdge;