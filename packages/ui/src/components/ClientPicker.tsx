'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import type { IClient } from '@alga-psa/types';

import { Input } from './Input';
import CustomSelect from './CustomSelect';
import { Button } from './Button';
import ClientAvatar from './ClientAvatar';

import { ReflectionContainer } from '../ui-reflection/ReflectionContainer';
import { useAutomationIdAndRegister } from '../ui-reflection/useAutomationIdAndRegister';
import type { AutomationProps, FormFieldComponent, ButtonComponent } from '../ui-reflection/types';
import { CommonActions } from '../ui-reflection/actionBuilders';

interface ClientPickerProps {
  id?: string;
  clients?: IClient[];
  onSelect: (clientId: string | null) => void;
  selectedClientId: string | null;
  filterState: 'all' | 'active' | 'inactive';
  onFilterStateChange: (state: 'all' | 'active' | 'inactive') => void;
  clientTypeFilter: 'all' | 'company' | 'individual';
  onClientTypeFilterChange: (type: 'all' | 'company' | 'individual') => void;
  fitContent?: boolean;
  className?: string;
  placeholder?: string;
  modal?: boolean;
}

interface OptionButtonProps {
  id: string;
  label: string;
  onClick: (e: React.MouseEvent) => void;
  className?: string;
  children: React.ReactNode;
}

const OptionButton: React.FC<OptionButtonProps> = ({ id, label, onClick, className, children }) => {
  const { automationIdProps } = useAutomationIdAndRegister<ButtonComponent>({
    type: 'button',
    id,
    label,
  });

  return (
    <div {...automationIdProps} data-automation-type="button" className={className} onClick={onClick}>
      {children}
    </div>
  );
};

export const ClientPicker: React.FC<ClientPickerProps & AutomationProps> = ({
  id = 'client-picker',
  clients = [],
  onSelect,
  selectedClientId,
  filterState,
  onFilterStateChange,
  clientTypeFilter,
  onClientTypeFilterChange,
  fitContent = false,
  className = '',
  placeholder = 'Select Client',
  modal = true,
  'data-automation-type': dataAutomationType = 'picker',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownCoords, setDropdownCoords] = useState({ top: 0, left: 0, width: 0 });

  const selectedClient = useMemo(
    () => clients.find((c) => c.client_id === selectedClientId),
    [clients, selectedClientId]
  );

  const filteredClients = useMemo(() => {
    return clients
      .filter((client) => {
        const matchesSearch = client.client_name.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesState =
          filterState === 'all'
            ? true
            : filterState === 'active'
              ? !client.is_inactive
              : filterState === 'inactive'
                ? client.is_inactive
                : true;
        const matchesClientType =
          clientTypeFilter === 'all'
            ? true
            : clientTypeFilter === 'company'
              ? client.client_type === 'company'
              : clientTypeFilter === 'individual'
                ? client.client_type === 'individual'
                : true;

        return matchesSearch && matchesState && matchesClientType;
      })
      .sort((a, b) => a.client_name.localeCompare(b.client_name));
  }, [clients, filterState, clientTypeFilter, searchTerm]);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      const isInsideDropdown = dropdownRef.current?.contains(target);
      const isInsideButton = triggerRef.current?.contains(target);
      const isInsideRadixSelect =
        target.closest('[data-radix-select-content]') !== null ||
        target.closest('[data-radix-popper-content-wrapper]') !== null;

      if (!isInsideDropdown && !isInsideButton && !isInsideRadixSelect) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true);
    };
  }, [isOpen]);

  const updateDropdownPosition = useCallback(() => {
    if (!triggerRef.current) return;

    const buttonRect = triggerRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const margin = 16;

    const dropdownWidth = Math.min(400, Math.max(buttonRect.width, 250));

    const spaceOnRight = viewportWidth - buttonRect.right;
    const spaceOnLeft = buttonRect.left;

    let left = buttonRect.left;

    if (buttonRect.left + dropdownWidth > viewportWidth - margin) {
      if (spaceOnLeft > spaceOnRight) {
        left = Math.max(margin, buttonRect.right - dropdownWidth);
      } else {
        left = Math.max(margin, viewportWidth - dropdownWidth - margin);
      }
    }

    setDropdownCoords({
      top: buttonRect.bottom + 4,
      left,
      width: dropdownWidth,
    });
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

  const handleSelect = (clientId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (clientId !== selectedClientId) {
      onSelect(clientId);
    }
    setIsOpen(false);
  };

  const opts = useMemo(
    () => [
      { value: 'active', label: 'Active Clients' },
      { value: 'inactive', label: 'Inactive Clients' },
      { value: 'all', label: 'All Clients' },
    ],
    []
  );

  const clientTypes = useMemo(
    () => [
      { value: 'all', label: 'All Types' },
      { value: 'company', label: 'Companies' },
      { value: 'individual', label: 'Individuals' },
    ],
    []
  );

  const mappedOptions = useMemo(
    () =>
      clients.map((opt): { value: string; label: string } => ({
        value: opt.client_name,
        label: opt.client_name,
      })),
    [clients]
  );

  const { automationIdProps: clientPickerProps, updateMetadata } = useAutomationIdAndRegister<FormFieldComponent>(
    {
      type: 'formField',
      fieldType: 'select',
      id,
      value: selectedClientId || '',
      disabled: false,
      required: false,
      options: mappedOptions,
    },
    () => [CommonActions.open('Open client picker dropdown')]
  );

  const prevMetadataRef = useRef<{
    value: string;
    label: string;
    disabled: boolean;
    required: boolean;
    options: { value: string; label: string }[];
  } | null>(null);

  useEffect(() => {
    if (!updateMetadata) return;
    const metadata = {
      value: selectedClientId || '',
      label: placeholder,
      disabled: false,
      required: false,
      options: mappedOptions,
    };
    if (JSON.stringify(prevMetadataRef.current) !== JSON.stringify(metadata)) {
      updateMetadata(metadata);
      prevMetadataRef.current = metadata;
    }
  }, [mappedOptions, placeholder, selectedClientId, updateMetadata]);

  const dropdown = (
    <div
      ref={dropdownRef}
      className="fixed z-[1000] bg-white border border-gray-200 rounded-md shadow-lg overflow-hidden"
      style={{ top: dropdownCoords.top, left: dropdownCoords.left, width: dropdownCoords.width }}
    >
      <div className="p-3 border-b border-gray-100 bg-gray-50">
        <div className="flex items-center gap-2">
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search clients..."
            className="h-9"
          />
        </div>
        <div className="flex items-center gap-2 mt-2">
          <CustomSelect
            value={filterState}
            onValueChange={(value) => onFilterStateChange(value as any)}
            options={opts}
            placeholder="Filter"
            className="flex-1"
          />
          <CustomSelect
            value={clientTypeFilter}
            onValueChange={(value) => onClientTypeFilterChange(value as any)}
            options={clientTypes}
            placeholder="Type"
            className="flex-1"
          />
        </div>
      </div>

      <div className="max-h-[320px] overflow-y-auto">
        {filteredClients.length === 0 ? (
          <div className="p-4 text-sm text-gray-500">No clients found.</div>
        ) : (
          filteredClients.map((client) => (
            <OptionButton
              key={client.client_id}
              id={`${id}-option-${client.client_id}`}
              label={client.client_name}
              onClick={(e) => handleSelect(client.client_id, e)}
              className={`flex items-center gap-2 p-3 cursor-pointer hover:bg-gray-50 ${
                client.client_id === selectedClientId ? 'bg-gray-50' : ''
              }`}
            >
              <ClientAvatar clientId={client.client_id} clientName={client.client_name} logoUrl={(client as any).logoUrl} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate">{client.client_name}</div>
                <div className="text-xs text-gray-500 truncate">
                  {client.client_type ? client.client_type : '—'}
                  {client.is_inactive ? ' • Inactive' : ''}
                </div>
              </div>
            </OptionButton>
          ))
        )}
      </div>
    </div>
  );

  return (
    <ReflectionContainer id={`${id}-container`} label={placeholder}>
      <div
        ref={containerRef}
        className={`relative ${fitContent ? 'inline-block' : 'w-full'} ${className}`}
        {...clientPickerProps}
      >
        <div ref={triggerRef}>
          <Button
            id={`${id}-trigger`}
            type="button"
            variant="outline"
            className={`w-full justify-between ${fitContent ? 'w-auto' : ''}`}
            onClick={() => setIsOpen((prev) => !prev)}
            data-automation-type={dataAutomationType}
          >
            <div className="flex items-center gap-2 min-w-0">
              {selectedClient ? (
                <>
                  <ClientAvatar
                    clientId={selectedClient.client_id}
                    clientName={selectedClient.client_name}
                    logoUrl={(selectedClient as any).logoUrl}
                  />
                  <span className="truncate">{selectedClient.client_name}</span>
                </>
              ) : (
                <span className="text-gray-500">{placeholder}</span>
              )}
            </div>
            <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </Button>
        </div>
        {isOpen && modal && createPortal(dropdown, document.body)}
        {isOpen && !modal && dropdown}
      </div>
    </ReflectionContainer>
  );
};
