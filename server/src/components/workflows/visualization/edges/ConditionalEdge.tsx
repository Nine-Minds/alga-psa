import React from 'react';
import { EdgeProps, getBezierPath } from 'reactflow';

/**
 * Edge props for conditional edges
 */
interface ConditionalEdgeProps extends EdgeProps {
  // Add sourceHandle and targetHandle to the props
  sourceHandle?: string;
  targetHandle?: string;
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
  sourceHandle, // Add sourceHandle
  targetHandle, // Add targetHandle
  animated
}: ConditionalEdgeProps) {

  // Use sourceHandle and targetHandle from props, or fall back to data if available
  const effectiveSourceHandle = sourceHandle || data?.sourceHandle;
  const effectiveTargetHandle = targetHandle || data?.targetHandle;
  
  console.log(`Using handles: sourceHandle=${effectiveSourceHandle}, targetHandle=${effectiveTargetHandle}`);
  const automationId = `workflow-conditional-edge-${id}`;
 
  
  // Determine if this is the true or false branch based on the label
  // Simplify the logic to be more straightforward and less error-prone
  const edgeLabel = data?.label || '';
  
  // Simplified branch type determination:
  // We prioritize the edge label, which should be explicitly set to 'true' or 'false'
  // in the flowGraphBuilder.ts when creating conditional edges
  const isTrueBranch = edgeLabel.toLowerCase() === 'true';
   
  // Calculate the path with a bezier curve
  // We don't need to adjust the target coordinates anymore since we're using
  // explicit handle connections in the flowGraphBuilder
  // Note: The handles are automatically used by React Flow, we don't need to pass them to getBezierPath
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition
  });

  // Default style with color based on branch type and improved visibility
  const defaultStyle = {
    stroke: isTrueBranch ? '#2ecc71' : '#e74c3c',
    strokeWidth: 2,
    strokeDasharray: '5,5', // Add dashed line for conditional edges
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
        <tspan dy="-5">{isTrueBranch ? 'true' : 'false'}</tspan>
      </text>
    </g>
  );
}

export default ConditionalEdge;