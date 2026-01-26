/**
 * Keyboard Navigation Hook for Mapping Editor
 *
 * Provides full keyboard accessibility for navigating and editing mappings.
 *
 * §17.3 - Keyboard Navigation in Mapping Editor
 *
 * Keyboard shortcuts:
 * - Arrow Up/Down: Navigate between target fields
 * - Tab: Move focus between source tree and target fields
 * - Enter: Open field picker or confirm selection
 * - Delete/Backspace: Remove current mapping
 * - Escape: Cancel current operation / close picker
 */

import { useCallback, useRef, useState, useEffect, RefObject } from 'react';

/**
 * State for keyboard navigation
 */
export interface MappingKeyboardState {
  /** Currently focused field index (in the target fields list) */
  focusedIndex: number;
  /** Whether the field picker is open */
  isPickerOpen: boolean;
  /** Whether keyboard navigation is active (container is focused) */
  isActive: boolean;
}

/**
 * Handlers for keyboard navigation
 */
export interface MappingKeyboardHandlers {
  /** Handle key down events */
  handleKeyDown: (event: React.KeyboardEvent) => void;
  /** Set the focused field index */
  setFocusedIndex: (index: number) => void;
  /** Toggle picker open state */
  togglePicker: () => void;
  /** Close the picker */
  closePicker: () => void;
  /** Activate keyboard navigation */
  activate: () => void;
  /** Deactivate keyboard navigation */
  deactivate: () => void;
  /** Get props for a navigable field */
  getFieldProps: (index: number) => NavigableFieldProps;
}

/**
 * Props to spread on navigable fields
 */
export interface NavigableFieldProps {
  tabIndex: number;
  'aria-selected': boolean;
  onFocus: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  className: string;
}

/**
 * Options for the keyboard navigation hook
 */
export interface UseMappingKeyboardOptions {
  /** Total number of navigable fields */
  fieldCount: number;
  /** Callback when a mapping should be removed */
  onRemoveMapping?: (fieldName: string) => void;
  /** Callback when Enter is pressed on a field */
  onActivateField?: (index: number) => void;
  /** Callback when navigation changes */
  onNavigate?: (index: number) => void;
  /** Field names for removal callback */
  fieldNames?: string[];
  /** Whether keyboard navigation is disabled */
  disabled?: boolean;
}

/**
 * Hook for keyboard navigation in the mapping editor
 */
export function useMappingKeyboard(
  options: UseMappingKeyboardOptions
): [MappingKeyboardState, MappingKeyboardHandlers] {
  const {
    fieldCount,
    onRemoveMapping,
    onActivateField,
    onNavigate,
    fieldNames = [],
    disabled = false
  } = options;

  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isActive, setIsActive] = useState(false);

  // Navigate to next/previous field
  const navigateUp = useCallback(() => {
    if (disabled || fieldCount === 0) return;
    setFocusedIndex(prev => {
      const next = prev <= 0 ? fieldCount - 1 : prev - 1;
      onNavigate?.(next);
      return next;
    });
  }, [disabled, fieldCount, onNavigate]);

  const navigateDown = useCallback(() => {
    if (disabled || fieldCount === 0) return;
    setFocusedIndex(prev => {
      const next = prev >= fieldCount - 1 ? 0 : prev + 1;
      onNavigate?.(next);
      return next;
    });
  }, [disabled, fieldCount, onNavigate]);

  // Handle removing current mapping
  const removeCurrentMapping = useCallback(() => {
    if (disabled || focusedIndex < 0 || focusedIndex >= fieldNames.length) return;
    const fieldName = fieldNames[focusedIndex];
    if (fieldName) {
      onRemoveMapping?.(fieldName);
    }
  }, [disabled, focusedIndex, fieldNames, onRemoveMapping]);

  // Handle activating current field (Enter)
  const activateCurrentField = useCallback(() => {
    if (disabled || focusedIndex < 0) return;
    onActivateField?.(focusedIndex);
    setIsPickerOpen(true);
  }, [disabled, focusedIndex, onActivateField]);

  // Main key handler
  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (disabled) return;

    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault();
        navigateUp();
        break;

      case 'ArrowDown':
        event.preventDefault();
        navigateDown();
        break;

      case 'Enter':
        if (!isPickerOpen) {
          event.preventDefault();
          activateCurrentField();
        }
        break;

      case 'Delete':
      case 'Backspace':
        // Only if not in an input field
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
          return; // Let the input handle it
        }
        event.preventDefault();
        removeCurrentMapping();
        break;

      case 'Escape':
        event.preventDefault();
        if (isPickerOpen) {
          setIsPickerOpen(false);
        } else {
          setIsActive(false);
          setFocusedIndex(-1);
        }
        break;

      case 'Tab':
        // Allow natural tab navigation
        // Could be enhanced to trap focus within the mapping editor
        break;
    }
  }, [
    disabled,
    navigateUp,
    navigateDown,
    activateCurrentField,
    removeCurrentMapping,
    isPickerOpen
  ]);

  // Set focused index directly
  const setFocusedIndexHandler = useCallback((index: number) => {
    if (disabled) return;
    setFocusedIndex(index);
    setIsActive(true);
  }, [disabled]);

  // Toggle picker
  const togglePicker = useCallback(() => {
    setIsPickerOpen(prev => !prev);
  }, []);

  // Close picker
  const closePicker = useCallback(() => {
    setIsPickerOpen(false);
  }, []);

  // Activate/deactivate
  const activate = useCallback(() => {
    if (disabled) return;
    setIsActive(true);
    if (focusedIndex < 0 && fieldCount > 0) {
      setFocusedIndex(0);
    }
  }, [disabled, focusedIndex, fieldCount]);

  const deactivate = useCallback(() => {
    setIsActive(false);
  }, []);

  // Get props for a navigable field
  const getFieldProps = useCallback((index: number): NavigableFieldProps => {
    const isFocused = isActive && focusedIndex === index;

    return {
      tabIndex: index === focusedIndex || (focusedIndex < 0 && index === 0) ? 0 : -1,
      'aria-selected': isFocused,
      onFocus: () => setFocusedIndexHandler(index),
      onKeyDown: handleKeyDown,
      className: isFocused
        ? 'ring-2 ring-primary-500 ring-offset-1'
        : 'focus:ring-2 focus:ring-primary-500 focus:ring-offset-1'
    };
  }, [isActive, focusedIndex, setFocusedIndexHandler, handleKeyDown]);

  // Reset focused index when field count changes
  useEffect(() => {
    if (focusedIndex >= fieldCount) {
      setFocusedIndex(Math.max(0, fieldCount - 1));
    }
  }, [fieldCount, focusedIndex]);

  const state: MappingKeyboardState = {
    focusedIndex,
    isPickerOpen,
    isActive
  };

  const handlers: MappingKeyboardHandlers = {
    handleKeyDown,
    setFocusedIndex: setFocusedIndexHandler,
    togglePicker,
    closePicker,
    activate,
    deactivate,
    getFieldProps
  };

  return [state, handlers];
}

export default useMappingKeyboard;
