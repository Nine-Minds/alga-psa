'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Input } from '../ui/Input';
import CustomSelect from '../ui/CustomSelect';
import { Button } from '../ui/Button';
import { ICompany } from '../../interfaces/company.interfaces';
import { ChevronDownIcon } from '@radix-ui/react-icons';
import { ReflectionContainer } from '../../types/ui-reflection/ReflectionContainer';
import { useAutomationIdAndRegister } from '@/types/ui-reflection/useAutomationIdAndRegister';
import { ContainerComponent } from '@/types/ui-reflection/types';

interface CompanyPickerProps {
  id?: string;
  companies?: ICompany[];
  onSelect: (companyId: string) => void;
  selectedCompanyId: string | null;
  filterState: 'all' | 'active' | 'inactive';
  onFilterStateChange: (state: 'all' | 'active' | 'inactive') => void;
  clientTypeFilter: 'all' | 'company' | 'individual';
  onClientTypeFilterChange: (type: 'all' | 'company' | 'individual') => void;
  fitContent?: boolean;
}

export const CompanyPicker: React.FC<CompanyPickerProps> = ({
  id = 'company-picker',
  companies = [],
  onSelect,
  selectedCompanyId,
  filterState,
  onFilterStateChange,
  clientTypeFilter,
  onClientTypeFilterChange,
  fitContent = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Debug logs
  useEffect(() => {
    console.log('CompanyPicker props:', {
      companies: companies.length,
      selectedCompanyId,
      filterState,
      clientTypeFilter
    });
  }, [companies, selectedCompanyId, filterState, clientTypeFilter]);

  const selectedCompany = useMemo(() =>
    companies.find((c) => c.company_id === selectedCompanyId),
    [companies, selectedCompanyId]
  );

  const filteredCompanies = useMemo(() => {
    console.log('Filtering companies:', {
      total: companies.length,
      searchTerm,
      filterState,
      clientTypeFilter,
      selectedCompanyId
    }, []);

    const filtered = companies.filter(company => {
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

      const matches = matchesSearch && matchesState && matchesClientType;
      console.log('Company filter result:', {
        name: company.company_name,
        matches,
        matchesSearch,
        matchesState,
        matchesClientType
      });

      console.log('Company filter details:', {
        companyName: company.company_name,
        companyId: company.company_id,
        matchesSearch,
        matchesState,
        matchesClientType,
        matches
      });

      return matches;
    });

    console.log('Filtered results:', {
      totalCompanies: companies.length,
      filteredCount: filtered.length,
      selectedCompanyFound: filtered.some(c => c.company_id === selectedCompanyId)
    });

    return filtered;
  }, [companies, filterState, clientTypeFilter, searchTerm]);

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

  const handleSelect = (companyId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(companyId);
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

  return (
    <ReflectionContainer id={`${id}-company-picker`} label="Company Picker">
      <div
        className={`${fitContent ? 'w-fit' : 'w-full'} rounded-md relative`}
        ref={dropdownRef}
      >
        <Button
          id={`${id}-toggle`}
          variant="outline"
          onClick={() => setIsOpen(!isOpen)}
          className="w-full justify-between"
          label={selectedCompany ? selectedCompany.company_name : 'Select Client'}
        >
          <span>{selectedCompany ? selectedCompany.company_name : 'Select Client'}</span>
          <ChevronDownIcon className="ml-2 h-4 w-4" />
        </Button>

        {isOpen && (
          <div
            className={`absolute z-[100] bg-white border rounded-md shadow-lg ${fitContent ? 'w-max' : 'w-[350px]'}`}
            style={{
              top: '100%',
              left: 0
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
              className="max-h-60 overflow-y-auto border-t bg-white"
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
