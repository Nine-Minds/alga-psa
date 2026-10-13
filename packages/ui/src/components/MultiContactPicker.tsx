'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import ContactAvatar from './ContactAvatar';
import type { IContact } from '@alga-psa/types';
import { Input } from './Input';
import { Checkbox } from './Checkbox';
import { Button } from './Button';
import { Popover, PopoverAnchor, PopoverContent } from './Popover';
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
  const containerRef = useRef<HTMLDivElement>(null);
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

  // An open list owns Escape. Radix dialogs listen for Escape on `document` in
  // the capture phase and the dialog's focus trap can keep focus on the trigger
  // (outside this portal), so the key is claimed on `window`, which runs first:
  // the first Escape closes only the list, never the dialog behind it.
  // LEVERAGE: pattern popup-owns-escape — AsyncSearchableSelect/editor popups each re-solve "popup beats dialog on Escape"
  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      closeDropdown();
      buttonRef.current?.focus();
    };
    window.addEventListener('keydown', handleEscape, true);
    return () => window.removeEventListener('keydown', handleEscape, true);
  }, [isOpen]);

  const closeDropdown = () => {
    setIsOpen(false);
    setSearchQuery('');
  };

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

  // `modal` is deliberate: when this picker sits inside a Radix Dialog, the
  // dialog's react-remove-scroll swallows wheel events on anything portaled
  // outside it. A modal Popover installs its own scroll-lock scope around the
  // content so the list scrolls. The trigger is inert while open, so an outside
  // pointerdown on it dismisses (toggle-closes) via Radix.
  const dropdownContent = (
    <PopoverContent
      align="start"
      sideOffset={2}
      collisionPadding={8}
      avoidCollisions
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        searchInputRef.current?.focus();
      }}
      onCloseAutoFocus={(e) => {
        e.preventDefault();
      }}
      onClick={(e) => e.stopPropagation()}
      className="flex w-[var(--radix-popover-trigger-width)] min-w-[250px] flex-col overflow-hidden p-0"
      style={{ maxHeight: 'min(420px, var(--radix-popover-content-available-height))' }}
    >
      <div className="shrink-0 border-b border-gray-200 p-2 dark:border-[rgb(var(--color-border-200))]">
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

      <div
        role="listbox"
        aria-multiselectable="true"
        aria-label={label ?? placeholder}
        className="min-h-0 flex-1 overflow-y-auto p-1"
        style={{ overscrollBehavior: 'contain' }}
      >
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
                className={`relative flex items-center rounded px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-[rgb(var(--color-border-100))] ${isSelected ? 'bg-gray-50 dark:bg-[rgb(var(--color-border-50))]' : ''} ${noEmail ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                role="option"
                aria-selected={isSelected}
                aria-disabled={noEmail}
                onClick={() => { if (!noEmail) handleToggle(contact.contact_name_id); }}
              >
                <div onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    id={`contact-${contact.contact_name_id}`}
                    checked={isSelected}
                    disabled={noEmail}
                    onChange={() => handleToggle(contact.contact_name_id)}
                    className="mr-2"
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
        <div className="shrink-0 border-t border-gray-200 p-2 dark:border-[rgb(var(--color-border-200))]">
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
    </PopoverContent>
  );

  return (
    <div className="relative w-full" ref={containerRef}>
      {label && <h5 className="mb-1 font-bold">{label}</h5>}
      <Popover modal open={isOpen} onOpenChange={(open) => { if (!open) closeDropdown(); }}>
      <PopoverAnchor asChild>
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
      </PopoverAnchor>
      {dropdownContent}
      </Popover>
    </div>
  );
};

export default MultiContactPicker;
