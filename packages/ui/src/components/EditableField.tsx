'use client';

import React, { useState, useRef, useEffect } from 'react';
import CustomSelect from './CustomSelect';
import { AutomationProps } from '../ui-reflection/types';

interface EditableFieldProps {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onValueChange: (value: string) => void;
}

interface StyleProps {
  trigger: string;
  content: string;
  item: string;
  itemIndicator: string;
}

const EditableField = ({ label, value, options, onValueChange }: EditableFieldProps & AutomationProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const fieldRef = useRef<HTMLDivElement>(null);

  const currentOption = options.find(option => option.value === value);

  const customStyles: StyleProps = {
    trigger: "inline-flex items-center justify-between rounded px-3 py-2 text-sm font-medium bg-white border border-gray-300 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500",
    content: "bg-white rounded-md shadow-lg ring-1 ring-black ring-opacity-5 overflow-auto",
    item: "text-gray-900 cursor-default select-none relative py-2 pl-3 pr-9 hover:bg-indigo-600 hover:text-white",
    itemIndicator: "absolute inset-y-0 right-0 flex items-center pr-4 text-indigo-600",
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (fieldRef.current && !fieldRef.current.contains(event.target as Node)) {
        setIsEditing(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  return (
    <div className="relative" ref={fieldRef}>
      <h5 className="font-bold">{label}</h5>
      {isEditing ? (
        <CustomSelect
          value={value}
          onValueChange={(newValue) => {
            onValueChange(newValue);
            setIsEditing(false);
          }}
          options={options}
          customStyles={customStyles}
        />
      ) : (
        <p
          className="text-sm text-gray-500 cursor-pointer inline-block"
          onClick={() => setIsEditing(true)}
        >
          <span className="hover:bg-gray-100 rounded px-[2px] py-[3px] transition-colors duration-200 ">
            {currentOption?.label || 'Not set'}
          </span>
        </p>
      )}
    </div>
  );
};

export default EditableField;
