'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Input } from '../ui/Input';
import { ChevronDown, Search } from 'lucide-react';
import { IContact } from '../../interfaces/contact.interfaces';
import { ReflectionContainer } from '../../types/ui-reflection/ReflectionContainer';
import { useAutomationIdAndRegister } from 'server/src/types/ui-reflection/useAutomationIdAndRegister';
import { AutomationProps, FormFieldComponent } from 'server/src/types/ui-reflection/types';
import { withDataAutomationId } from 'server/src/types/ui-reflection/withDataAutomationId';

interface ContactPickerProps {
  id?: string;
  contacts: IContact[];
  value: string;
  onValueChange: (value: string) => void;
  companyId?: string;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  buttonWidth?: 'fit' | 'full';
  size?: 'sm' | 'lg';
  labelStyle?: 'bold' | 'medium' | 'normal' | 'none';
}

export const ContactPicker: React.FC<ContactPickerProps & AutomationProps> = ({
  id = 'contact-picker',
  contacts,
  value,
  onValueChange,
  companyId,
  label = 'Contact',
  placeholder = 'Select Contact',
  disabled = false,
  className = '',
  buttonWidth = 'full',
  "data-automation-type": dataAutomationType = 'picker',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const dropdownContentRef = useRef<HTMLDivElement>(null);
  const [dropdownPosition, setDropdownPosition] = useState<'bottom' | 'top'>('bottom');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedContact = useMemo(() =>
    contacts.find((c) => c.contact_name_id === value),
    [contacts, value]
  );


  const filteredContacts = useMemo(() => {
    let results = contacts;

    if (searchTerm) {
      const lowerSearchTerm = searchTerm.toLowerCase();
      results = results.filter(contact =>
        contact.full_name.toLowerCase().includes(lowerSearchTerm) ||
        contact.email.toLowerCase().includes(lowerSearchTerm)
      );
    }

    if (companyId) {
      results = results.filter(contact => contact.company_id === companyId);
    }

    return results;
  }, [contacts, searchTerm, companyId]); // Removed internalFilterState from dependencies

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        buttonRef.current &&
        !buttonRef.current.contains(target) &&
        dropdownContentRef.current &&
        !dropdownContentRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 10);
    }
  }, [isOpen]);

  const updateDropdownPosition = () => {
    if (!buttonRef.current || !dropdownRef.current) return;

    const buttonRect = buttonRef.current.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const spaceBelow = viewportHeight - buttonRect.bottom;
    const spaceAbove = buttonRect.top;

    const baseHeight = 40 + 40 + 16;
    const itemsHeight = Math.min(filteredContacts.length, 5) * 36;
    const estimatedDropdownHeight = baseHeight + itemsHeight + 10;

    if (spaceBelow < estimatedDropdownHeight && spaceAbove > spaceBelow && spaceAbove > 150) {
      setDropdownPosition('top');
    } else {
      setDropdownPosition('bottom');
    }
  };

  useEffect(() => {
    if (isOpen) {
      updateDropdownPosition();

      window.addEventListener('scroll', updateDropdownPosition, true);
      window.addEventListener('resize', updateDropdownPosition);

      return () => {
        window.removeEventListener('scroll', updateDropdownPosition, true);
        window.removeEventListener('resize', updateDropdownPosition);
      };
    }
  }, [isOpen, filteredContacts.length]);

  const toggleDropdown = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!disabled) {
      const closing = isOpen;
      setIsOpen(!isOpen);
      if (closing) {
        setSearchTerm('');
      }
    }
  };

  const handleSelect = (contactId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onValueChange(contactId);
    setIsOpen(false);
  };


  const mappedOptions = useMemo(() => contacts.map((opt): { value: string; label: string } => ({
    value: opt.contact_name_id,
    label: `${opt.full_name} (${opt.email})`
  })), [contacts]);

  const { automationIdProps: contactPickerProps, updateMetadata } = useAutomationIdAndRegister<FormFieldComponent>({
    type: 'formField',
    fieldType: 'select',
    id: `contact-picker-${label.replace(/\s+/g, '-').toLowerCase()}`,
    value: value || '',
    disabled: disabled,
    required: false,
    options: mappedOptions
  });

  const prevMetadataRef = useRef<{
    value: string;
    label: string;
    disabled: boolean;
    required: boolean;
    options: { value: string; label: string }[];
  } | null>(null);

  useEffect(() => {
    if (!updateMetadata) return;

    const newMetadata = {
      value: value || '',
      label: selectedContact?.full_name || placeholder,
      disabled: disabled,
      required: false,
      options: mappedOptions
    };

    const areOptionsEqual = (prev: { value: string; label: string }[] | undefined,
      curr: { value: string; label: string }[]) => {
      if (!prev) return false;
      if (prev.length !== curr.length) return false;

      const prevValues = new Set(prev.map((o): string => `${o.value}:${o.label}`));
      const currValues = new Set(curr.map((o): string => `${o.value}:${o.label}`));

      for (const value of prevValues) {
        if (!currValues.has(value)) return false;
      }
      return true;
    };

    const isMetadataEqual = () => {
      if (!prevMetadataRef.current) return false;

      const prev = prevMetadataRef.current;

      return prev.value === newMetadata.value &&
        prev.label === newMetadata.label &&
        prev.disabled === newMetadata.disabled &&
        prev.required === newMetadata.required &&
        areOptionsEqual(prev.options, newMetadata.options);
    };

    if (!isMetadataEqual()) {
      updateMetadata(newMetadata);
      prevMetadataRef.current = newMetadata;
    }
  }, [value, contacts, updateMetadata, selectedContact, placeholder, disabled]);

  return (
    <ReflectionContainer id={`contact-picker-container-${label.replace(/\s+/g, '-').toLowerCase()}`} label={label || "Contact Picker"}>
      <div className="mb-4">
        <div
          className={`${className} ${buttonWidth === 'fit' ? 'inline-flex' : 'w-full'} relative`}
          ref={dropdownRef}
          {...withDataAutomationId({ id: `contact-picker-${label.replace(/\s+/g, '-').toLowerCase()}` })}
          data-automation-type={dataAutomationType}
        >
          <button
            ref={buttonRef}
            type="button"
            onClick={toggleDropdown}
            className={`
              inline-flex items-center justify-between
              border border-gray-200 rounded-lg p-2
              bg-white cursor-pointer min-h-[38px]
              hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent
              text-sm ${buttonWidth === 'full' ? 'w-full' : ''} ${disabled ? 'bg-gray-100 cursor-not-allowed' : 'bg-white cursor-pointer'}
            `}
          >
            <span className="flex-1 text-left">
              {selectedContact ? selectedContact.full_name : placeholder}
            </span>
            <div className="flex items-center">
              <ChevronDown className={`h-4 w-4 ${disabled ? 'text-gray-400' : ''}`} />
            </div>
          </button>

          {isOpen && (
            <div
              ref={dropdownContentRef}
              className="absolute z-[999] overflow-hidden bg-white rounded-md shadow-lg border border-gray-200"
              style={{
                width: buttonRef.current ? Math.max(buttonRef.current.offsetWidth, 250) + 'px' : '250px',
                ...(dropdownPosition === 'top'
                  ? { bottom: '100%', marginBottom: '4px' }
                  : { top: '100%', marginTop: '4px' }),
                left: 0,
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {/* Search Input Container */}
              <div className="p-2 border-b border-gray-200">
                <div className="relative">
                  <Input
                    ref={searchInputRef}
                    id={`contact-picker-search-${label.replace(/\s+/g, '-').toLowerCase()}`}
                    placeholder="Search contacts..."
                    value={searchTerm}
                    onChange={(e) => {
                      e.stopPropagation();
                      setSearchTerm(e.target.value);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full px-3 py-2 pl-9 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    autoComplete="off"
                  />
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-gray-400" />
                </div>
              </div>
              <div
                className="overflow-y-auto"
                style={{ maxHeight: '200px' }}
                role="listbox"
                aria-label="Contacts"
              >
                {/* "None" Option */}
                <div
                  onClick={(e) => handleSelect('', e)}
                  className="relative flex items-center px-3 py-2 text-sm rounded text-gray-700 cursor-pointer hover:bg-gray-100 focus:bg-gray-100 focus:outline-none"
                  role="option"
                  aria-selected={value === ''}
                  tabIndex={0}
                  onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => { if (e.key === 'Enter' || e.key === ' ') { onValueChange(''); setIsOpen(false); } }} // Handle keyboard selection
                >
                  None
                </div>

                {/* Contact List */}
                {isOpen && filteredContacts.length === 0 ? (
                  <div className="px-4 py-2 text-gray-500">No contacts found</div>
                ) : (
                  filteredContacts.map((contact) => (
                    <div
                      key={contact.contact_name_id}
                      onClick={(e) => handleSelect(contact.contact_name_id, e)}
                      className={`
                        relative flex items-center justify-between px-3 py-2 text-sm rounded cursor-pointer
                        hover:bg-gray-100 focus:bg-gray-100 focus:outline-none
                        ${contact.is_inactive
                          ? 'text-gray-400 bg-gray-50'
                          : contact.contact_name_id === value
                            ? 'bg-gray-100 font-medium text-gray-900'
                            : 'text-gray-900'
                        }
                      `}
                      role="option"
                      aria-selected={contact.contact_name_id === value}
                      tabIndex={0} // Make it focusable
                      onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => { if (e.key === 'Enter' || e.key === ' ') { onValueChange(contact.contact_name_id); setIsOpen(false); } }} // Handle keyboard selection
                    >
                      <div>
                        <div>{contact.full_name}</div>
                        <div className={`text-xs ${contact.is_inactive ? 'text-gray-400' : 'text-gray-500'}`}>{contact.email}</div>
                      </div>
                      {contact.is_inactive && <span className="text-xs text-gray-400">(Inactive)</span>}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </ReflectionContainer>
  );
};
