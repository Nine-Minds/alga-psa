'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Button } from '@alga-psa/ui/components/Button';
import type { IClient } from '@alga-psa/types';
import { ChevronDown } from 'lucide-react';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import { useAutomationIdAndRegister } from '@alga-psa/ui/ui-reflection/useAutomationIdAndRegister';
import { AutomationProps, FormFieldComponent, ButtonComponent } from '@alga-psa/ui/ui-reflection/types';
import { withDataAutomationId } from '@alga-psa/ui/ui-reflection/withDataAutomationId';
import { CommonActions } from '@alga-psa/ui/ui-reflection/actionBuilders';
import ClientAvatar from '@alga-psa/ui/components/ClientAvatar';

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

// Component for individual option buttons that registers with UI reflection
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
    <div
      {...automationIdProps}
      data-automation-type="button"
      className={className}
      onClick={onClick}
    >
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
  "data-automation-type": dataAutomationType = 'picker',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownCoords, setDropdownCoords] = useState({ top: 0, left: 0, width: 0 });

  const selectedClient = useMemo(() =>
    clients.find((c) => c.client_id === selectedClientId),
    [clients, selectedClientId]
  );

  const filteredClients = useMemo(() => {
    return clients
      .filter(client => {
        const matchesSearch = client.client_name.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesState =
        filterState === 'all' ? true :
          filterState === 'active' ? !client.is_inactive :
            filterState === 'inactive' ? client.is_inactive :
              true;
      const matchesClientType =
        clientTypeFilter === 'all' ? true :
          clientTypeFilter === 'company' ? client.client_type === 'company' :
            clientTypeFilter === 'individual' ? client.client_type === 'individual' :
              true;

      return matchesSearch && matchesState && matchesClientType;
    })
    .sort((a, b) => a.client_name.localeCompare(b.client_name));
  }, [clients, filterState, clientTypeFilter, searchTerm]);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      // Check if click is inside the dropdown portal or the trigger button
      const isInsideDropdown = dropdownRef.current?.contains(target);
      const isInsideButton = buttonRef.current?.contains(target);

      // Check if click is inside a Radix Select portal (the filter dropdowns)
      const isInsideRadixSelect = target.closest('[data-radix-select-content]') !== null ||
                                   target.closest('[data-radix-popper-content-wrapper]') !== null;

      // Don't close if clicking inside the dropdown, button, or Radix Select portals
      if (!isInsideDropdown && !isInsideButton && !isInsideRadixSelect) {
        setIsOpen(false);
      }
    };

    // Use capture phase to handle events before they reach other handlers
    document.addEventListener('mousedown', handleClickOutside, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true);
    };
  }, [isOpen]);

  // Calculate dropdown position for portal rendering
  const updateDropdownPosition = useCallback(() => {
    if (!buttonRef.current) return;

    const buttonRect = buttonRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const margin = 16; // 1rem margin
    
    // Calculate dropdown width (match button width, with min/max constraints)
    const dropdownWidth = Math.min(400, Math.max(buttonRect.width, 250));
    
    // Calculate available space on both sides
    const spaceOnRight = viewportWidth - buttonRect.right;
    const spaceOnLeft = buttonRect.left;
    
    // Determine horizontal position
    let left = buttonRect.left;
    
    // If dropdown would overflow on the right, align to the right edge of button
    if (buttonRect.left + dropdownWidth > viewportWidth - margin) {
      // Check if aligning to right would work better
      if (spaceOnLeft > spaceOnRight) {
        left = Math.max(margin, buttonRect.right - dropdownWidth);
      } else {
        // Constrain to viewport
        left = Math.max(margin, viewportWidth - dropdownWidth - margin);
      }
    }
    
    setDropdownCoords({
      top: buttonRect.bottom + 4,
      left,
      width: dropdownWidth
    });
  }, []);

  // Calculate dropdown position when it opens
  useEffect(() => {
    if (isOpen) {
      updateDropdownPosition();

      // Update position on scroll and resize
      window.addEventListener('scroll', updateDropdownPosition, true);
      window.addEventListener('resize', updateDropdownPosition);

      return () => {
        window.removeEventListener('scroll', updateDropdownPosition, true);
        window.removeEventListener('resize', updateDropdownPosition);
      };
    }
  }, [isOpen, updateDropdownPosition]);

  const handleSelect = (clientId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Ensure we're actually changing the selection
    if (clientId !== selectedClientId) {
      onSelect(clientId);
    }
    setIsOpen(false);
  };

  const handleFilterStateChange = (value: string) => {
    onFilterStateChange(value as 'all' | 'active' | 'inactive');
  };

  const handleClientTypeFilterChange = (value: string) => {
    onClientTypeFilterChange(value as 'all' | 'company' | 'individual');
  };

  const opts = useMemo(() => [
    { value: 'active', label: 'Active Clients' },
    { value: 'inactive', label: 'Inactive Clients' },
    { value: 'all', label: 'All Clients' },
  ], []);

  const clientTypes = useMemo(() => [
    { value: 'all', label: 'All Types' },
    { value: 'company', label: 'Companies' },
    { value: 'individual', label: 'Individuals' },
  ], []);

  const mappedOptions = useMemo(() => clients.map((opt): { value: string; label: string } => ({
    value: opt.client_name,
    label: opt.client_name
  })), [clients]);  

  const { automationIdProps: clientPickerProps, updateMetadata } = useAutomationIdAndRegister<FormFieldComponent>({
    type: 'formField',
    fieldType: 'select',
    id,
    value: selectedClientId || '',
    disabled: false,
    required: false,
    options: mappedOptions
  }, () => [
    CommonActions.open('Open client picker dropdown')
  ]);

  // Setup for storing previous metadata
  const prevMetadataRef = useRef<{
    value: string;
    label: string;
    disabled: boolean;
    required: boolean;
    options: { value: string; label: string }[];
  } | null>(null);  

  useEffect(() => {
    if (!updateMetadata) return;

    // Construct the new metadata
    const newMetadata = {
      value: selectedClientId || '',
      label: selectedClient?.client_name || '',
      disabled: false,
      required: false,
      options: mappedOptions
    };

    // Compare with previous metadata
    // Custom equality check for options arrays
    const areOptionsEqual = (prev: { value: string; label: string }[] | undefined, 
                           curr: { value: string; label: string }[]) => {
      if (!prev) return false;
      if (prev.length !== curr.length) return false;
      
      // Create sets of values for comparison
      const prevValues = new Set(prev.map((o): string => `${o.value}:${o.label}`));
      const currValues = new Set(curr.map((o): string => `${o.value}:${o.label}`));
      
      // Check if all values exist in both sets
      for (const value of prevValues) {
        if (!currValues.has(value)) return false;
      }
      return true;
    };

    // Custom equality check for the entire metadata object
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
      // Update metadata since it's different
      updateMetadata(newMetadata);

      // Update the ref with the new metadata
      prevMetadataRef.current = newMetadata;
    }
  }, [selectedClientId, clients, updateMetadata]); // updateMetadata intentionally omitted  

  return (
    <ReflectionContainer id={`${id}`} label="Client Picker">
      <div
        className={`${fitContent ? 'inline-flex' : 'w-full'} rounded-md relative ${className}`}
        ref={containerRef}
        {...withDataAutomationId({ id })}
        data-automation-type={dataAutomationType}
      >
        <Button
          ref={buttonRef}
          variant="outline"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsOpen(!isOpen);
          }}
          className="w-full justify-between px-2 bg-white"
          label={selectedClient ? selectedClient.client_name : placeholder}
          {...clientPickerProps}
          id={`${id}-toggle`}
          data-automation-type={dataAutomationType}
        >
          <div className="flex-1 text-left">
            {selectedClient ? (
              <div className="flex items-center space-x-2">
                <ClientAvatar
                  clientId={selectedClient.client_id}
                  clientName={selectedClient.client_name}
                  logoUrl={selectedClient.logoUrl ?? null}
                  size="sm"
                />
                <span>{selectedClient.client_name}</span>
              </div>
            ) : (
              <span className="text-gray-400">{placeholder}</span>
            )}
          </div>
          <ChevronDown className="h-4 w-4 text-gray-500" />
        </Button>

        {/* Dropdown - Using portal to escape overflow:hidden containers */}
        {isOpen && createPortal(
          <div
            ref={dropdownRef}
            className="fixed z-[10000] pointer-events-auto"
            style={{
              top: `${dropdownCoords.top}px`,
              left: `${dropdownCoords.left}px`,
              width: `${dropdownCoords.width}px`,
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-white border rounded-md shadow-lg w-full">
              <ReflectionContainer id={`${id}-dropdown`} label="Client Picker Dropdown">
                <div className="p-3 space-y-3 bg-white">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="w-full">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Status Filter
                      </label>
                    </div>
                    <div className="w-full">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Client Type Filter
                      </label>
                    </div>
                    <div className="w-full">
                      <CustomSelect
                        value={filterState}
                        onValueChange={handleFilterStateChange}
                        options={opts}
                        placeholder="Filter by status"
                        modal={modal}
                      />
                    </div>
                    <div className="w-full">
                      <CustomSelect
                        id={`${id}-type-filter`}
                        value={clientTypeFilter}
                        onValueChange={handleClientTypeFilterChange}
                        options={clientTypes}
                        placeholder="Filter by client type"
                        modal={modal}
                      />
                    </div>
                  </div>
                  <div className="whitespace-nowrap">
                    <Input
                      id={`${id}-search`}
                      placeholder="Search clients..."
                      value={searchTerm}
                      onChange={(e) => {
                        e.stopPropagation();
                        setSearchTerm(e.target.value);
                      }}
                      label="Search Clients"
                    />
                  </div>
                </div>
                <div
                  className="border-t bg-white max-h-[300px] overflow-y-auto overscroll-contain"
                  role="listbox"
                  aria-label="Clients"
                  onWheel={(e) => {
                    // Ensure scroll events work properly within the dropdown
                    e.stopPropagation();
                  }}
                >
                  {/* Add clear/none option */}
                  <OptionButton
                    id={`${id}-client-picker-none`}
                    label="None"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onSelect(null);
                      setIsOpen(false);
                    }}
                    className={`w-full justify-start px-2 py-2 cursor-pointer hover:bg-gray-100 ${
                      !selectedClientId ? 'bg-blue-100 hover:bg-blue-200' : ''
                    }`}
                  >
                    <div className="flex items-center space-x-2 flex-grow">
                      <span className="text-gray-500 italic">No Client</span>
                    </div>
                  </OptionButton>
                  {isOpen && filteredClients.length === 0 ? (
                    <div className="px-4 py-2 text-gray-500">No clients found</div>
                  ) : (
                    filteredClients.map((client): React.JSX.Element => (
                      <OptionButton
                        key={client.client_id}
                        id={`${id}-client-picker-client-${client.client_id}`}
                        label={client.client_name}
                        onClick={(e) => handleSelect(client.client_id, e)}
                        className={`w-full justify-start px-2 py-2 cursor-pointer hover:bg-gray-100 ${
                          client.client_id === selectedClientId ? 'bg-blue-100 hover:bg-blue-200' : ''
                        }`}
                      >
                        <div className="flex items-center space-x-2 flex-grow">
                          <ClientAvatar
                            clientId={client.client_id}
                            clientName={client.client_name}
                            logoUrl={client.logoUrl ?? null}
                            size="sm"
                          />
                          <span>{client.client_name}</span>
                          {client.is_inactive && <span className="ml-auto pl-2 text-xs text-gray-500">(Inactive)</span>}
                          <span className="ml-2 text-xs text-gray-500">
                            ({client.client_type === 'company' ? 'Company' : 'Individual'})
                          </span>
                        </div>
                      </OptionButton>
                    ))
                  )}
                </div>
              </ReflectionContainer>
            </div>
          </div>,
          document.body
        )}
      </div>
    </ReflectionContainer >
  );
};
