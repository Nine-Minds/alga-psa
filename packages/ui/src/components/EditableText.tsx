'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Input } from './Input';
import { AutomationProps } from '../ui-reflection/types';

interface EditableTextProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

const EditableText = ({ value, onChange, placeholder, className }: EditableTextProps & AutomationProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [tempValue, setTempValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isEditing]);

  const handleBlur = () => {
    setIsEditing(false);
    onChange(tempValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      setIsEditing(false);
      onChange(tempValue);
    }
  };

  return (
    <div className={`relative ${className}`}>
      {isEditing ? (
        <Input
          ref={inputRef}
          value={tempValue}
          onChange={(e) => setTempValue(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className="w-full p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[rgb(var(--color-primary-500))]"
          placeholder={placeholder}
        />
      ) : (
        <div
          className="cursor-pointer p-2 hover:bg-gray-100 rounded transition-colors duration-200"
          onClick={() => setIsEditing(true)}
        >
          {value || placeholder || 'Click to edit'}
        </div>
      )}
    </div>
  );
};

export default EditableText;
