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

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { ChevronRight, Hash, ToggleLeft, Type, Braces, List, Calendar, HelpCircle } from 'lucide-react';

/**
 * Autocomplete suggestion item
 */
export interface AutocompleteSuggestion {
  /** Full path to insert (e.g., "payload.ticket.id") */
  path: string;
  /** Display label (e.g., "id") */
  label: string;
  /** Data type */
  type?: string;
  /** Description/tooltip */
  description?: string;
  /** Whether this item has children (can drill down) */
  hasChildren?: boolean;
  /** Parent path for grouping */
  parentPath?: string;
}

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
  onSelect,
  onClose,
  position,
  visible
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset selection when suggestions change
  useEffect(() => {
    setSelectedIndex(0);
  }, [suggestions]);

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
        setSelectedIndex(prev => Math.min(prev + 1, suggestions.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
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
  }, [suggestions, selectedIndex, onSelect, onClose]);

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
          onMouseEnter={() => setSelectedIndex(index)}
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
 * Known root paths for autocomplete triggers
 */
const ROOT_TRIGGERS = ['payload', 'vars', 'meta', 'error', 'env', 'secrets', '$item', '$index'];

/**
 * Extract the current path being typed at cursor position
 *
 * @param expression - Full expression text
 * @param cursorPosition - Current cursor position
 * @returns The path segment being typed, or null if not in a completable position
 */
export function extractCurrentPath(expression: string, cursorPosition: number): string | null {
  // Get text before cursor
  const textBeforeCursor = expression.slice(0, cursorPosition);

  // Find the start of the current token (word boundary)
  // Look backwards for whitespace, operators, or opening brackets
  const tokenBoundary = /[\s+\-*/%()[\]{},<>=!&|?:]/;
  let tokenStart = textBeforeCursor.length;

  for (let i = textBeforeCursor.length - 1; i >= 0; i--) {
    if (tokenBoundary.test(textBeforeCursor[i])) {
      tokenStart = i + 1;
      break;
    }
    if (i === 0) {
      tokenStart = 0;
    }
  }

  const currentToken = textBeforeCursor.slice(tokenStart);

  // Check if the token starts with a known root or contains a dot (drilling down)
  if (!currentToken) return null;

  // Check for root trigger match
  for (const trigger of ROOT_TRIGGERS) {
    if (currentToken.startsWith(trigger)) {
      return currentToken;
    }
  }

  return null;
}

/**
 * Filter suggestions based on the current path being typed
 *
 * @param allSuggestions - All available suggestions from data context
 * @param currentPath - The path currently being typed
 * @returns Filtered and sorted suggestions
 */
export function filterSuggestions(
  allSuggestions: AutocompleteSuggestion[],
  currentPath: string | null
): AutocompleteSuggestion[] {
  if (!currentPath) return [];

  const lowerPath = currentPath.toLowerCase();

  // If path ends with '.', show children at that level
  if (currentPath.endsWith('.')) {
    const parentPath = currentPath.slice(0, -1);
    return allSuggestions.filter(s =>
      s.path.toLowerCase().startsWith(parentPath.toLowerCase() + '.') &&
      s.path.split('.').length === parentPath.split('.').length + 1
    );
  }

  // Otherwise, filter by prefix match
  const pathParts = currentPath.split('.');
  const searchTerm = pathParts[pathParts.length - 1].toLowerCase();
  const parentPath = pathParts.slice(0, -1).join('.');

  // First priority: exact parent path with matching children
  const exactParentMatches = allSuggestions.filter(s => {
    const sParts = s.path.split('.');
    const sParent = sParts.slice(0, -1).join('.');
    const sLeaf = sParts[sParts.length - 1].toLowerCase();

    return sParent.toLowerCase() === parentPath.toLowerCase() &&
           sLeaf.startsWith(searchTerm);
  });

  if (exactParentMatches.length > 0) {
    return exactParentMatches.sort((a, b) => a.label.localeCompare(b.label));
  }

  // Fallback: prefix match on full path
  return allSuggestions
    .filter(s => s.path.toLowerCase().startsWith(lowerPath))
    .sort((a, b) => a.path.length - b.path.length || a.label.localeCompare(b.label))
    .slice(0, 20);
}

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
  // Create a mirror element to measure cursor position
  const mirror = document.createElement('div');
  const style = window.getComputedStyle(textarea);

  // Copy styles
  mirror.style.cssText = `
    position: absolute;
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
  `;

  // Insert text up to cursor with a marker span
  const textBeforeCursor = textarea.value.slice(0, cursorPosition);
  mirror.innerHTML = textBeforeCursor.replace(/\n/g, '<br>') + '<span id="cursor-marker">|</span>';

  document.body.appendChild(mirror);

  const marker = mirror.querySelector('#cursor-marker');
  const markerRect = marker?.getBoundingClientRect();
  const textareaRect = textarea.getBoundingClientRect();

  document.body.removeChild(mirror);

  if (!markerRect) {
    return { top: textarea.offsetHeight + 4, left: 0 };
  }

  // Position below the cursor
  return {
    top: markerRect.top - textareaRect.top + parseInt(style.lineHeight) + 4,
    left: Math.min(markerRect.left - textareaRect.left, textarea.offsetWidth - 220)
  };
}

export default ExpressionAutocomplete;
