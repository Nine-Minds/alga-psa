'use client';

/**
 * Expression Autocomplete Component
 *
 * Provides context-aware autocomplete for JSONata expressions in the mapping editor.
 *
 * §16.2 - Context-aware autocomplete in expression fields
 *
 * Features:
 * - Triggers on typing path prefixes (payload., vars., meta., error., env., secrets.)
 * - Shows available fields from data context
 * - Supports drilling into nested structures
 * - Keyboard navigation (Arrow keys, Enter, Escape, Tab)
 */

import React, { useCallback, useRef, useEffect } from 'react';
import { ChevronRight, Hash, ToggleLeft, Type, Braces, List, Calendar, HelpCircle } from 'lucide-react';
import type { AutocompleteSuggestion } from './expressionAutocompleteUtils';

/**
 * Props for the autocomplete dropdown
 */
export interface ExpressionAutocompleteProps {
  /** Current expression text */
  expression: string;
  /** Cursor position in the expression */
  cursorPosition: number;
  /** Available suggestions based on data context */
  suggestions: AutocompleteSuggestion[];
  /** Highlighted suggestion index */
  selectedIndex: number;
  /** Update highlighted suggestion index */
  onHighlight: (index: number) => void;
  /** Callback when a suggestion is selected */
  onSelect: (suggestion: AutocompleteSuggestion) => void;
  /** Callback to close the dropdown */
  onClose: () => void;
  /** Position for the dropdown (relative to textarea) */
  position?: { top: number; left: number };
  /** Whether the dropdown is visible */
  visible: boolean;
}

/**
 * Get icon for a data type
 */
function getTypeIcon(type?: string): React.ReactNode {
  switch (type?.toLowerCase()) {
    case 'string':
      return <Type className="w-3.5 h-3.5 text-blue-500" />;
    case 'number':
    case 'integer':
      return <Hash className="w-3.5 h-3.5 text-purple-500" />;
    case 'boolean':
      return <ToggleLeft className="w-3.5 h-3.5 text-green-500" />;
    case 'object':
      return <Braces className="w-3.5 h-3.5 text-orange-500" />;
    case 'array':
      return <List className="w-3.5 h-3.5 text-cyan-500" />;
    case 'date':
      return <Calendar className="w-3.5 h-3.5 text-pink-500" />;
    default:
      return <HelpCircle className="w-3.5 h-3.5 text-gray-400" />;
  }
}

/**
 * Expression Autocomplete Dropdown Component
 */
export const ExpressionAutocomplete: React.FC<ExpressionAutocompleteProps> = ({
  expression,
  cursorPosition,
  suggestions,
  selectedIndex,
  onHighlight,
  onSelect,
  onClose,
  position,
  visible
}) => {
  const listRef = useRef<HTMLDivElement>(null);

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current && selectedIndex >= 0) {
      const items = listRef.current.querySelectorAll('[role="option"]');
      items[selectedIndex]?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        onHighlight(Math.min(selectedIndex + 1, suggestions.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        onHighlight(Math.max(selectedIndex - 1, 0));
        break;
      case 'Enter':
      case 'Tab':
        e.preventDefault();
        if (suggestions[selectedIndex]) {
          onSelect(suggestions[selectedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
    }
  }, [suggestions, selectedIndex, onHighlight, onSelect, onClose]);

  if (!visible || suggestions.length === 0) {
    return null;
  }

  return (
    <div
      className="absolute z-50 bg-white border border-gray-200 rounded-md shadow-lg max-h-64 overflow-auto min-w-[200px] max-w-[400px]"
      style={{
        top: position?.top ?? 0,
        left: position?.left ?? 0
      }}
      onKeyDown={handleKeyDown}
      ref={listRef}
      role="listbox"
      aria-label="Expression autocomplete suggestions"
    >
      {suggestions.map((suggestion, index) => (
        <div
          key={suggestion.path}
          role="option"
          aria-selected={index === selectedIndex}
          className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer text-sm ${
            index === selectedIndex
              ? 'bg-primary-50 text-primary-900'
              : 'hover:bg-gray-50'
          }`}
          onClick={() => onSelect(suggestion)}
          onMouseEnter={() => onHighlight(index)}
        >
          {getTypeIcon(suggestion.type)}
          <span className="flex-1 truncate font-mono text-xs">
            {suggestion.label}
          </span>
          {suggestion.type && (
            <span className="text-xs text-gray-400">{suggestion.type}</span>
          )}
          {suggestion.hasChildren && (
            <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
          )}
        </div>
      ))}
    </div>
  );
};

/**
 * Filter suggestions based on the current path being typed
 *
 * @param allSuggestions - All available suggestions from data context
 * @param currentPath - The path currently being typed
 * @returns Filtered and sorted suggestions
 */
/**
 * Build suggestions from data context fields
 *
 * @param dataContextFields - Flat list of available fields from WorkflowDesigner
 * @returns Autocomplete suggestions
 */
export function buildSuggestionsFromContext(
  dataContextFields: Array<{
    path: string;
    type?: string;
    description?: string;
    children?: unknown[];
  }>
): AutocompleteSuggestion[] {
  return dataContextFields.map(field => ({
    path: field.path,
    label: field.path.split('.').pop() || field.path,
    type: field.type,
    description: field.description,
    hasChildren: Array.isArray(field.children) && field.children.length > 0,
    parentPath: field.path.split('.').slice(0, -1).join('.')
  }));
}

/**
 * Calculate dropdown position based on textarea and cursor
 */
export function calculateDropdownPosition(
  textarea: HTMLTextAreaElement,
  cursorPosition: number
): { top: number; left: number } {
  const style = window.getComputedStyle(textarea);
  const lineHeight = parseInt(style.lineHeight) || 20;

  // Create a mirror element to measure cursor position
  const mirror = document.createElement('div');
  const textareaRect = textarea.getBoundingClientRect();

  // Copy styles and position mirror at same location as textarea
  mirror.style.cssText = `
    position: fixed;
    visibility: hidden;
    white-space: pre-wrap;
    word-wrap: break-word;
    overflow-wrap: break-word;
    width: ${style.width};
    font-family: ${style.fontFamily};
    font-size: ${style.fontSize};
    line-height: ${style.lineHeight};
    padding: ${style.padding};
    border: ${style.border};
    top: ${textareaRect.top}px;
    left: ${textareaRect.left}px;
  `;

  // Insert text up to cursor with a marker span
  const textBeforeCursor = textarea.value.slice(0, cursorPosition);
  mirror.innerHTML = textBeforeCursor.replace(/\n/g, '<br>') + '<span id="cursor-marker">|</span>';

  document.body.appendChild(mirror);

  const marker = mirror.querySelector('#cursor-marker');
  const markerRect = marker?.getBoundingClientRect();

  document.body.removeChild(mirror);

  if (!markerRect) {
    // Fallback: position below textarea
    return { top: textarea.offsetHeight + 4, left: 0 };
  }

  // Calculate position relative to textarea
  let left = markerRect.left - textareaRect.left;
  const top = markerRect.top - textareaRect.top + lineHeight + 4;

  // Ensure left is never negative and doesn't overflow
  left = Math.max(0, left);
  left = Math.min(left, textarea.offsetWidth - 220);

  return { top, left };
}

export default ExpressionAutocomplete;
