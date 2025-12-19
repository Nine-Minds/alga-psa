'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Input } from './Input';
import { ChevronDown, Search } from 'lucide-react';
import ContactAvatar from 'server/src/components/ui/ContactAvatar';
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
  clientId?: string;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  buttonWidth?: 'fit' | 'full';
  size?: 'sm' | 'lg';
  labelStyle?: 'bold' | 'medium' | 'normal' | 'none';
  modal?: boolean;
}

export const ContactPicker: React.FC<ContactPickerProps & AutomationProps> = ({
  id = 'contact-picker',
  contacts,
  value,
  onValueChange,
  clientId,
  label = 'Contact',
  placeholder = 'Select Contact',
  disabled = false,
  className = '',
  buttonWidth = 'full',
  modal = true,
  "data-automation-type": dataAutomationType = 'picker',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const dropdownContentRef = useRef<HTMLDivElement>(null);
  const [dropdownPosition, setDropdownPosition] = useState<'bottom' | 'top'>('bottom');
  const [dropdownCoords, setDropdownCoords] = useState({ top: 0, left: 0, width: 0 });
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

    if (clientId) {
      results = results.filter(contact => contact.client_id === clientId);
    }

    return results;
  }, [contacts, searchTerm, clientId]); // Removed internalFilterState from dependencies

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
    if (!buttonRef.current) return;

    const buttonRect = buttonRef.current.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const spaceBelow = viewportHeight - buttonRect.bottom;
    const spaceAbove = buttonRect.top;

    const baseHeight = 40 + 40 + 16;
    const itemsHeight = Math.min(filteredContacts.length, 5) * 36;
    const estimatedDropdownHeight = baseHeight + itemsHeight + 10;

    // Determine vertical position
    const showAbove = spaceBelow < estimatedDropdownHeight && spaceAbove > spaceBelow && spaceAbove > 150;
    setDropdownPosition(showAbove ? 'top' : 'bottom');

    // Calculate dropdown width
    const dropdownWidth = Math.max(buttonRect.width, 250);

    // Calculate coordinates
    setDropdownCoords({
      top: showAbove ? buttonRect.top - estimatedDropdownHeight - 4 : buttonRect.bottom + 4,
      left: buttonRect.left,
      width: dropdownWidth
    });
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
      <div className="">
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
              rounded-lg p-2 h-10
              text-sm font-medium transition-colors
              bg-white cursor-pointer
              border border-[rgb(var(--color-border-400))] text-[rgb(var(--color-text-700))]
              hover:bg-[rgb(var(--color-primary-50))] hover:text-[rgb(var(--color-primary-700))]
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
              disabled:pointer-events-none
              ${buttonWidth === 'full' ? 'w-full' : ''}
              ${disabled ? 'cursor-not-allowed' : ''}
            `}
          >
            <div className="flex items-center gap-2 flex-1">
              {selectedContact && (
                <ContactAvatar
                  contactId={selectedContact.contact_name_id}
                  contactName={selectedContact.full_name}
                  avatarUrl={selectedContact.avatarUrl || null}
                  size="xs"
                />
              )}
              <span className={!selectedContact ? 'text-gray-400' : ''}>{selectedContact ? selectedContact.full_name : placeholder}</span>
            </div>
            <div className="flex items-center">
              <ChevronDown className={`h-4 w-4 ${disabled ? 'text-gray-400' : ''}`} />
            </div>
          </button>

          {isOpen && typeof document !== 'undefined' && createPortal(
            <div
              ref={dropdownContentRef}
              className="fixed z-[9999] overflow-hidden bg-white rounded-md shadow-lg border border-gray-200 pointer-events-auto"
              style={{
                top: `${dropdownCoords.top}px`,
                left: `${dropdownCoords.left}px`,
                width: `${dropdownCoords.width}px`,
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
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
                    className="w-full px-3 py-2 pl-9 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[rgb(var(--color-primary-500))] focus:border-transparent"
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
                {filteredContacts.length === 0 ? (
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
                      <div className="flex items-center gap-2 flex-1">
                         <ContactAvatar
                           contactId={contact.contact_name_id}
                           contactName={contact.full_name}
                           avatarUrl={contact.avatarUrl || null}
                           size="xs"
                         />
                         <div className="flex-1">
                           <div>{contact.full_name}</div>
                           <div className={`text-xs ${contact.is_inactive ? 'text-gray-400' : 'text-gray-500'}`}>{contact.email}</div>
                         </div>
                       </div>
                      {contact.is_inactive && <span className="text-xs text-gray-400">(Inactive)</span>}
                    </div>
                  ))
                )}
              </div>
            </div>,
            document.body
          )}
        </div>
      </div>
    </ReflectionContainer>
  );
};
