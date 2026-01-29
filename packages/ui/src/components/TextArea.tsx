'use client';

import React, { useLayoutEffect, useEffect, useRef, useCallback } from 'react';
import { FormFieldComponent, AutomationProps } from '../ui-reflection/types';
import { useAutomationIdAndRegister } from '../ui-reflection/useAutomationIdAndRegister';
import { cn } from '../lib/utils';

interface TextAreaProps extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  label?: string;
  /** Unique identifier for UI reflection system */
  id?: string;
  /** Whether the textarea is required */
  required?: boolean;
  /** Ref for the textarea element */
  ref?: React.Ref<HTMLTextAreaElement>;
  /** Optional wrapper class overrides */
  wrapperClassName?: string;
}

export function TextArea({
  label,
  onChange,
  className,
  value = '',
  id,
  disabled,
  required,
  ref: forwardedRef,
  wrapperClassName,
  "data-automation-id": dataAutomationId,
  ...props
}: TextAreaProps & AutomationProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const mergedRef = useCallback(
    (node: HTMLTextAreaElement | null) => {
      textareaRef.current = node;
      if (typeof forwardedRef === 'function') {
        forwardedRef(node);
      } else if (forwardedRef) {
        forwardedRef.current = node;
      }
    },
    [forwardedRef]
  );

  const adjustHeight = (element: HTMLTextAreaElement) => {
    // Temporarily collapse to get the minimum height
    element.style.height = 'auto';

    // Get the computed line height to ensure proper minimum height
    const computedStyle = window.getComputedStyle(element);
    const lineHeight = parseInt(computedStyle.lineHeight);

    // Calculate height based on content
    const newHeight = Math.max(
      element.scrollHeight,
      lineHeight * 1.5 // Minimum height of ~1.5 lines
    );

    // Set the new height
    element.style.height = `${newHeight}px`;
  };

  // Initial setup and content-based adjustment
  useEffect(() => {
    if (textareaRef.current) {
      const element = textareaRef.current;

      // Ensure proper initial display
      element.style.height = 'auto';
      element.style.overflow = 'hidden';

      // Force a reflow and adjust height
      void element.offsetHeight;
      adjustHeight(element);
    }
  }, []);

  // Handle value changes
  useLayoutEffect(() => {
    if (textareaRef.current) {
      adjustHeight(textareaRef.current);
    }
  }, [value]);

  // Use provided data-automation-id or register normally
  const { automationIdProps: textAreaProps, updateMetadata } = useAutomationIdAndRegister<FormFieldComponent>({
    type: 'formField',
    fieldType: 'textField',
    id,
    label,
    value: typeof value === 'string' ? value : undefined,
    disabled,
    required
  }, true, dataAutomationId);

  // Always use the generated automation props (which include our override ID if provided)
  const finalAutomationProps = textAreaProps;

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
  }, [value, updateMetadata, label, disabled, required]);

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (textareaRef.current) {
      adjustHeight(textareaRef.current);
    }

    if (onChange) {
      onChange(e);
    }
  };

  return (
    <div className={cn('mb-4 px-0.5', wrapperClassName)}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {label}
        </label>
      )}
      <textarea
        ref={mergedRef}
        rows={1}
        className={`
          w-full max-w-4xl
          px-3
          py-2
          border
          border-[rgb(var(--color-border-400))]
          rounded-md
          shadow-sm
          focus:outline-none
          focus:ring-2
          focus:ring-[rgb(var(--color-primary-500))]
          focus:border-transparent
          resize-none
          overflow-hidden
          whitespace-pre-wrap break-words
          placeholder:text-gray-400
          ${className}
        `}
        onChange={handleInput}
        value={value}
        disabled={disabled}
        required={required}
        {...finalAutomationProps}
        {...props}
      />
    </div>
  );
}
