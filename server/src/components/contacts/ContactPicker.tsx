'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Input } from '../ui/Input';
import CustomSelect from '../ui/CustomSelect';
import { ChevronDownIcon, Cross2Icon } from '@radix-ui/react-icons';
import { IContact } from '../../interfaces/contact.interfaces';
import { ReflectionContainer } from '../../types/ui-reflection/ReflectionContainer';
import { useAutomationIdAndRegister } from '@/types/ui-reflection/useAutomationIdAndRegister';
import { AutomationProps, FormFieldComponent } from '@/types/ui-reflection/types';
import { withDataAutomationId } from '@/types/ui-reflection/withDataAutomationId';

interface ContactPickerProps {
  id?: string;
  contacts?: IContact[];
  onSelect: (contactId: string) => void;
  selectedContactId: string | null;
  companyId?: string;
  filterState: 'all' | 'active' | 'inactive';
  onFilterStateChange: (state: 'all' | 'active' | 'inactive') => void;
  fitContent?: boolean;
  label?: string;
}

export const ContactPicker: React.FC<ContactPickerProps & AutomationProps> = ({
  id = 'contact-picker',
  contacts = [],
  onSelect,
  selectedContactId,
  companyId,
  filterState,
  onFilterStateChange,
  fitContent = false,
  label = 'Contact',
  "data-automation-type": dataAutomationType = 'picker',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedContact = useMemo(() =>
    contacts.find((c) => c.contact_name_id === selectedContactId),
    [contacts, selectedContactId]
  );

  const filteredContacts = useMemo(() => {
    return contacts.filter(contact => {
      const matchesSearch = (
        contact.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        contact.email.toLowerCase().includes(searchTerm.toLowerCase())
      );
      const matchesState =
        filterState === 'all' ? true :
          filterState === 'active' ? !contact.is_inactive :
            filterState === 'inactive' ? contact.is_inactive :
              true;
      const matchesCompany = companyId ? contact.company_id === companyId : true;

      return matchesSearch && matchesState && matchesCompany;
    });
  }, [contacts, filterState, searchTerm, companyId]);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!dropdownRef.current?.contains(target) && target.nodeName !== 'SELECT') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleSelect = (contactId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(contactId);
    setIsOpen(false);
  };

  const handleFilterStateChange = (value: string) => {
    onFilterStateChange(value as 'all' | 'active' | 'inactive');
  };

  const opts = useMemo(() => [
    { value: 'active', label: 'Active Contacts' },
    { value: 'inactive', label: 'Inactive Contacts' },
    { value: 'all', label: 'All Contacts' },
  ], []);

  const mappedOptions = useMemo(() => contacts.map((opt): { value: string; label: string } => ({
    value: opt.contact_name_id,
    label: `${opt.full_name} (${opt.email})`
  })), [contacts]);

  const { automationIdProps: contactPickerProps, updateMetadata } = useAutomationIdAndRegister<FormFieldComponent>({
    type: 'formField',
    fieldType: 'select',
    id: `${id}-picker`,
    value: selectedContactId || '',
    disabled: false,
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
      value: selectedContactId || '',
      label: selectedContact?.full_name || '',
      disabled: false,
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
  }, [selectedContactId, contacts, updateMetadata]);

  return (
    <ReflectionContainer id={`${id}`} label="Contact Picker">
      <div className="mb-4">
        {label && (
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {label}
          </label>
        )}
        <div
          className={`${fitContent ? 'inline-flex' : 'w-full'} relative`}
          ref={dropdownRef}
          {...withDataAutomationId({ id: `${id}-picker` })}
          data-automation-type={dataAutomationType}
        >
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className={`
              inline-flex items-center justify-between
              border border-gray-200 rounded-lg p-2
              bg-white cursor-pointer min-h-[38px]
              hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent
              text-sm w-full
            `}
          >
            <span className="flex-1 text-left">
              {selectedContact ? (
                <span>
                  {selectedContact.full_name}
                  <span className="text-gray-500 ml-2">({selectedContact.email})</span>
                </span>
              ) : (
                'Select Contact'
              )}
            </span>
            <div className="flex items-center gap-2">
              {selectedContact && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect('');
                  }}
                  className="p-1 hover:bg-gray-100 rounded-full"
                >
                  <Cross2Icon className="h-3 w-3 text-gray-500" />
                </button>
              )}
              <ChevronDownIcon className="h-4 w-4" />
            </div>
          </button>

          {isOpen && (
            <div
              className={`
                absolute z-[200] w-full min-w-max
                overflow-hidden bg-white rounded-md shadow-lg
                border border-gray-200 mt-1
              `}
              style={{
                top: 'calc(100% + 4px)',
                left: 0
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="p-2 space-y-2 bg-white border-b border-gray-100">
                <CustomSelect
                  value={filterState}
                  onValueChange={handleFilterStateChange}
                  options={opts}
                  placeholder="Filter by status"
                />
                <Input
                  id={`${id}-search`}
                  placeholder="Search contacts..."
                  value={searchTerm}
                  onChange={(e) => {
                    e.stopPropagation();
                    setSearchTerm(e.target.value);
                  }}
                  className="mb-0"
                />
              </div>
              <div
                className="max-h-60 overflow-y-auto"
                role="listbox"
                aria-label="Contacts"
              >
                {isOpen && filteredContacts.length === 0 ? (
                  <div className="px-4 py-2 text-gray-500">No contacts found</div>
                ) : (
                  filteredContacts.map((contact): JSX.Element => (
                    <button
                      key={contact.contact_name_id}
                      type="button"
                      onClick={(e) => handleSelect(contact.contact_name_id, e)}
                      className={`
                        w-full text-left px-3 py-2 text-sm
                        hover:bg-gray-100 focus:bg-gray-100 focus:outline-none
                        ${contact.contact_name_id === selectedContactId ? 'bg-gray-100' : ''}
                      `}
                      role="option"
                      aria-selected={contact.contact_name_id === selectedContactId}
                    >
                      <div>
                        <div>{contact.full_name}</div>
                        <div className="text-sm text-gray-500">{contact.email}</div>
                      </div>
                      {contact.is_inactive && <span className="ml-2 text-gray-500">(Inactive)</span>}
                    </button>
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
