'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Input } from '../ui/Input';
import CustomSelect from '../ui/CustomSelect';
import { ICompany } from '../../interfaces/company.interfaces';
import { ChevronDownIcon } from '@radix-ui/react-icons';
import { useAutomationIdAndRegister } from '../../types/ui-reflection/useAutomationIdAndRegister';
import { ContainerComponent, FormFieldComponent, ButtonComponent } from '../../types/ui-reflection/types';
import { ReflectionContainer } from '../../types/ui-reflection/ReflectionContainer';

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
    });

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

  return (
    <ReflectionContainer id={id} label="Company Picker">
      <div
        className={`${fitContent ? 'w-fit' : 'w-full'} rounded-md relative`}
        ref={dropdownRef}
      >
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="w-full p-2 border-2 border-gray-200 rounded-md flex justify-between items-center text-left outline-none transition-colors duration-200 hover:border-gray-300 focus:border-purple-500 bg-white"
        >
          <span>{selectedCompany ? selectedCompany.company_name : 'Select Client'}</span>
          <ChevronDownIcon />
        </button>

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
                    options={[
                      { value: 'active', label: 'Active Clients' },
                      { value: 'inactive', label: 'Inactive Clients' },
                      { value: 'all', label: 'All Clients' },
                    ]}
                    placeholder="Filter by status"
                  />
                </div>
                <div className="w-full">
                  <CustomSelect
                    value={clientTypeFilter}
                    onValueChange={handleClientTypeFilterChange}
                    options={[
                      { value: 'all', label: 'All Types' },
                      { value: 'company', label: 'Companies' },
                      { value: 'individual', label: 'Individuals' },
                    ]}
                    placeholder="Filter by client type"
                  />
                </div>
              </div>
              <div className="whitespace-nowrap">
              <Input
                placeholder="Search clients..."
                value={searchTerm}
                onChange={(e) => {
                  e.stopPropagation();
                  setSearchTerm(e.target.value);
                }}
              />
            </div>
            </div>
            <div className="max-h-60 overflow-y-auto border-t bg-white">
              {filteredCompanies.length === 0 ? (
                <div className="px-4 py-2 text-gray-500">No clients found</div>
              ) : (
                filteredCompanies.map((company): JSX.Element => (
                  <button
                    type="button"
                    key={company.company_id}
                    onClick={(e) => handleSelect(company.company_id, e)}
                    className={`w-full text-left px-4 py-2 hover:bg-gray-100 ${company.company_id === selectedCompanyId ? 'bg-blue-100' : ''
                      }`}
                  >
                    {company.company_name}
                    {company.is_inactive && <span className="ml-2 text-gray-500">(Inactive)</span>}
                    <span className="ml-2 text-gray-500">
                      ({company.client_type === 'company' ? 'Company' : 'Individual'})
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </ReflectionContainer >
  );
};
