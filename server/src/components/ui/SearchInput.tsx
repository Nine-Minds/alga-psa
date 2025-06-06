import React, { forwardRef, InputHTMLAttributes, useEffect } from 'react';
import { Search } from 'lucide-react';
import { FormFieldComponent, AutomationProps } from '../../types/ui-reflection/types';
import { useAutomationIdAndRegister } from '../../types/ui-reflection/useAutomationIdAndRegister';
import { withDataAutomationId } from '../../types/ui-reflection/withDataAutomationId';

interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  /** Unique identifier for UI reflection system */
  id?: string;
  /** Additional class names */
  className?: string;
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps & AutomationProps>(
  ({ className, value, onChange, id, ...props }, ref) => {
    const { automationIdProps: textProps, updateMetadata } = useAutomationIdAndRegister<FormFieldComponent>({
      id,
      type: 'formField',
      fieldType: 'textField',
      value: typeof value === 'string' ? value : undefined
    });

    // Update metadata when field props change
    useEffect(() => {
      if (updateMetadata) {
        updateMetadata({
          value: typeof value === 'string' ? value : undefined
        });
      }
    }, [value, updateMetadata]);

    return (
      <div className="relative">
        <input
          {...textProps}
          type="text"
          className={`border-2 border-gray-200 focus:border-purple-500 rounded-md pl-10 pr-4 py-2 outline-none bg-white ${className}`}
          value={value}
          onChange={onChange}
          ref={ref}
          {...withDataAutomationId({ id: textProps.id })}
          {...props}
        />
        <Search size={20} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
      </div>
    );
  }
);

SearchInput.displayName = 'SearchInput';
