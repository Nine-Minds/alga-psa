'use client';

import React, { InputHTMLAttributes, useEffect, useRef, useCallback } from 'react';
import { Search, X } from 'lucide-react';
import Spinner from './Spinner';
import { FormFieldComponent, AutomationProps } from '../ui-reflection/types';
import { useAutomationIdAndRegister } from '../ui-reflection/useAutomationIdAndRegister';
import { withDataAutomationId } from '../ui-reflection/withDataAutomationId';

interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'onChange'> {
  /** Unique identifier for UI reflection system */
  id?: string;
  /** Additional class names */
  className?: string;
  /** Ref for the input element */
  ref?: React.Ref<HTMLInputElement>;
  /** Show a loading spinner instead of the search icon */
  loading?: boolean;
  /** Debounce delay in milliseconds for onChange */
  debounceMs?: number;
  /** Called when the clear button is clicked */
  onClear?: () => void;
  /** onChange handler (debounced if debounceMs is provided) */
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function SearchInput({
  className,
  value,
  onChange,
  id,
  ref,
  loading = false,
  debounceMs,
  onClear,
  ...props
}: SearchInputProps & AutomationProps) {
  const { automationIdProps: textProps, updateMetadata } = useAutomationIdAndRegister<FormFieldComponent>({
    id,
    type: 'formField',
    fieldType: 'textField',
    value: typeof value === 'string' ? value : undefined
  });

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // Update metadata when field props change
  useEffect(() => {
    if (updateMetadata) {
      updateMetadata({
        value: typeof value === 'string' ? value : undefined
      });
    }
  }, [value, updateMetadata]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!onChange) return;

      if (debounceMs && debounceMs > 0) {
        // Persist the event so it can be used asynchronously
        e.persist?.();
        if (debounceTimerRef.current !== null) {
          clearTimeout(debounceTimerRef.current);
        }
        debounceTimerRef.current = setTimeout(() => {
          onChange(e);
          debounceTimerRef.current = null;
        }, debounceMs);
      } else {
        onChange(e);
      }
    },
    [onChange, debounceMs]
  );

  const hasValue = value !== undefined && value !== null && value !== '';

  return (
    <div className="relative p-0.5">
      <input
        {...textProps}
        type="text"
        className={`border-2 border-gray-200 focus:border-primary focus:ring-1 focus:ring-primary/20 rounded-md pl-10 pr-8 py-2 outline-none bg-white ${className}`}
        value={value}
        onChange={handleChange}
        ref={ref}
        {...withDataAutomationId({ id: textProps.id })}
        {...props}
      />
      <div className="absolute left-3 top-1/2 transform -translate-y-1/2">
        {loading ? (
          <Spinner size="button" className="text-gray-400" />
        ) : (
          <Search size={20} className="text-gray-400" />
        )}
      </div>
      {hasValue && (
        <button
          type="button"
          onClick={onClear}
          className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none"
          aria-label="Clear search"
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}
