/**
 * Position Tracking for Mapping Editor Connections
 *
 * Provides a React hook for tracking DOM positions of source and target fields
 * to enable drawing visual connection lines between them.
 *
 * §19.3.1 - Position Tracking
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A positioned rectangle for a field element
 */
export interface FieldRect {
  /** X position of the left edge relative to container */
  left: number;
  /** X position of the right edge relative to container */
  right: number;
  /** Y position of the top edge relative to container */
  top: number;
  /** Y position of the bottom edge relative to container */
  bottom: number;
  /** Width of the element */
  width: number;
  /** Height of the element */
  height: number;
  /** Center X position */
  centerX: number;
  /** Center Y position */
  centerY: number;
}

/**
 * A connection between source and target fields
 */
export interface MappingConnection {
  /** ID of the source field */
  sourceId: string;
  /** ID of the target field */
  targetId: string;
  /** Source field position */
  sourceRect: FieldRect | null;
  /** Target field position */
  targetRect: FieldRect | null;
}

/**
 * State returned by the position tracking hook
 */
export interface MappingPositionsState {
  /** Map of source field ID to position */
  sourcePositions: Map<string, FieldRect>;
  /** Map of target field ID to position */
  targetPositions: Map<string, FieldRect>;
  /** Container dimensions */
  containerRect: FieldRect | null;
  /** Whether positions are ready */
  isReady: boolean;
}

/**
 * Handlers returned by the position tracking hook
 */
export interface MappingPositionsHandlers {
  /** Register a source field element */
  registerSourceRef: (id: string, element: HTMLElement | null) => void;
  /** Register a target field element */
  registerTargetRef: (id: string, element: HTMLElement | null) => void;
  /** Set the container element */
  setContainerRef: (element: HTMLElement | null) => void;
  /** Force recalculation of all positions */
  recalculatePositions: () => void;
  /** Get position for a source field */
  getSourcePosition: (id: string) => FieldRect | null;
  /** Get position for a target field */
  getTargetPosition: (id: string) => FieldRect | null;
  /** Get connections with positions for a set of mappings */
  getConnections: (mappings: Array<{ source: string; target: string }>) => MappingConnection[];
}

/**
 * Options for the position tracking hook
 */
export interface UseMappingPositionsOptions {
  /** Debounce delay for position updates (ms) */
  debounceMs?: number;
  /** Whether to update on scroll */
  updateOnScroll?: boolean;
  /** Whether to update on resize */
  updateOnResize?: boolean;
}

/**
 * Calculate FieldRect from a DOM element relative to a container
 */
function calculateRect(element: HTMLElement, container: HTMLElement): FieldRect {
  const elemRect = element.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();

  const left = elemRect.left - containerRect.left + container.scrollLeft;
  const top = elemRect.top - containerRect.top + container.scrollTop;
  const width = elemRect.width;
  const height = elemRect.height;

  return {
    left,
    right: left + width,
    top,
    bottom: top + height,
    width,
    height,
    centerX: left + width / 2,
    centerY: top + height / 2
  };
}

/**
 * Hook for tracking positions of source and target field elements
 *
 * @param options - Configuration options
 * @returns State and handlers for position tracking
 */
export function useMappingPositions(
  options: UseMappingPositionsOptions = {}
): [MappingPositionsState, MappingPositionsHandlers] {
  const { debounceMs = 16, updateOnScroll = true, updateOnResize = true } = options;

  // Refs for DOM elements
  const containerRef = useRef<HTMLElement | null>(null);
  const sourceRefs = useRef<Map<string, HTMLElement>>(new Map());
  const targetRefs = useRef<Map<string, HTMLElement>>(new Map());

  // State
  const [state, setState] = useState<MappingPositionsState>({
    sourcePositions: new Map(),
    targetPositions: new Map(),
    containerRect: null,
    isReady: false
  });

  // Debounce timer
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Recalculate all positions
  const recalculatePositions = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      setState(prev => ({ ...prev, isReady: false }));
      return;
    }

    const containerBounds = container.getBoundingClientRect();
    const containerRect: FieldRect = {
      left: 0,
      right: containerBounds.width,
      top: 0,
      bottom: containerBounds.height,
      width: containerBounds.width,
      height: containerBounds.height,
      centerX: containerBounds.width / 2,
      centerY: containerBounds.height / 2
    };

    const sourcePositions = new Map<string, FieldRect>();
    const targetPositions = new Map<string, FieldRect>();

    sourceRefs.current.forEach((element, id) => {
      if (element && container.contains(element)) {
        sourcePositions.set(id, calculateRect(element, container));
      }
    });

    targetRefs.current.forEach((element, id) => {
      if (element && container.contains(element)) {
        targetPositions.set(id, calculateRect(element, container));
      }
    });

    setState({
      sourcePositions,
      targetPositions,
      containerRect,
      isReady: true
    });
  }, []);

  // Debounced recalculate
  const debouncedRecalculate = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(recalculatePositions, debounceMs);
  }, [debounceMs, recalculatePositions]);

  // Register source ref
  const registerSourceRef = useCallback((id: string, element: HTMLElement | null) => {
    if (element) {
      sourceRefs.current.set(id, element);
    } else {
      sourceRefs.current.delete(id);
    }
    debouncedRecalculate();
  }, [debouncedRecalculate]);

  // Register target ref
  const registerTargetRef = useCallback((id: string, element: HTMLElement | null) => {
    if (element) {
      targetRefs.current.set(id, element);
    } else {
      targetRefs.current.delete(id);
    }
    debouncedRecalculate();
  }, [debouncedRecalculate]);

  // Set container ref
  const setContainerRef = useCallback((element: HTMLElement | null) => {
    containerRef.current = element;
    debouncedRecalculate();
  }, [debouncedRecalculate]);

  // Get source position
  const getSourcePosition = useCallback((id: string): FieldRect | null => {
    return state.sourcePositions.get(id) || null;
  }, [state.sourcePositions]);

  // Get target position
  const getTargetPosition = useCallback((id: string): FieldRect | null => {
    return state.targetPositions.get(id) || null;
  }, [state.targetPositions]);

  // Get connections with positions
  const getConnections = useCallback((
    mappings: Array<{ source: string; target: string }>
  ): MappingConnection[] => {
    return mappings.map(mapping => ({
      sourceId: mapping.source,
      targetId: mapping.target,
      sourceRect: state.sourcePositions.get(mapping.source) || null,
      targetRect: state.targetPositions.get(mapping.target) || null
    }));
  }, [state.sourcePositions, state.targetPositions]);

  // Set up scroll and resize listeners
  useEffect(() => {
    const container = containerRef.current;

    const handleScroll = () => {
      if (updateOnScroll) {
        debouncedRecalculate();
      }
    };

    const handleResize = () => {
      if (updateOnResize) {
        debouncedRecalculate();
      }
    };

    // Add event listeners
    if (container && updateOnScroll) {
      container.addEventListener('scroll', handleScroll, { passive: true });
    }

    if (updateOnResize) {
      window.addEventListener('resize', handleResize, { passive: true });
    }

    // Set up ResizeObserver for container size changes
    let resizeObserver: ResizeObserver | null = null;
    if (container && updateOnResize) {
      resizeObserver = new ResizeObserver(() => {
        debouncedRecalculate();
      });
      resizeObserver.observe(container);
    }

    // Initial calculation
    recalculatePositions();

    // Cleanup
    return () => {
      if (container && updateOnScroll) {
        container.removeEventListener('scroll', handleScroll);
      }
      if (updateOnResize) {
        window.removeEventListener('resize', handleResize);
      }
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [updateOnScroll, updateOnResize, debouncedRecalculate, recalculatePositions]);

  const handlers: MappingPositionsHandlers = {
    registerSourceRef,
    registerTargetRef,
    setContainerRef,
    recalculatePositions,
    getSourcePosition,
    getTargetPosition,
    getConnections
  };

  return [state, handlers];
}

/**
 * Calculate a bezier path between two points
 * Creates a smooth S-curve connecting source (right edge) to target (left edge)
 */
export function calculateBezierPath(
  sourceRect: FieldRect | null,
  targetRect: FieldRect | null
): string | null {
  if (!sourceRect || !targetRect) return null;

  // Start from right edge center of source
  const startX = sourceRect.right;
  const startY = sourceRect.centerY;

  // End at left edge center of target
  const endX = targetRect.left;
  const endY = targetRect.centerY;

  // Calculate horizontal distance for control point offset
  const dx = Math.abs(endX - startX);

  // Control point offset (scales with distance for natural curves)
  const controlOffset = Math.max(dx * 0.4, 40);

  // Control points for cubic bezier
  const cp1x = startX + controlOffset;
  const cp1y = startY;
  const cp2x = endX - controlOffset;
  const cp2y = endY;

  return `M ${startX} ${startY} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${endX} ${endY}`;
}

/**
 * Calculate path for connection with slight vertical offset to avoid overlap
 */
export function calculateBezierPathWithOffset(
  sourceRect: FieldRect | null,
  targetRect: FieldRect | null,
  offsetIndex: number = 0,
  totalConnections: number = 1
): string | null {
  if (!sourceRect || !targetRect) return null;

  // Calculate vertical offset for this connection
  let yOffset = 0;
  if (totalConnections > 1) {
    const offsetRange = 10; // Max offset in pixels
    const step = offsetRange / (totalConnections - 1);
    yOffset = -offsetRange / 2 + step * offsetIndex;
  }

  // Start from right edge center of source (with offset)
  const startX = sourceRect.right;
  const startY = sourceRect.centerY + yOffset;

  // End at left edge center of target (with offset)
  const endX = targetRect.left;
  const endY = targetRect.centerY + yOffset;

  // Calculate horizontal distance for control point offset
  const dx = Math.abs(endX - startX);
  const dy = Math.abs(endY - startY);

  // Control point offset (scales with distance for natural curves)
  const controlOffset = Math.max(dx * 0.4, 40);

  // Add slight vertical curve when source and target are at similar heights
  const verticalBias = dy < 20 ? (startY < endY ? 15 : -15) : 0;

  // Control points for cubic bezier
  const cp1x = startX + controlOffset;
  const cp1y = startY + verticalBias;
  const cp2x = endX - controlOffset;
  const cp2y = endY - verticalBias;

  return `M ${startX} ${startY} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${endX} ${endY}`;
}

export default useMappingPositions;
