// src/components/TextAreaFieldSelector.tsx

import React, { useState, useEffect, useRef } from 'react';
import Popup from './Popup';
import { Template } from '../../generated/workflow';

interface TextAreaFieldSelectorProps {
  value?: Template;
  onChange: (value: string) => void;
  inputType: string;
  rows?: number;
}

const TextAreaFieldSelector: React.FC<TextAreaFieldSelectorProps> = ({ value, onChange, inputType, rows = 4 }) => {
  const [isPopupOpen, setIsPopupOpen] = useState(false);
  const [fields, setFields] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
    if (textareaRef.current) {
      const cursorPosition = textareaRef.current.selectionStart || 0;
      const currentValue = value?.template || '';
      const newValue = currentValue.slice(0, cursorPosition) + `{{ ${field} }}` + currentValue.slice(cursorPosition);
      onChange(newValue);
      setIsPopupOpen(false);

      // Set cursor position after the inserted field
      setTimeout(() => {
        const newCursorPosition = cursorPosition + `{{ ${field} }}`.length;
        textareaRef.current?.setSelectionRange(newCursorPosition, newCursorPosition);
        textareaRef.current?.focus();
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
      <div style={styles.textareaContainer}>
        <textarea 
          ref={textareaRef}
          value={value?.template ?? ''} 
          onChange={(e) => onChange(e.target.value)} 
          style={styles.textarea}
          rows={rows}
        />
        <button onClick={() => setIsPopupOpen(true)} style={styles.pickerButton}>
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
  textareaContainer: {
    display: 'flex',
    position: 'relative' as const,
    width: '100%',
  },
  textarea: {
    flex: 1,
    padding: '5px',
    paddingRight: '30px',
    background: '#3a3a4c',
    color: '#ffffff',
    border: '1px solid #4a4a5e',
    borderRadius: '3px',
    resize: 'vertical' as const,
    minHeight: '80px',
  },
  pickerButton: {
    position: 'absolute' as const,
    right: '2px',
    top: '2px',
    background: 'none',
    border: 'none',
    color: '#00ffff',
    fontSize: '20px',
    cursor: 'pointer',
    padding: '0 5px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '30px',
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

export default TextAreaFieldSelector;
