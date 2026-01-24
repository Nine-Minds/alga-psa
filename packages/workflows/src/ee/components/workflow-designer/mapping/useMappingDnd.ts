/**
 * Drag-and-Drop State Management for Mapping Editor
 *
 * Provides a React hook for managing drag-and-drop interactions between
 * source data tree fields and target input fields.
 *
 * §19.2 - Drag-and-Drop Source to Target
 */

import { useState, useCallback, useRef } from 'react';
import { TypeCompatibility, getTypeCompatibility } from './typeCompatibility';

/**
 * Data transferred during drag operation
 */
export interface DragItem {
  /** Full path to the source field (e.g., "payload.ticketId") */
  path: string;
  /** Type of the source field */
  type?: string;
  /** Display name for the field */
  name: string;
}

/**
 * State of the drag-and-drop operation
 */
export interface MappingDndState {
  /** Whether a drag operation is in progress */
  isDragging: boolean;
  /** The item currently being dragged */
  draggedItem: DragItem | null;
  /** The target field currently being hovered */
  dropTarget: string | null;
  /** Compatibility of dragged item with current drop target */
  dropCompatibility: TypeCompatibility | null;
}

/**
 * Handlers for drag-and-drop events
 */
export interface MappingDndHandlers {
  /** Handle drag start from a source field */
  handleDragStart: (item: DragItem) => void;
  /** Handle drag over a target field */
  handleDragOver: (targetField: string, targetType?: string) => void;
  /** Handle drag leaving a target field */
  handleDragLeave: () => void;
  /** Handle drop on a target field */
  handleDrop: (targetField: string) => DragItem | null;
  /** Handle drag end (cleanup) */
  handleDragEnd: () => void;
}

/**
 * Options for the useMappingDnd hook
 */
export interface UseMappingDndOptions {
  /** Callback when a mapping is created via drop */
  onCreateMapping?: (targetField: string, sourcePath: string) => void;
  /** Whether to allow dropping on incompatible targets */
  allowIncompatibleDrops?: boolean;
  /** Callback when drag state changes */
  onDragStateChange?: (state: MappingDndState) => void;
}

/**
 * MIME type for drag data
 */
export const MAPPING_DND_MIME_TYPE = 'application/x-workflow-mapping';

/**
 * Hook for managing drag-and-drop state in the mapping editor
 *
 * @param options - Configuration options
 * @returns State and handlers for drag-and-drop operations
 */
export function useMappingDnd(options: UseMappingDndOptions = {}): [MappingDndState, MappingDndHandlers] {
  const { onCreateMapping, allowIncompatibleDrops = false, onDragStateChange } = options;

  const [state, setState] = useState<MappingDndState>({
    isDragging: false,
    draggedItem: null,
    dropTarget: null,
    dropCompatibility: null
  });

  // Use ref to avoid stale closure issues
  const stateRef = useRef(state);
  stateRef.current = state;

  // Update state and notify listener
  const updateState = useCallback((newState: Partial<MappingDndState>) => {
    setState(prev => {
      const next = { ...prev, ...newState };
      onDragStateChange?.(next);
      return next;
    });
  }, [onDragStateChange]);

  // Handle drag start from a source field
  const handleDragStart = useCallback((item: DragItem) => {
    updateState({
      isDragging: true,
      draggedItem: item,
      dropTarget: null,
      dropCompatibility: null
    });
  }, [updateState]);

  // Handle drag over a target field
  const handleDragOver = useCallback((targetField: string, targetType?: string) => {
    const currentItem = stateRef.current.draggedItem;
    if (!currentItem) return;

    const compatibility = getTypeCompatibility(currentItem.type, targetType);

    updateState({
      dropTarget: targetField,
      dropCompatibility: compatibility
    });
  }, [updateState]);

  // Handle drag leaving a target field
  const handleDragLeave = useCallback(() => {
    updateState({
      dropTarget: null,
      dropCompatibility: null
    });
  }, [updateState]);

  // Handle drop on a target field
  const handleDrop = useCallback((targetField: string): DragItem | null => {
    const { draggedItem, dropCompatibility } = stateRef.current;

    if (!draggedItem) return null;

    // Check if drop is allowed
    if (!allowIncompatibleDrops && dropCompatibility === TypeCompatibility.INCOMPATIBLE) {
      // Reset state without creating mapping
      updateState({
        isDragging: false,
        draggedItem: null,
        dropTarget: null,
        dropCompatibility: null
      });
      return null;
    }

    // Create the mapping
    if (onCreateMapping) {
      onCreateMapping(targetField, draggedItem.path);
    }

    // Reset state
    updateState({
      isDragging: false,
      draggedItem: null,
      dropTarget: null,
      dropCompatibility: null
    });

    return draggedItem;
  }, [allowIncompatibleDrops, onCreateMapping, updateState]);

  // Handle drag end (cleanup)
  const handleDragEnd = useCallback(() => {
    updateState({
      isDragging: false,
      draggedItem: null,
      dropTarget: null,
      dropCompatibility: null
    });
  }, [updateState]);

  const handlers: MappingDndHandlers = {
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleDragEnd
  };

  return [state, handlers];
}

/**
 * Create drag data for dataTransfer
 */
export function createDragData(item: DragItem): string {
  return JSON.stringify(item);
}

/**
 * Parse drag data from dataTransfer
 */
export function parseDragData(data: string): DragItem | null {
  try {
    return JSON.parse(data) as DragItem;
  } catch {
    return null;
  }
}

/**
 * Set drag data on a drag event
 */
export function setDragData(event: React.DragEvent, item: DragItem): void {
  event.dataTransfer.setData(MAPPING_DND_MIME_TYPE, createDragData(item));
  event.dataTransfer.setData('text/plain', item.path);
  event.dataTransfer.effectAllowed = 'copy';
}

/**
 * Get drag data from a drag event
 */
export function getDragData(event: React.DragEvent): DragItem | null {
  const data = event.dataTransfer.getData(MAPPING_DND_MIME_TYPE);
  if (!data) {
    // Fallback to plain text
    const path = event.dataTransfer.getData('text/plain');
    if (path) {
      return { path, name: path.split('.').pop() || path };
    }
    return null;
  }
  return parseDragData(data);
}

/**
 * Check if a drag event contains mapping data
 */
export function hasDragData(event: React.DragEvent): boolean {
  return event.dataTransfer.types.includes(MAPPING_DND_MIME_TYPE) ||
         event.dataTransfer.types.includes('text/plain');
}

/**
 * Props for making an element draggable
 */
export interface DraggableProps {
  draggable: true;
  onDragStart: (event: React.DragEvent) => void;
  onDragEnd: (event: React.DragEvent) => void;
}

/**
 * Create props for a draggable source field element
 */
export function createDraggableProps(
  item: DragItem,
  handlers: MappingDndHandlers
): DraggableProps {
  return {
    draggable: true,
    onDragStart: (event: React.DragEvent) => {
      setDragData(event, item);
      handlers.handleDragStart(item);
    },
    onDragEnd: () => {
      handlers.handleDragEnd();
    }
  };
}

/**
 * Props for a drop target element
 */
export interface DropTargetProps {
  onDragOver: (event: React.DragEvent) => void;
  onDragEnter: (event: React.DragEvent) => void;
  onDragLeave: (event: React.DragEvent) => void;
  onDrop: (event: React.DragEvent) => void;
}

/**
 * Create props for a drop target element
 */
export function createDropTargetProps(
  targetField: string,
  targetType: string | undefined,
  handlers: MappingDndHandlers,
  state: MappingDndState
): DropTargetProps {
  return {
    onDragOver: (event: React.DragEvent) => {
      if (!hasDragData(event)) return;

      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      handlers.handleDragOver(targetField, targetType);
    },
    onDragEnter: (event: React.DragEvent) => {
      if (!hasDragData(event)) return;

      event.preventDefault();
      handlers.handleDragOver(targetField, targetType);
    },
    onDragLeave: (event: React.DragEvent) => {
      // Only trigger leave if actually leaving the element
      const rect = event.currentTarget.getBoundingClientRect();
      const x = event.clientX;
      const y = event.clientY;

      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
        handlers.handleDragLeave();
      }
    },
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      handlers.handleDrop(targetField);
    }
  };
}

/**
 * Get CSS classes for drop target based on drag state
 */
export function getDropTargetClasses(
  targetField: string,
  state: MappingDndState
): string {
  if (!state.isDragging) return '';

  const isHovered = state.dropTarget === targetField;

  if (!isHovered) {
    // Show as potential drop target when dragging
    return 'ring-2 ring-dashed ring-gray-300';
  }

  // Show compatibility-based styling when hovering
  switch (state.dropCompatibility) {
    case TypeCompatibility.EXACT:
      return 'ring-2 ring-green-500 bg-green-50';
    case TypeCompatibility.COERCIBLE:
      return 'ring-2 ring-yellow-500 bg-yellow-50';
    case TypeCompatibility.INCOMPATIBLE:
      return 'ring-2 ring-red-500 bg-red-50';
    case TypeCompatibility.UNKNOWN:
    default:
      return 'ring-2 ring-gray-400 bg-gray-50';
  }
}

/**
 * Get icon for drop zone based on compatibility
 */
export function getDropZoneIcon(compatibility: TypeCompatibility | null): 'plus' | 'warning' | 'blocked' | 'question' {
  switch (compatibility) {
    case TypeCompatibility.EXACT:
      return 'plus';
    case TypeCompatibility.COERCIBLE:
      return 'warning';
    case TypeCompatibility.INCOMPATIBLE:
      return 'blocked';
    case TypeCompatibility.UNKNOWN:
    default:
      return 'question';
  }
}

export default useMappingDnd;
