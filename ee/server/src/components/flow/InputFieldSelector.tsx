// src/components/InputFieldSelector.tsx

import React, { useState, useEffect, useRef, useId } from 'react';
import Popup from './Popup';
import { Template } from '../../services/flow/types/workflowTypes';
import { Input } from '../../../../../server/src/components/ui/Input';

interface InputFieldSelectorProps {
  value: Template;
  onChange: (value: string) => void;
  inputType: string;
  id?: string;
}

const InputFieldSelector: React.FC<InputFieldSelectorProps> = ({ value, onChange, inputType, id }) => {
  const [isPopupOpen, setIsPopupOpen] = useState(false);
  const [fields, setFields] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const reactId = useId();
  const uniqueId = id || `input-field-selector-${reactId.replace(/:/g, '')}`;

  useEffect(() => {
    async function fetchFields() {
      try {
        const response = await fetch(`/api/protofields/${inputType}`);
        if (!response.ok) {
          throw new Error('Failed to fetch fields');
        }
        const data = await response.json();
        setFields(data);
      } catch (error) {
        console.error('Error fetching fields:', error);
      }
    }

    fetchFields();
  }, [inputType]);

  const handleFieldSelect = (field: string) => {
    if (inputRef.current) {
      const cursorPosition = inputRef.current.selectionStart || 0;
      const currentValue = value?.template || '';
      const newValue = currentValue.slice(0, cursorPosition) + `{{ ${field} }}` + currentValue.slice(cursorPosition);
      onChange(newValue);
      setIsPopupOpen(false);

      // Set cursor position after the inserted field
      setTimeout(() => {
        const newCursorPosition = cursorPosition + `{{ ${field} }}`.length;
        inputRef.current?.setSelectionRange(newCursorPosition, newCursorPosition);
        inputRef.current?.focus();
      }, 0);
    }
  };

  const renderFieldOptions = () => {
    return fields.map((field) => (
      <button
        key={field}
        id={`field-option-${field.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}`}
        onClick={() => handleFieldSelect(field)}
        style={styles.fieldOption}
      >
        {formatFieldName(field)}
      </button>
    ));
  };

  const formatFieldName = (fieldName: string) => {
    return fieldName
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  return (
    <div style={styles.container}>
      <div style={styles.inputContainer}>
        <Input
          id={uniqueId}
          ref={inputRef}
          type="text"
          value={value.template ?? ''}
          onChange={(e) => onChange(e.target.value)}
          style={styles.input}
        />
        <button id="open-field-picker-button" onClick={() => setIsPopupOpen(true)} style={styles.pickerButton}>
          ⋮
        </button>
      </div>
      <Popup isOpen={isPopupOpen} onClose={() => setIsPopupOpen(false)} title="Select Input Field">
        <div style={styles.fieldOptionsContainer}>
          {renderFieldOptions()}
        </div>
      </Popup>
    </div>
  );
};

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '10px',
  },
  inputContainer: {
    display: 'flex',
    position: 'relative' as const,
    width: '100%',
  },
  input: {
    flex: 1,
    padding: '5px',
    paddingRight: '30px', // Make room for the picker button
    background: '#3a3a4c',
    color: '#ffffff',
    border: '1px solid #4a4a5e',
    borderRadius: '3px',
  },
  pickerButton: {
    position: 'absolute' as const,
    right: '2px',
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'none',
    border: 'none',
    color: '#00ffff',
    fontSize: '20px',
    cursor: 'pointer',
    padding: '0 5px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: 'calc(100% - 4px)',
  },
  fieldOptionsContainer: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '5px',
    maxHeight: '200px',
    overflowY: 'auto' as const,
  },
  fieldOption: {
    padding: '5px',
    background: '#3a3a4c',
    color: '#ffffff',
    border: '1px solid #4a4a5e',
    borderRadius: '3px',
    cursor: 'pointer',
    textAlign: 'left' as const,
  },
};

export default InputFieldSelector;
