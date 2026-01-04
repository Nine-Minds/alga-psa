import React, { InputHTMLAttributes, useEffect, useRef, useCallback } from 'react';
import { FormFieldComponent, AutomationProps } from '../../types/ui-reflection/types';
import { useAutomationIdAndRegister } from 'server/src/types/ui-reflection/useAutomationIdAndRegister';
import { CommonActions } from 'server/src/types/ui-reflection/actionBuilders';

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label?: string;
  preserveCursor?: boolean;
  /** Unique identifier for UI reflection system */
  id?: string;
  /** Whether the input is required */
  required?: boolean;
  /** Additional class names */
  className?: string;
  /** Additional class names for the container div */
  containerClassName?: string;
  /** Error message to display */
  error?: string;
  /** Array of error messages to display */
  errors?: string[];
  /** Whether the field has an error state */
  hasError?: boolean;
  /** Ref for the input element */
  ref?: React.Ref<HTMLInputElement>;
}

export function Input({
  label,
  className,
  containerClassName,
  preserveCursor = true,
  id,
  required,
  value,
  disabled,
  onChange,
  error,
  errors,
  hasError,
  ref: forwardedRef,
  "data-automation-type": dataAutomationType = 'input',
  "data-automation-id": dataAutomationId,
  ...props
}: InputProps & AutomationProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const cursorPositionRef = useRef<number | null>(null);
  const isComposing = useRef(false);

  const mergedRef = useCallback(
    (element: HTMLInputElement | null) => {
      inputRef.current = element;
      // Forward the ref
      if (typeof forwardedRef === 'function') {
        forwardedRef(element);
      } else if (forwardedRef) {
        forwardedRef.current = element;
      }
    },
    [forwardedRef]
  );

  // Use provided data-automation-id or register normally
  const { automationIdProps: textProps, updateMetadata } = useAutomationIdAndRegister<FormFieldComponent>({
    id,
    type: 'formField',
    fieldType: 'textField',
    label,
    value: typeof value === 'string' ? value : undefined,
    disabled,
    required
  }, () => [
    CommonActions.type(label ? `Type text into ${label} field` : 'Type text into this field'),
    CommonActions.focus('Focus this input field'),
    CommonActions.clear('Clear the current text')
  ], dataAutomationId);

  // Always use the generated automation props (which include our override ID if provided)
  const finalAutomationProps = textProps;

  // Update metadata when field props change
  useEffect(() => {
    if (updateMetadata) {
      updateMetadata({
        value: typeof value === 'string' ? value : undefined,
        label,
        disabled,
        required
      });
    }
  }, [value, updateMetadata, label, disabled, required]);

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

  const displayErrors = errors || (error ? [error] : []);
  const hasErrorState = hasError || displayErrors.length > 0;

  return (
    <div className={containerClassName !== undefined ? containerClassName : "mb-0"}>
      {label && (
        <label className={`block text-sm font-medium mb-1 ${hasErrorState ? 'text-red-700' : 'text-gray-700'}`}>
          {label}
        </label>
      )}
      <input
        {...finalAutomationProps}
        ref={mergedRef}
        className={`w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 placeholder:text-gray-400 ${
          hasErrorState
            ? 'border-red-500 focus:ring-red-500 focus:border-red-500 bg-red-50'
            : 'border-[rgb(var(--color-border-400))] focus:ring-[rgb(var(--color-primary-500))] focus:border-transparent file:mr-3 file:rounded-md file:border-0 file:bg-[rgba(var(--color-primary-500),0.08)] file:px-3 file:py-2 file:text-sm file:font-medium file:text-[rgb(var(--color-primary-700))]'
        } ${className}`}
        value={value}
        disabled={disabled}
        required={required}
        onChange={handleChange}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        {...props}
      />
      {displayErrors.length > 0 && (
        <div className="mt-1">
          {displayErrors.map((errorMsg, index) => (
            <p key={index} className="text-sm text-red-600">
              {errorMsg}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
