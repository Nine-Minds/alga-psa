'use client';

import type { DocumentFilters } from 'server/src/interfaces/document.interface';
import { Input } from 'server/src/components/ui/Input';
import CustomSelect, { SelectOption } from 'server/src/components/ui/CustomSelect';
import { DatePicker } from 'server/src/components/ui/DatePicker';
import UserPicker from 'server/src/components/ui/UserPicker';
import { IUserWithRoles } from 'server/src/interfaces/index';
import { Card } from 'server/src/components/ui/Card';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

interface DocumentFiltersProps {
  filters: DocumentFilters;
  onFiltersChange: (filters: DocumentFilters) => void;
  onClearFilters: () => void;
  entityTypeOptions: SelectOption[];
  allUsersData: IUserWithRoles[];
}

const documentTypes: SelectOption[] = [
  { value: 'all', label: 'All Document Types' },
  { value: 'application/pdf', label: 'PDF' },
  { value: 'image', label: 'Images' },
  { value: 'text', label: 'Documents' },
  { value: 'application', label: 'Other' }
];

// Define default sort orders for each field
const defaultSortOrders: Record<string, 'asc' | 'desc'> = {
  'updated_at': 'desc',      // Newest first
  'document_name': 'asc',    // A-Z
  'file_size': 'desc',       // Largest first
  'created_by_full_name': 'asc'  // A-Z
};

const sortOptions: SelectOption[] = [
  { value: 'updated_at', label: 'Date' },
  { value: 'document_name', label: 'Document name' },
  { value: 'file_size', label: 'File size' },
  { value: 'created_by_full_name', label: 'Created By' }
];

export default function DocumentFilters({
  filters,
  onFiltersChange,
  onClearFilters,
  entityTypeOptions,
  allUsersData
}: DocumentFiltersProps) {
  return (
    <Card className="p-4 sticky top-6">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Search Documents
          </label>
          <Input
            placeholder="Search by document name..."
            value={filters.searchTerm || ''}
            onChange={(e) => onFiltersChange({ ...filters, searchTerm: e.target.value })}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Document Type
          </label>
          <CustomSelect
            options={documentTypes}
            value={filters.type || 'all'}
            onValueChange={(value: string) => {
              if (value === 'all') {
                const newFilters = { ...filters };
                delete newFilters.type;
                onFiltersChange(newFilters);
              } else {
                onFiltersChange({ ...filters, type: value });
              }
            }}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Associated Entity Type
          </label>
          <CustomSelect
            options={entityTypeOptions}
            value={filters.entityType || 'all_entities'}
            onValueChange={(value: string) => {
              if (value === 'all_entities') {
                onFiltersChange({ ...filters, entityType: '' });
              } else {
                onFiltersChange({ ...filters, entityType: value });
              }
            }}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Uploaded By
          </label>
          <UserPicker
            users={allUsersData}
            value={filters.uploadedBy || ''}
            onValueChange={(value: string) => {
              onFiltersChange({ ...filters, uploadedBy: value });
            }}
            placeholder="All Users"
            buttonWidth="full"
            className="w-full"
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Updated Date Start
          </label>
          <DatePicker
            value={filters.updated_at_start ? new Date(filters.updated_at_start) : undefined}
            onChange={(date: Date | null) => onFiltersChange({ 
              ...filters, 
              updated_at_start: date ? date.toISOString().split('T')[0] : '' 
            })}
            placeholder="Select start date"
            className="w-full"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Updated Date End
          </label>
          <DatePicker
            value={filters.updated_at_end ? new Date(filters.updated_at_end) : undefined}
            onChange={(date: Date | null) => onFiltersChange({ 
              ...filters, 
              updated_at_end: date ? date.toISOString().split('T')[0] : '' 
            })}
            placeholder="Select end date"
            className="w-full"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Sort By
          </label>
          <div className="flex items-center space-x-2">
            <CustomSelect
              options={sortOptions}
              value={filters.sortBy || 'updated_at'}
              onValueChange={(value: string) => {
                const sortField = value as DocumentFilters['sortBy'];
                const defaultOrder = sortField ? defaultSortOrders[sortField] : 'desc';
                
                onFiltersChange({
                  ...filters,
                  sortBy: sortField,
                  sortOrder: defaultOrder
                });
              }}
              className="flex-1"
            />
            <button
              onClick={() => {
                const newOrder = filters.sortOrder === 'asc' ? 'desc' : 'asc';
                onFiltersChange({
                  ...filters,
                  sortOrder: newOrder
                });
              }}
              className="p-2 border border-gray-300 rounded-md hover:bg-gray-50"
              title={
                filters.sortOrder === 'asc'
                  ? `Show ${filters.sortBy === 'document_name' ? 'Z-A' :
                      filters.sortBy === 'updated_at' ? 'Newest First' :
                      filters.sortBy === 'file_size' ? 'Largest First' : 'Z-A'}`
                  : `Show ${filters.sortBy === 'document_name' ? 'A-Z' :
                      filters.sortBy === 'updated_at' ? 'Oldest First' :
                      filters.sortBy === 'file_size' ? 'Smallest First' : 'A-Z'}`
              }
            >
              {filters.sortOrder === 'asc' ? (
                <ArrowUp className="h-4 w-4" />
              ) : (
                <ArrowDown className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>

        <div className="pt-4">
          <button
            onClick={onClearFilters}
            className="w-full px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            Clear Filters
          </button>
        </div>
      </div>
    </Card>
  );
}