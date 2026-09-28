'use client';

import React, { useLayoutEffect, useEffect, useRef, useCallback, useState } from 'react';
import { FormFieldComponent, AutomationProps } from '../ui-reflection/types';
import { useAutomationIdAndRegister } from '../ui-reflection/useAutomationIdAndRegister';
import { cn } from '../lib/utils';

type TextAreaSize = 'sm' | 'md' | 'lg';

const textAreaSizeClasses: Record<TextAreaSize, string> = {
  sm: 'py-1 px-2 text-xs',
  md: 'py-2 px-3',
  lg: 'py-3 px-4 text-base',
};

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
  /** Size variant */
  size?: TextAreaSize;
}

export function TextArea(allProps: TextAreaProps & AutomationProps) {
  const isControlled = Object.prototype.hasOwnProperty.call(allProps, 'value');
  const {
    label,
    onChange,
    className,
    value,
    id,
    disabled,
    required,
    size = 'md',
    ref: forwardedRef,
    wrapperClassName,
    "data-automation-id": dataAutomationId,
    ...props
  } = allProps;
  const [uncontrolledValue, setUncontrolledValue] = useState(() => props.defaultValue ?? '');
  const reflectedValue = isControlled ? value : uncontrolledValue;
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
  }, [reflectedValue]);

  // Use provided data-automation-id or register normally
  const { automationIdProps: textAreaProps, updateMetadata } = useAutomationIdAndRegister<FormFieldComponent>({
    type: 'formField',
    fieldType: 'textField',
    id,
    label,
    value: typeof reflectedValue === 'string' ? reflectedValue : undefined,
    disabled,
    required
  }, true, dataAutomationId);

  // Always use the generated automation props (which include our override ID if provided)
  const finalAutomationProps = textAreaProps;

  // Update metadata when field props change
  useEffect(() => {
    if (updateMetadata && typeof reflectedValue === 'string') {
      updateMetadata({
        value: reflectedValue,
        label,
        disabled,
        required
      });
    }
  }, [reflectedValue, updateMetadata, label, disabled, required]);

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (!isControlled) {
      setUncontrolledValue(e.currentTarget.value);
    }
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
        <label
          htmlFor={finalAutomationProps.id}
          className="block text-sm font-medium text-[rgb(var(--color-text-700))] mb-1"
        >
          {label}
        </label>
      )}
      <textarea
        ref={mergedRef}
        rows={1}
        className={`
          w-full max-w-4xl
          ${textAreaSizeClasses[size]}
          border
          border-border
          rounded-lg
          shadow-sm
          focus:outline-none
          focus:ring-2
          focus:ring-[rgb(var(--color-primary-500))]
          focus:border-transparent
          resize-none
          overflow-hidden
          whitespace-pre-wrap break-words
          placeholder:text-[rgb(var(--color-text-400))]
          ${className}
        `}
        onChange={handleInput}
        {...(isControlled ? { value: value ?? '' } : {})}
        disabled={disabled}
        required={required}
        {...finalAutomationProps}
        {...props}
      />
    </div>
  );
}
