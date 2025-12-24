/**
 * Expression Autocomplete Hook
 *
 * Manages autocomplete state and integrates with expression textarea.
 *
 * §16.2 - Context-aware autocomplete in expression fields
 */

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { calculateDropdownPosition } from './ExpressionAutocomplete';
import { extractCurrentPath, filterSuggestions, type AutocompleteSuggestion } from './expressionAutocompleteUtils';

/**
 * Options for the autocomplete hook
 */
export interface UseExpressionAutocompleteOptions {
  /** All available suggestions from data context */
  suggestions: AutocompleteSuggestion[];
  /** Current expression value */
  expression: string;
  /** Callback when expression changes */
  onChange: (expression: string) => void;
  /** Whether autocomplete is disabled */
  disabled?: boolean;
  /** Minimum characters to trigger autocomplete */
  minTriggerLength?: number;
}

/**
 * Autocomplete state
 */
export interface ExpressionAutocompleteState {
  /** Whether the dropdown is visible */
  isOpen: boolean;
  /** Current cursor position */
  cursorPosition: number;
  /** Filtered suggestions based on current input */
  filteredSuggestions: AutocompleteSuggestion[];
  /** Current path being typed */
  currentPath: string | null;
  /** Dropdown position */
  position: { top: number; left: number };
  /** Currently highlighted suggestion index */
  selectedIndex: number;
}

/**
 * Autocomplete handlers
 */
export interface ExpressionAutocompleteHandlers {
  /** Handle input change */
  handleChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  /** Handle key down for navigation */
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  /** Handle selection from dropdown */
  handleSelect: (suggestion: AutocompleteSuggestion) => void;
  /** Update highlighted suggestion index */
  setSelectedIndex: (index: number) => void;
  /** Close the dropdown */
  close: () => void;
  /** Handle focus */
  handleFocus: () => void;
  /** Handle blur */
  handleBlur: () => void;
  /** Get ref to attach to textarea */
  textareaRef: React.RefObject<HTMLTextAreaElement>;
}

/**
 * Hook for managing expression autocomplete
 */
export function useExpressionAutocomplete(
  options: UseExpressionAutocompleteOptions
): [ExpressionAutocompleteState, ExpressionAutocompleteHandlers] {
  const {
    suggestions,
    expression,
    onChange,
    disabled = false,
    minTriggerLength = 1
  } = options;

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const suppressNextOpenRef = useRef(false);
  const [isOpen, setIsOpen] = useState(false);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Extract current path being typed
  const currentPath = useMemo(() => {
    if (disabled || !expression) return null;
    return extractCurrentPath(expression, cursorPosition);
  }, [expression, cursorPosition, disabled]);

  // Filter suggestions based on current path
  const filteredSuggestions = useMemo(() => {
    if (!currentPath || currentPath.length < minTriggerLength) {
      return [];
    }
    return filterSuggestions(suggestions, currentPath);
  }, [suggestions, currentPath, minTriggerLength]);

  // Update visibility based on filtered suggestions
  useEffect(() => {
    if (suppressNextOpenRef.current) {
      suppressNextOpenRef.current = false;
      setIsOpen(false);
      return;
    }

    const shouldOpen = filteredSuggestions.length > 0 && !disabled;
    setIsOpen(shouldOpen);
    if (shouldOpen) {
      setSelectedIndex(0);
    }
  }, [filteredSuggestions, disabled]);

  // Update dropdown position when cursor moves
  useEffect(() => {
    if (isOpen && textareaRef.current) {
      const newPosition = calculateDropdownPosition(textareaRef.current, cursorPosition);
      setPosition(newPosition);
    }
  }, [isOpen, cursorPosition]);

  // Handle input change
  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const newCursorPosition = e.target.selectionStart ?? newValue.length;

    setCursorPosition(newCursorPosition);
    onChange(newValue);
  }, [onChange]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!isOpen || filteredSuggestions.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => Math.min(prev + 1, filteredSuggestions.length - 1));
        break;

      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
        break;

      case 'Enter':
        if (isOpen && filteredSuggestions[selectedIndex]) {
          e.preventDefault();
          handleSelectInternal(filteredSuggestions[selectedIndex]);
        }
        break;

      case 'Tab':
        if (isOpen && filteredSuggestions[selectedIndex]) {
          e.preventDefault();
          handleSelectInternal(filteredSuggestions[selectedIndex]);
        }
        break;

      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        break;
    }
  }, [isOpen, filteredSuggestions, selectedIndex]);

  // Handle selection
  const handleSelectInternal = useCallback((suggestion: AutocompleteSuggestion) => {
    if (!currentPath || !textareaRef.current) return;

    // Find where the current path starts
    const textBeforeCursor = expression.slice(0, cursorPosition);
    const tokenBoundary = /[\s+\-*/%()[\]{},<>=!&|?:]/;
    let tokenStart = cursorPosition;

    for (let i = textBeforeCursor.length - 1; i >= 0; i--) {
      if (tokenBoundary.test(textBeforeCursor[i])) {
        tokenStart = i + 1;
        break;
      }
      if (i === 0) {
        tokenStart = 0;
      }
    }

    // Build new expression with the selected path
    const beforeToken = expression.slice(0, tokenStart);
    const afterCursor = expression.slice(cursorPosition);

    // If suggestion has children, add a dot to continue drilling
    const insertText = suggestion.hasChildren ? suggestion.path + '.' : suggestion.path;
    const newExpression = beforeToken + insertText + afterCursor;
    const newCursorPosition = tokenStart + insertText.length;

    onChange(newExpression);
    setCursorPosition(newCursorPosition);

    // Keep open if drilling down, close otherwise
    if (!suggestion.hasChildren) {
      setIsOpen(false);
      suppressNextOpenRef.current = true;
    }

    // Restore focus and cursor position
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(newCursorPosition, newCursorPosition);
      }
    }, 0);
  }, [currentPath, expression, cursorPosition, onChange]);

  // Public select handler
  const handleSelect = useCallback((suggestion: AutocompleteSuggestion) => {
    handleSelectInternal(suggestion);
  }, [handleSelectInternal]);

  const handleSetSelectedIndex = useCallback((index: number) => {
    setSelectedIndex(index);
  }, []);

  // Close handler
  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  // Focus handler - update cursor position
  const handleFocus = useCallback(() => {
    if (textareaRef.current) {
      setCursorPosition(textareaRef.current.selectionStart ?? 0);
    }
  }, []);

  // Blur handler - close with delay (allow click on dropdown)
  const handleBlur = useCallback(() => {
    setTimeout(() => {
      setIsOpen(false);
    }, 200);
  }, []);

  const state: ExpressionAutocompleteState = {
    isOpen,
    cursorPosition,
    filteredSuggestions,
    currentPath,
    position,
    selectedIndex
  };

  const handlers: ExpressionAutocompleteHandlers = {
    handleChange,
    handleKeyDown,
    handleSelect,
    setSelectedIndex: handleSetSelectedIndex,
    close,
    handleFocus,
    handleBlur,
    textareaRef
  };

  return [state, handlers];
}

export default useExpressionAutocomplete;
