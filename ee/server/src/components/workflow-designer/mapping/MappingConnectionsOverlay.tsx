'use client';

/**
 * SVG Overlay for Visual Connection Lines
 *
 * Renders bezier curves between mapped source and target fields
 * with color-coding based on type compatibility.
 *
 * §19.3 - Visual Connection Lines (SVG Overlay)
 */

import React, { useState, useCallback, useMemo } from 'react';
import { Trash2 } from 'lucide-react';
import {
  TypeCompatibility,
  getCompatibilityColor,
  getCompatibilityLabel
} from './typeCompatibility';
import { calculateBezierPath, FieldRect } from './useMappingPositions';

/**
 * Connection data for rendering
 */
export interface ConnectionData {
  /** Unique ID for this connection */
  id: string;
  /** Source field identifier (path) */
  sourceId: string;
  /** Target field identifier (name) */
  targetId: string;
  /** Source field position */
  sourceRect: FieldRect | null;
  /** Target field position */
  targetRect: FieldRect | null;
  /** Type of the source field */
  sourceType?: string;
  /** Type of the target field */
  targetType?: string;
  /** Compatibility level */
  compatibility: TypeCompatibility;
}

/**
 * Props for MappingConnectionsOverlay
 */
export interface MappingConnectionsOverlayProps {
  /** Array of connections to render */
  connections: ConnectionData[];
  /** Container width */
  width: number;
  /** Container height */
  height: number;
  /** Currently selected connection ID */
  selectedConnectionId?: string | null;
  /** Callback when a connection is clicked */
  onConnectionClick?: (connectionId: string) => void;
  /** Callback when delete is requested for a connection */
  onConnectionDelete?: (connectionId: string) => void;
  /** Whether connections are interactive */
  interactive?: boolean;
  /** Whether the overlay is disabled */
  disabled?: boolean;
}

/**
 * Individual connection path component
 */
const ConnectionPath: React.FC<{
  connection: ConnectionData;
  isSelected: boolean;
  isHovered: boolean;
  onClick?: () => void;
  onMouseEnter?: (e: React.MouseEvent) => void;
  onMouseLeave?: () => void;
  onDelete?: () => void;
  interactive: boolean;
  disabled: boolean;
}> = ({
  connection,
  isSelected,
  isHovered,
  onClick,
  onMouseEnter,
  onMouseLeave,
  onDelete,
  interactive,
  disabled
}) => {
  const path = useMemo(() =>
    calculateBezierPath(connection.sourceRect, connection.targetRect),
    [connection.sourceRect, connection.targetRect]
  );

  if (!path) return null;

  const color = getCompatibilityColor(connection.compatibility);
  const strokeWidth = isSelected ? 3 : isHovered ? 2.5 : 2.25;
  const opacity = disabled ? 0.45 : isSelected || isHovered ? 1 : 0.8;

  // Calculate position for delete button (midpoint of the curve)
  const midX = connection.sourceRect && connection.targetRect
    ? (connection.sourceRect.right + connection.targetRect.left) / 2
    : 0;
  const midY = connection.sourceRect && connection.targetRect
    ? (connection.sourceRect.centerY + connection.targetRect.centerY) / 2
    : 0;

  const startX = connection.sourceRect?.right ?? 0;
  const startY = connection.sourceRect?.centerY ?? 0;
  const endX = connection.targetRect?.left ?? 0;
  const endY = connection.targetRect?.centerY ?? 0;

  return (
    <g className={interactive && !disabled ? 'cursor-pointer' : ''}>
      {/* Drop shadow */}
      <path
        d={path}
        fill="none"
        stroke="rgba(0,0,0,0.1)"
        strokeWidth={strokeWidth + 2}
        strokeLinecap="round"
        style={{ pointerEvents: 'none' }}
      />

      {/* Main path */}
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        opacity={opacity}
        className={isSelected || isHovered ? '' : 'transition-all duration-200'}
        style={{ pointerEvents: 'none' }}
      >
        {/* Animate on first render */}
        <animate
          attributeName="stroke-dashoffset"
          from="100%"
          to="0%"
          dur="0.3s"
          fill="freeze"
          calcMode="spline"
          keySplines="0.4 0 0.2 1"
        />
      </path>

      {/* Endpoint dots */}
      <circle
        cx={startX}
        cy={startY}
        r={4}
        fill="white"
        stroke={color}
        strokeWidth={2}
        style={{ pointerEvents: 'none' }}
      />
      <circle
        cx={endX}
        cy={endY}
        r={5}
        fill="white"
        stroke={color}
        strokeWidth={2}
        style={{ pointerEvents: 'none' }}
      />

      {/* Selection indicator */}
      {isSelected && (
        <circle
          cx={midX}
          cy={midY}
          r={8}
          fill="white"
          stroke={color}
          strokeWidth={2}
          style={{ pointerEvents: 'none' }}
        />
      )}

      {/* Delete button when selected */}
      {isSelected && onDelete && !disabled && (
        <g
          transform={`translate(${midX}, ${midY})`}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="cursor-pointer"
          style={{ pointerEvents: 'all' }}
        >
          <circle
            r={12}
            fill="white"
            stroke="#ef4444"
            strokeWidth={2}
            className="hover:fill-red-50"
          />
          <foreignObject x="-6" y="-6" width="12" height="12">
            <div className="flex items-center justify-center w-full h-full">
              <Trash2 className="w-3 h-3 text-red-500" />
            </div>
          </foreignObject>
        </g>
      )}
    </g>
  );
};

/**
 * Tooltip component for hovered connections
 */
const ConnectionTooltip: React.FC<{
  connection: ConnectionData;
  x: number;
  y: number;
}> = ({ connection, x, y }) => {
  const label = getCompatibilityLabel(connection.compatibility);

  return (
    <foreignObject x={x + 10} y={y - 30} width="200" height="60">
      <div
        className="bg-gray-900 text-white text-xs rounded px-2 py-1 shadow-lg"
        style={{ pointerEvents: 'none' }}
      >
        <div className="font-medium truncate">
          {connection.sourceId} → {connection.targetId}
        </div>
        <div className="text-gray-300">{label}</div>
      </div>
    </foreignObject>
  );
};

/**
 * MappingConnectionsOverlay component
 *
 * Renders an SVG overlay with bezier curves connecting mapped source and target fields.
 * Supports interaction for selection and deletion.
 */
export const MappingConnectionsOverlay: React.FC<MappingConnectionsOverlayProps> = ({
  connections,
  width,
  height,
  selectedConnectionId,
  onConnectionClick,
  onConnectionDelete,
  interactive = true,
  disabled = false
}) => {
  const [hoveredConnectionId, setHoveredConnectionId] = useState<string | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState<{ x: number; y: number } | null>(null);

  const handleConnectionClick = useCallback((connectionId: string) => {
    if (!interactive || disabled) return;
    onConnectionClick?.(connectionId);
  }, [interactive, disabled, onConnectionClick]);

  const handleMouseEnter = useCallback((connectionId: string, event: React.MouseEvent) => {
    if (!interactive || disabled) return;
    setHoveredConnectionId(connectionId);
    setTooltipPosition({ x: event.clientX, y: event.clientY });
  }, [interactive, disabled]);

  const handleMouseLeave = useCallback(() => {
    setHoveredConnectionId(null);
    setTooltipPosition(null);
  }, []);

  const handleDelete = useCallback((connectionId: string) => {
    if (!interactive || disabled) return;
    onConnectionDelete?.(connectionId);
  }, [interactive, disabled, onConnectionDelete]);

  // Filter connections with valid positions
  const validConnections = useMemo(() =>
    connections.filter(c => c.sourceRect && c.targetRect),
    [connections]
  );

  const hoveredConnection = hoveredConnectionId
    ? validConnections.find(c => c.id === hoveredConnectionId)
    : null;

  if (validConnections.length === 0) {
    return null;
  }

  return (
    <svg
      width={width}
      height={height}
      className="absolute inset-0 z-20"
      style={{ pointerEvents: 'none' }}
    >
      <defs>
        {/* Glow filter for selected connections */}
        <filter id="connection-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Render connections */}
      <g>
        {validConnections.map(connection => (
          <ConnectionPath
            key={connection.id}
            connection={connection}
            isSelected={selectedConnectionId === connection.id}
            isHovered={hoveredConnectionId === connection.id}
            onClick={() => handleConnectionClick(connection.id)}
            onMouseEnter={(e) => handleMouseEnter(connection.id, e)}
            onMouseLeave={handleMouseLeave}
            onDelete={() => handleDelete(connection.id)}
            interactive={interactive}
            disabled={disabled}
          />
        ))}
      </g>

      {/* Tooltip */}
      {hoveredConnection && tooltipPosition && (
        <ConnectionTooltip
          connection={hoveredConnection}
          x={tooltipPosition.x}
          y={tooltipPosition.y}
        />
      )}
    </svg>
  );
};

export default MappingConnectionsOverlay;
