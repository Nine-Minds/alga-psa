'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search, X } from 'lucide-react';
import ContactAvatar from './ContactAvatar';
import type { IContact } from '@alga-psa/types';
import { Input } from './Input';
import { Checkbox } from './Checkbox';
import { Button } from './Button';
import type { AutomationProps } from '../ui-reflection/types';

interface MultiContactPickerProps {
  id?: string;
  label?: string;
  values: string[];
  onValuesChange: (values: string[]) => void;
  contacts: IContact[];
  clientId?: string;
  placeholder?: string;
  disabled?: boolean;
}

const MultiContactPicker = ({
  id,
  label,
  values = [],
  onValuesChange,
  contacts,
  clientId,
  placeholder = 'Select contacts...',
  disabled = false,
  'data-automation-id': dataAutomationId,
}: MultiContactPickerProps & AutomationProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [dropdownPosition, setDropdownPosition] = useState<'bottom' | 'top'>('bottom');
  const [dropdownCoords, setDropdownCoords] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 250 });
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const scopedContacts = useMemo(
    () => (clientId ? contacts.filter((contact) => contact.client_id === clientId) : contacts),
    [contacts, clientId],
  );

  const filteredContacts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const base = query
      ? scopedContacts.filter((contact) =>
          contact.full_name.toLowerCase().includes(query) ||
          (contact.email ?? '').toLowerCase().includes(query))
      : scopedContacts;
    return [...base].sort((a, b) => a.full_name.localeCompare(b.full_name));
  }, [scopedContacts, searchQuery]);

  const selectedContacts = useMemo(
    () => contacts.filter((contact) => values.includes(contact.contact_name_id)),
    [contacts, values],
  );

  // Click outside
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!dropdownRef.current?.contains(target) && !buttonRef.current?.contains(target)) {
        setIsOpen(false);
        setSearchQuery('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside, true);
    return () => document.removeEventListener('mousedown', handleClickOutside, true);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      setTimeout(() => searchInputRef.current?.focus(), 10);
    }
  }, [isOpen]);

  const updateDropdownPosition = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const estimatedHeight = 350;
    const width = Math.max(rect.width, 250);
    if (spaceBelow < estimatedHeight && spaceAbove > spaceBelow) {
      setDropdownPosition('top');
      setDropdownCoords({ top: rect.top - 2, left: rect.left, width });
    } else {
      setDropdownPosition('bottom');
      setDropdownCoords({ top: rect.bottom + 2, left: rect.left, width });
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    updateDropdownPosition();
    window.addEventListener('scroll', updateDropdownPosition, true);
    window.addEventListener('resize', updateDropdownPosition);
    return () => {
      window.removeEventListener('scroll', updateDropdownPosition, true);
      window.removeEventListener('resize', updateDropdownPosition);
    };
  }, [isOpen, updateDropdownPosition]);

  const toggleDropdown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) {
      setIsOpen((prev) => !prev);
      setSearchQuery('');
    }
  };

  const handleToggle = (contactNameId: string) => {
    if (values.includes(contactNameId)) {
      onValuesChange(values.filter((existing) => existing !== contactNameId));
    } else {
      onValuesChange([...values, contactNameId]);
    }
  };

  const removeContact = (contactNameId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    onValuesChange(values.filter((existing) => existing !== contactNameId));
  };

  const renderTriggerContent = () => {
    if (selectedContacts.length === 0) {
      return <span className="text-gray-500">{placeholder}</span>;
    }
    return (
      <div className="flex flex-1 flex-wrap items-center gap-2">
        {selectedContacts.map((contact) => (
          <div key={contact.contact_name_id} className="flex items-center gap-1 rounded-full bg-gray-100 py-1 pl-1 pr-2 dark:bg-gray-800">
            <ContactAvatar
              contactId={contact.contact_name_id}
              contactName={contact.full_name}
              avatarUrl={contact.avatarUrl ?? null}
              size="xs"
            />
            <span className="text-sm">{contact.full_name}</span>
            <div
              role="button"
              tabIndex={0}
              onClick={(e) => removeContact(contact.contact_name_id, e)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  e.preventDefault();
                  removeContact(contact.contact_name_id);
                }
              }}
              className="ml-1 cursor-pointer rounded-full p-0.5 hover:bg-gray-200"
            >
              <X className="h-3 w-3" />
            </div>
          </div>
        ))}
      </div>
    );
  };

  const dropdownContent = (
    <div
      ref={dropdownRef}
      className="fixed z-50 pointer-events-auto"
      style={{
        top: dropdownPosition === 'top' ? 'auto' : `${dropdownCoords.top}px`,
        bottom: dropdownPosition === 'top' ? `${window.innerHeight - dropdownCoords.top}px` : 'auto',
        left: `${dropdownCoords.left}px`,
        width: `${dropdownCoords.width}px`,
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="w-full overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg dark:border-[rgb(var(--color-border-200))] dark:bg-[rgb(var(--color-card))]">
        <div className="border-b border-gray-200 p-2 dark:border-[rgb(var(--color-border-200))]">
          <div className="relative">
            <Input
              ref={searchInputRef}
              type="text"
              placeholder="Search contacts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-md border border-gray-200 px-3 py-2 pl-9 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[rgb(var(--color-primary-500))]"
              autoComplete="off"
            />
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-gray-400" />
          </div>
        </div>

        <div className="overflow-y-auto p-1" style={{ maxHeight: '320px', overscrollBehavior: 'contain' }}>
          {filteredContacts.length === 0 ? (
            <div className="px-3 py-2 text-sm text-gray-500">
              {searchQuery ? 'No results found' : 'No contacts available'}
            </div>
          ) : (
            filteredContacts.map((contact) => {
              const isSelected = values.includes(contact.contact_name_id);
              const noEmail = !contact.email?.trim();
              return (
                <div
                  key={contact.contact_name_id}
                  className={`relative flex items-center rounded px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-[rgb(var(--color-border-100))] ${isSelected ? 'bg-gray-50 dark:bg-[rgb(var(--color-border-50))]' : ''} ${noEmail ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                  onClick={() => { if (!noEmail) handleToggle(contact.contact_name_id); }}
                >
                  <div onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      id={`contact-${contact.contact_name_id}`}
                      checked={isSelected}
                      disabled={noEmail}
                      onChange={() => handleToggle(contact.contact_name_id)}
                      className="mr-3"
                    />
                  </div>
                  <ContactAvatar
                    contactId={contact.contact_name_id}
                    contactName={contact.full_name}
                    avatarUrl={contact.avatarUrl ?? null}
                    size="sm"
                  />
                  <span className="ml-2 truncate">{contact.full_name}</span>
                  {noEmail && <span className="ml-auto text-xs text-gray-400">no email</span>}
                </div>
              );
            })
          )}
        </div>

        {values.length > 0 && (
          <div className="border-t border-gray-200 p-2 dark:border-[rgb(var(--color-border-200))]">
            <Button
              id={`${id || 'multi-contact-picker'}-clear-all`}
              variant="ghost"
              onClick={() => onValuesChange([])}
              className="w-full py-1 text-sm text-gray-600 hover:text-gray-900"
            >
              Clear all
            </Button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="relative w-full" ref={containerRef}>
      {label && <h5 className="mb-1 font-bold">{label}</h5>}
      <Button
        ref={buttonRef}
        id={id || 'multi-contact-picker'}
        data-automation-id={dataAutomationId}
        type="button"
        variant="outline"
        onClick={toggleDropdown}
        disabled={disabled}
        className="inline-flex h-auto min-h-[38px] w-full items-start justify-between py-2"
      >
        {renderTriggerContent()}
        <ChevronDown className="ml-2 h-4 w-4 flex-shrink-0 text-gray-500" />
      </Button>

      {isOpen && typeof document !== 'undefined' && createPortal(dropdownContent, document.body)}
    </div>
  );
};

export default MultiContactPicker;
