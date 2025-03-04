'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Input } from '../ui/Input';
import CustomSelect, { SelectOption } from '../ui/CustomSelect';
import { Button } from '../ui/Button';
import { ICompany } from '../../interfaces/company.interfaces';
import { ChevronDownIcon } from '@radix-ui/react-icons';
import { ReflectionContainer } from '../../types/ui-reflection/ReflectionContainer';
import { useAutomationIdAndRegister } from 'server/src/types/ui-reflection/useAutomationIdAndRegister';
import { AutomationProps, ContainerComponent, FormFieldComponent } from 'server/src/types/ui-reflection/types';
import { withDataAutomationId } from 'server/src/types/ui-reflection/withDataAutomationId';

interface CompanyPickerProps {
  id?: string;
  companies?: ICompany[];
  onSelect: (companyId: string | null) => void;
  selectedCompanyId: string | null;
  filterState: 'all' | 'active' | 'inactive';
  onFilterStateChange: (state: 'all' | 'active' | 'inactive') => void;
  clientTypeFilter: 'all' | 'company' | 'individual';
  onClientTypeFilterChange: (type: 'all' | 'company' | 'individual') => void;
  fitContent?: boolean;
}

export const CompanyPicker: React.FC<CompanyPickerProps & AutomationProps> = ({
  id = 'company-picker',
  companies = [],
  onSelect,
  selectedCompanyId,
  filterState,
  onFilterStateChange,
  clientTypeFilter,
  onClientTypeFilterChange,
  fitContent = false,
  "data-automation-type": dataAutomationType = 'picker',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedCompany = useMemo(() =>
    companies.find((c) => c.company_id === selectedCompanyId),
    [companies, selectedCompanyId]
  );

  const filteredCompanies = useMemo(() => {
    return companies.filter(company => {
      const matchesSearch = company.company_name.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesState =
        filterState === 'all' ? true :
          filterState === 'active' ? !company.is_inactive :
            filterState === 'inactive' ? company.is_inactive :
              true;
      const matchesClientType =
        clientTypeFilter === 'all' ? true :
          clientTypeFilter === 'company' ? company.client_type === 'company' :
            clientTypeFilter === 'individual' ? company.client_type === 'individual' :
              true;

      return matchesSearch && matchesState && matchesClientType;
    });
  }, [companies, filterState, clientTypeFilter, searchTerm]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!isOpen) return;
      
      const target = event.target as Node;
      const isSelectElement = target.nodeName === 'SELECT';
      const isInsideDropdown = dropdownRef.current?.contains(target);
      const isButton = (target as Element).tagName === 'BUTTON';
      
      // Don't close if clicking select elements or buttons inside the dropdown
      if (!isInsideDropdown && !isSelectElement && !isButton) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleSelect = (companyId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Ensure we're actually changing the selection
    if (companyId !== selectedCompanyId) {
      onSelect(companyId);
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

  const mappedOptions = useMemo(() => companies.map((opt): { value: string; label: string } => ({
    value: opt.company_name,
    label: opt.company_name
  })), [companies]);  

  const { automationIdProps: companyPickerProps, updateMetadata } = useAutomationIdAndRegister<FormFieldComponent>({
    type: 'formField',
    fieldType: 'select',
    id: `${id}-picker`,
    value: selectedCompanyId || '',
    disabled: false,
    required: false,
    options: mappedOptions
  });

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
      value: selectedCompanyId || '',
      label: selectedCompany?.company_name || '',
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
  }, [selectedCompanyId, companies, updateMetadata]); // updateMetadata intentionally omitted  

  return (
    <ReflectionContainer id={`${id}`} label="Company Picker">
      <div
        className={`${fitContent ? 'inline-flex' : 'w-full'} rounded-md relative`}
        ref={dropdownRef}
        {...withDataAutomationId({ id: `${id}-picker` })}
        data-automation-type={dataAutomationType}
      >
        <Button
          id={`${id}-toggle`}
          variant="outline"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsOpen(!isOpen);
          }}
          className="w-full justify-between"
          label={selectedCompany ? selectedCompany.company_name : 'Select Client'}
        >
          <span>{selectedCompany ? selectedCompany.company_name : 'Select Client'}</span>
          <ChevronDownIcon className="ml-2 h-4 w-4" />
        </Button>

        {isOpen && (
          <div
            className="absolute z-[200] bg-white border rounded-md shadow-lg mt-1" 
            style={{
              top: '100%',
              left: 0,
              minWidth: '100%',
              width: 'max-content',
              maxWidth: '400px' // Prevent extremely wide dropdowns
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="p-3 space-y-3 bg-white">
              <div className="grid grid-cols-2 gap-2">
                <div className="w-full">
                  <CustomSelect
                    value={filterState}
                    onValueChange={handleFilterStateChange}
                    options={opts}
                    placeholder="Filter by status"
                    label="Status Filter"
                  />
                </div>
                <div className="w-full">
                  <CustomSelect
                    id={`${id}-type-filter`}
                    value={clientTypeFilter}
                    onValueChange={handleClientTypeFilterChange}
                    options={clientTypes}
                    placeholder="Filter by client type"
                    label="Client Type Filter"
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
              className="border-t bg-white max-h-[300px] overflow-y-auto"
              role="listbox"
              aria-label="Companies"
            >
              {isOpen && filteredCompanies.length === 0 ? (
                <div className="px-4 py-2 text-gray-500">No clients found</div>
              ) : (
                filteredCompanies.map((company): JSX.Element => (
                  <Button
                    key={company.company_id}
                    id={`${id}-company-picker-company-${company.company_id}`}
                    variant="ghost"
                    onClick={(e) => handleSelect(company.company_id, e)}
                    className={`w-full justify-start ${company.company_id === selectedCompanyId ? 'bg-blue-100 hover:bg-blue-200' : ''}`}
                    label={company.company_name}
                    role="option"
                    aria-selected={company.company_id === selectedCompanyId}
                  >
                    {company.company_name}
                    {company.is_inactive && <span className="ml-2 text-gray-500">(Inactive)</span>}
                    <span className="ml-2 text-gray-500">
                      ({company.client_type === 'company' ? 'Company' : 'Individual'})
                    </span>
                  </Button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </ReflectionContainer >
  );
};
