import React, { InputHTMLAttributes, forwardRef, useEffect, useRef, useCallback } from 'react';
import { useRegisterUIComponent } from '../../types/ui-reflection/useRegisterUIComponent';
import { FormFieldComponent } from '../../types/ui-reflection/types';
import { withDataAutomationId } from '../../types/ui-reflection/withDataAutomationId';

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label?: string;
  preserveCursor?: boolean;
  /** Unique identifier for UI reflection system */
  id?: string;
  /** Whether the input is required */
  required?: boolean;
  /** Additional class names */
  className?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ 
    label, 
    className, 
    preserveCursor = true, 
    id, 
    required, 
    value, 
    disabled, 
    onChange,
    ...props 
  }, forwardedRef) => {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const cursorPositionRef = useRef<number | null>(null);
    const isComposing = useRef(false);

    const handleRef = useCallback(
      (element: HTMLInputElement | null) => {
        // Forward the ref
        if (typeof forwardedRef === 'function') {
          forwardedRef(element);
        } else if (forwardedRef) {
          forwardedRef.current = element;
        }
      },
      [forwardedRef]
    );

    // Register with UI reflection system if id is provided
    const updateMetadata = id ? useRegisterUIComponent<FormFieldComponent>({
      type: 'formField',
      fieldType: 'textField',
      id,
      label,
      value: typeof value === 'string' ? value : undefined,
      disabled,
      required
    }) : undefined;

    // Update metadata when field props change
    useEffect(() => {
      if (updateMetadata && typeof value === 'string') {
        updateMetadata({
          value,
          label,
          disabled,
          required
        });
      }
    }, [value, updateMetadata, label, disabled, required, id]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!isComposing.current && preserveCursor) {
        cursorPositionRef.current = e.target.selectionStart;
      }
      onChange?.(e);
    };

    // Restore cursor position after value changes
    useEffect(() => {
      if (
        preserveCursor &&
        !isComposing.current &&
        cursorPositionRef.current !== null &&
        inputRef.current &&
        document.activeElement === inputRef.current
      ) {
        const pos = cursorPositionRef.current;
        requestAnimationFrame(() => {
          if (inputRef.current) {
            inputRef.current.setSelectionRange(pos, pos);
          }
        });
      }
    }, [value, preserveCursor]);

    const handleCompositionStart = () => {
      isComposing.current = true;
    };

    const handleCompositionEnd = (e: React.CompositionEvent<HTMLInputElement>) => {
      isComposing.current = false;
      if (preserveCursor) {
        const input = e.target as HTMLInputElement;
        cursorPositionRef.current = input.selectionStart;
      }
    };

    return (
      <div className="mb-4">
        {label && (
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {label}
          </label>
        )}
        <input
          ref={(element) => {
            inputRef.current = element;
            handleRef(element);
          }}
          className={`w-full px-3 py-2 border border-gray-200 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent ${className}`}
          {...withDataAutomationId({ id })}
          value={value}
          disabled={disabled}
          required={required}
          onChange={handleChange}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          {...props}
        />
      </div>
    );
  }
);

Input.displayName = 'Input';
