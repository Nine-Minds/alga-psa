// src/components/Picker.tsx
'use client';
import React, { useState, useRef, useEffect } from 'react';
import { PickerProps, PickerOption } from '../../services/flow/types/nodes';
import styles from './Picker.module.css';
import { Input } from '@alga-psa/ui/components/Input';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

const Picker: React.FC<PickerProps> = ({ label, value, options, onChange }) => {
  const { t } = useTranslation('msp/workflows');
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [wrapperRef]);

  const filteredOptions = options.filter(option =>
    option.label.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div ref={wrapperRef} className={styles.pickerWrapper}>
      <label className={styles.pickerLabel}>{label}</label>
      <div
        className={styles.pickerValue}
        onClick={() => setIsOpen(!isOpen)}
      >
        {value || 'Select...'}
      </div>
      {isOpen && (
        <div className={styles.pickerDropdown}>
          <Input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={t('flow.picker.searchPlaceholder')}
            className={styles.pickerSearch}
          />
          {filteredOptions.map((option) => (
            <div
              key={option.id}
              className={styles.pickerOption}
              onClick={() => {
                onChange(option.id);
                setIsOpen(false);
              }}
            >
              {option.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Picker;
