// src/components/ComboBoxFieldSelector.tsx

import React, { useState, useEffect, useRef } from 'react';
import Popup from './Popup';
import { Template } from '../../services/flow/types/workflowTypes';
import { Input } from '@alga-psa/ui/components/Input';

interface ComboBoxFieldSelectorProps {
  value?: Template;
  onChange: (value: string) => void;
  options: { id: string; label: string }[];
  inputType: string;
  placeholder?: string;
}

const ComboBoxFieldSelector: React.FC<ComboBoxFieldSelectorProps> = ({
  value,
  onChange,
  options,
  inputType,
  placeholder = 'Select or enter a field reference',
}) => {
  const [isPopupOpen, setIsPopupOpen] = useState(false);
  const [fields, setFields] = useState<string[]>([]);
  const [selectedOption, setSelectedOption] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    const matchingOption = options.find(option => option.id === value?.template);
    if (matchingOption) {
      setSelectedOption(matchingOption.id);
    } else {
      setSelectedOption('');
    }
  }, [value, options]);

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedValue = e.target.value;
    setSelectedOption(selectedValue);
    onChange(selectedValue);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedOption('');
    onChange(e.target.value);
  };

  const handleFieldSelect = (field: string) => {
    const newValue = `{{ ${field} }}`;
    onChange(newValue);
    setSelectedOption('');
    setIsPopupOpen(false);

    if (inputRef.current) {
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(newValue.length, newValue.length);
      }, 0);
    }
  };

  const renderFieldOptions = () => {
    return fields.map((field) => (
      <button
        key={field}
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
      <div style={styles.comboBoxContainer}>
        <select
          value={selectedOption}
          onChange={handleSelectChange}
          style={styles.select}
        >
          <option value="">Custom Field Reference</option>
          {options.map(option => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <div style={styles.inputContainer}>
          <Input
            ref={inputRef}
            type="text"
            value={selectedOption ? selectedOption : value?.template || ''}
            onChange={handleInputChange}
            placeholder={placeholder}
            style={styles.input}
          />
          <button onClick={() => setIsPopupOpen(true)} style={styles.pickerButton}>
            ⋮
          </button>
        </div>
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
  comboBoxContainer: {
    display: 'flex',
    flexDirection: 'column' as const,
    border: '1px solid #4a4a5e',
    borderRadius: '5px',
    overflow: 'hidden',
  },
  select: {
    width: '100%',
    padding: '5px',
    background: '#3a3a4c',
    color: '#ffffff',
    border: 'none',
    borderBottom: '1px solid #4a4a5e',
  },
  inputContainer: {
    display: 'flex',
    position: 'relative' as const,
  },
  input: {
    flex: 1,
    padding: '5px',
    paddingRight: '30px',
    background: '#3a3a4c',
    color: '#ffffff',
    border: 'none',
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

export default ComboBoxFieldSelector;
