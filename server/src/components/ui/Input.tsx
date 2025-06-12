import React, { InputHTMLAttributes, forwardRef, useEffect, useRef, useCallback } from 'react';
import { FormFieldComponent, AutomationProps } from '../../types/ui-reflection/types';
import { withDataAutomationId } from '../../types/ui-reflection/withDataAutomationId';
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
}

export const Input = forwardRef<HTMLInputElement, InputProps & AutomationProps>(
  ({ 
    label, 
    className,
    containerClassName, 
    preserveCursor = true, 
    id, 
    required, 
    value, 
    disabled, 
    onChange,
    "data-automation-type": dataAutomationType = 'input',
    "data-automation-id": dataAutomationId,
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

    return (
      <div className={containerClassName !== undefined ? containerClassName : "mb-0"}>
        {label && (
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {label}
          </label>
        )}
        <input
          {...finalAutomationProps}
          ref={(element) => {
            inputRef.current = element;
            handleRef(element);
          }}
          className={`w-full px-3 py-2 border border-[rgb(var(--color-border-400))] rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent placeholder:text-gray-400 ${className}`}
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
