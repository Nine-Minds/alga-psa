'use client';

/**
 * Expression TextArea with Autocomplete
 *
 * A textarea component specifically for JSONata expressions with
 * context-aware autocomplete support.
 *
 * §16.2 - Context-aware autocomplete in expression fields
 */

import React, { useCallback, useMemo } from 'react';
import { TextArea } from '@/components/ui/TextArea';
import {
  ExpressionAutocomplete,
  buildSuggestionsFromContext,
  type AutocompleteSuggestion
} from './ExpressionAutocomplete';
import { useExpressionAutocomplete } from './useExpressionAutocomplete';
import type { SelectOption } from '@/components/ui/CustomSelect';

/**
 * Data field for building autocomplete suggestions
 */
export interface DataContextField {
  path: string;
  type?: string;
  description?: string;
  children?: DataContextField[];
}

/**
 * Props for the ExpressionTextArea component
 */
export interface ExpressionTextAreaProps {
  /** Unique ID for the textarea */
  id: string;
  /** Current expression value */
  value: string;
  /** Callback when expression changes */
  onChange: (value: string) => void;
  /** Available fields from data context (for autocomplete) */
  fieldOptions: SelectOption[];
  /** Number of visible rows */
  rows?: number;
  /** Placeholder text */
  placeholder?: string;
  /** Error state class names */
  className?: string;
  /** Whether the input is disabled */
  disabled?: boolean;
}

/**
 * Convert SelectOption to AutocompleteSuggestion
 */
function buildSuggestionsFromOptions(options: SelectOption[]): AutocompleteSuggestion[] {
  return options.map(opt => {
    const path = opt.value;
    const parts = path.split('.');
    const label = parts[parts.length - 1] || path;

    // Infer type from path name patterns
    let type: string | undefined;
    const lowerLabel = label.toLowerCase();
    const normalizedLabel = lowerLabel.endsWith('[]') ? lowerLabel.slice(0, -2) : lowerLabel;

    if (lowerLabel.endsWith('[]')) type = 'array';
    else if (normalizedLabel.endsWith('id') || normalizedLabel === 'id') type = 'string';
    else if (normalizedLabel.endsWith('email') || normalizedLabel === 'email') type = 'string';
    else if (normalizedLabel.endsWith('name') || normalizedLabel === 'name') type = 'string';
    else if (normalizedLabel.endsWith('count') || normalizedLabel === 'total') type = 'number';
    else if (normalizedLabel.startsWith('is_') || normalizedLabel.startsWith('has_')) type = 'boolean';
    else if (normalizedLabel.endsWith('date') || normalizedLabel.endsWith('_at')) type = 'date';
    else if (normalizedLabel.endsWith('items') || normalizedLabel.endsWith('list')) type = 'array';

    // Check for parent paths that indicate objects
    const hasChildren = options.some(o =>
      o.value !== path && o.value.startsWith(path + '.')
    );

    return {
      path,
      label,
      type: type || (hasChildren ? 'object' : undefined),
      description: typeof opt.label === 'string' ? opt.label : undefined,
      hasChildren,
      parentPath: parts.slice(0, -1).join('.')
    };
  });
}

/**
 * ExpressionTextArea Component
 *
 * Provides a textarea for JSONata expressions with context-aware autocomplete.
 * When the user types known path prefixes (payload., vars., etc.), a dropdown
 * appears showing available fields from the data context.
 */
export const ExpressionTextArea: React.FC<ExpressionTextAreaProps> = ({
  id,
  value,
  onChange,
  fieldOptions,
  rows = 2,
  placeholder = 'Enter JSONata expression...',
  className = '',
  disabled = false
}) => {
  // Build autocomplete suggestions from field options
  const suggestions = useMemo(
    () => buildSuggestionsFromOptions(fieldOptions),
    [fieldOptions]
  );

  // Use the autocomplete hook
  const [autocompleteState, autocompleteHandlers] = useExpressionAutocomplete({
    suggestions,
    expression: value,
    onChange,
    disabled
  });

  // Combined change handler
  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    autocompleteHandlers.handleChange(e);
  }, [autocompleteHandlers]);

  // Combined keydown handler
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    autocompleteHandlers.handleKeyDown(e);
  }, [autocompleteHandlers]);

  return (
    <div className="relative">
      <TextArea
        ref={autocompleteHandlers.textareaRef}
        id={id}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={autocompleteHandlers.handleFocus}
        onBlur={autocompleteHandlers.handleBlur}
        rows={rows}
        placeholder={placeholder}
        className={`font-mono text-sm ${className}`}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
      />

      {/* Autocomplete dropdown */}
      <ExpressionAutocomplete
        expression={value}
        cursorPosition={autocompleteState.cursorPosition}
        suggestions={autocompleteState.filteredSuggestions}
        selectedIndex={autocompleteState.selectedIndex}
        onHighlight={autocompleteHandlers.setSelectedIndex}
        onSelect={autocompleteHandlers.handleSelect}
        onClose={autocompleteHandlers.close}
        position={autocompleteState.position}
        visible={autocompleteState.isOpen}
      />

      {/* Hint text */}
      {!disabled && !autocompleteState.isOpen && value.length === 0 && (
        <p className="mt-1 text-xs text-gray-400">
          Type <code className="bg-gray-100 px-1 rounded">payload.</code>,{' '}
          <code className="bg-gray-100 px-1 rounded">vars.</code>, or{' '}
          <code className="bg-gray-100 px-1 rounded">meta.</code> for autocomplete
        </p>
      )}
    </div>
  );
};

export default ExpressionTextArea;
