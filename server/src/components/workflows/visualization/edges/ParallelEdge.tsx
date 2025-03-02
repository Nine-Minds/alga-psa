import React from 'react';
import { EdgeProps, getBezierPath } from 'reactflow';

/**
 * Extended edge props with sourceHandle
 */
interface ParallelEdgeProps extends EdgeProps {
  sourceHandle?: string;
}

/**
 * Parallel edge component for workflow visualization
 * Represents a parallel branch in the control flow
 */
export function ParallelEdge({
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
}: ParallelEdgeProps) {
  const automationId = `workflow-parallel-edge-${id}`;
  
  // Determine if this is a branch or join edge
  const isJoinEdge = sourceHandle === 'join';
  
  // Calculate the path
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition
  });

  // Default style
  const defaultStyle = {
    stroke: '#9b59b6',
    strokeWidth: 1.5,
    strokeDasharray: isJoinEdge ? '5 5' : undefined,
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
            fill: '#9b59b6',
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

export default ParallelEdge;