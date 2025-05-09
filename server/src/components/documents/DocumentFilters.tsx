'use client';

import type { DocumentFilters } from 'server/src/interfaces/document.interface';
import { Input } from 'server/src/components/ui/Input';
import CustomSelect, { SelectOption } from 'server/src/components/ui/CustomSelect';
import { DatePicker } from 'server/src/components/ui/DatePicker';
import UserPicker from 'server/src/components/ui/UserPicker';
import { IUserWithRoles } from 'server/src/interfaces/index';
import { Card } from 'server/src/components/ui/Card';

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