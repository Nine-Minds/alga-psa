'use client';

import type { DocumentFilters } from 'server/src/interfaces/document.interface';
import { Input } from 'server/src/components/ui/Input';
import CustomSelect, { SelectOption } from 'server/src/components/ui/CustomSelect';
import { DatePicker } from 'server/src/components/ui/DatePicker';
import UserPicker from 'server/src/components/ui/UserPicker';
import { IUserWithRoles } from 'server/src/interfaces/index';
import { Card } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'server/src/lib/i18n/client';

interface DocumentFiltersProps {
  filters: DocumentFilters;
  onFiltersChange: (filters: DocumentFilters) => void;
  onClearFilters: () => void;
  entityTypeOptions: SelectOption[];
  allUsersData: IUserWithRoles[];
  onShowAllDocuments?: () => void;
  showAllDocumentsButton?: boolean;
}

// Define default sort orders for each field
const defaultSortOrders: Record<string, 'asc' | 'desc'> = {
  'updated_at': 'desc',      // Newest first
  'document_name': 'asc',    // A-Z
  'file_size': 'desc',       // Largest first
  'created_by_full_name': 'asc'  // A-Z
};

export default function DocumentFilters({
  filters,
  onFiltersChange,
  onClearFilters,
  entityTypeOptions,
  allUsersData,
  onShowAllDocuments,
  showAllDocumentsButton = false
}: DocumentFiltersProps) {
  const { t } = useTranslation('common');

  const documentTypes = useMemo<SelectOption[]>(
    () => [
      { value: 'all', label: t('documents.filters.typeOptions.all', 'All Document Types') },
      { value: 'application/pdf', label: t('documents.filters.typeOptions.pdf', 'PDF') },
      { value: 'image', label: t('documents.filters.typeOptions.image', 'Images') },
      { value: 'text', label: t('documents.filters.typeOptions.text', 'Documents') },
      { value: 'video', label: t('documents.filters.typeOptions.video', 'Video') },
      { value: 'application', label: t('documents.filters.typeOptions.other', 'Other') }
    ],
    [t]
  );

  const sortOptions = useMemo<SelectOption[]>(
    () => [
      { value: 'updated_at', label: t('documents.filters.sortOptions.updated_at', 'Date') },
      { value: 'document_name', label: t('documents.filters.sortOptions.document_name', 'Document name') },
      { value: 'file_size', label: t('documents.filters.sortOptions.file_size', 'File size') },
      { value: 'created_by_full_name', label: t('documents.filters.sortOptions.created_by_full_name', 'Created By') }
    ],
    [t]
  );

  const sortTooltip = (
    field: DocumentFilters['sortBy'],
    order: DocumentFilters['sortOrder']
  ) => {
    const sortField = field || 'updated_at';
    const sortOrder = order || defaultSortOrders[sortField] || 'desc';
    return t(`documents.filters.sortOrder.${sortField}.${sortOrder}`, {
      defaultValue:
        sortOrder === 'asc'
          ? t('documents.filters.sortOrder.default.asc', 'Show ascending order')
          : t('documents.filters.sortOrder.default.desc', 'Show descending order')
    });
  };

  return (
    <Card className="p-4 sticky top-6">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('documents.filters.searchLabel', 'Search Documents')}
          </label>
          <Input
            placeholder={t('documents.filters.searchPlaceholder', 'Search by document name...')}
            value={filters.searchTerm || ''}
            onChange={(e) => onFiltersChange({ ...filters, searchTerm: e.target.value })}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('documents.filters.typeLabel', 'Document Type')}
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
            {t('documents.filters.entityTypeLabel', 'Associated Entity Type')}
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
            {t('documents.filters.uploadedByLabel', 'Uploaded By')}
          </label>
          <UserPicker
            users={allUsersData}
            value={filters.uploadedBy || ''}
            onValueChange={(value: string) => {
              onFiltersChange({ ...filters, uploadedBy: value });
            }}
            placeholder={t('documents.filters.uploadedByPlaceholder', 'All Users')}
            buttonWidth="full"
            className="w-full"
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('documents.filters.updatedStartLabel', 'Updated Date Start')}
          </label>
          <DatePicker
            value={filters.updated_at_start ? new Date(filters.updated_at_start) : undefined}
            onChange={(date: Date | undefined) =>
              onFiltersChange({
                ...filters,
                updated_at_start: date ? date.toISOString().split('T')[0] : ''
              })
            }
            placeholder={t('documents.filters.startDatePlaceholder', 'Select start date')}
            className="w-full"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('documents.filters.updatedEndLabel', 'Updated Date End')}
          </label>
          <DatePicker
            value={filters.updated_at_end ? new Date(filters.updated_at_end) : undefined}
            onChange={(date: Date | undefined) =>
              onFiltersChange({
                ...filters,
                updated_at_end: date ? date.toISOString().split('T')[0] : ''
              })
            }
            placeholder={t('documents.filters.endDatePlaceholder', 'Select end date')}
            className="w-full"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('documents.filters.sortByLabel', 'Sort By')}
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
              title={sortTooltip(filters.sortBy, filters.sortOrder)}
            >
              {filters.sortOrder === 'asc' ? (
                <ArrowUp className="h-4 w-4" />
              ) : (
                <ArrowDown className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>

        <div className="pt-4 space-y-2">
          {showAllDocumentsButton && onShowAllDocuments && (
            <Button
              onClick={onShowAllDocuments}
              variant="default"
              className="w-full"
            >
              {t('documents.filters.showAllDocuments', 'Show All Documents')}
            </Button>
          )}
          <Button
            onClick={onClearFilters}
            variant="outline"
            className="w-full"
          >
            {t('documents.filters.clear', 'Clear Filters')}
          </Button>
        </div>
      </div>
    </Card>
  );
}
