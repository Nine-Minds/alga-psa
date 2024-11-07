// components/CustomSelect.tsx
import React from 'react';
import { SelectOption } from './Select';
import * as Select from '@radix-ui/react-select';
import { ChevronDown } from 'lucide-react';

interface CustomSelectProps {
  options: SelectOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  // Add styles prop definition
  styles?: {
    trigger?: string;
    content?: string;
    item?: string;
    itemIndicator?: string;
  };
}

const CustomSelect: React.FC<CustomSelectProps> = ({
  options,
  value,
  onValueChange,
  placeholder = 'Select...',
  // Add styles to props
  styles = {}
}) => {
  // Use the provided styles or fall back to defaults
  const defaultStyles = {
    trigger: "inline-flex items-center justify-between border border-gray-300 rounded-lg p-2 bg-white cursor-pointer min-h-[38px] hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent min-w-[150px] text-sm",
    content: "bg-white rounded-md shadow-lg border border-gray-200 mt-1",
    item: "text-gray-900 cursor-default select-none relative py-2 pl-3 pr-9 hover:bg-indigo-600 hover:text-white",
    itemIndicator: "absolute inset-y-0 right-0 flex items-center pr-4 text-indigo-600"
  };

  const mergedStyles = {
    trigger: styles.trigger || defaultStyles.trigger,
    content: styles.content || defaultStyles.content,
    item: styles.item || defaultStyles.item,
    itemIndicator: styles.itemIndicator || defaultStyles.itemIndicator
  };

  return (
    <Select.Root value={value} onValueChange={onValueChange}>
      <Select.Trigger className={mergedStyles.trigger}>
        <Select.Value placeholder={placeholder} className="text-gray-500">
          {options.find(option => option.value === value)?.label || placeholder}
        </Select.Value>
        <Select.Icon>
          <ChevronDown className="w-4 h-4 text-gray-400 ml-2" />
        </Select.Icon>
      </Select.Trigger>

      <Select.Portal>
        <Select.Content
          className={mergedStyles.content}
          position="popper"
          sideOffset={4}
        >
          <Select.Viewport className="p-1">
            {options.map((option):JSX.Element => (
              <Select.Item
                key={option.value}
                value={option.value}
                className={mergedStyles.item}
              >
                <Select.ItemText>{option.label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
};

export default CustomSelect;