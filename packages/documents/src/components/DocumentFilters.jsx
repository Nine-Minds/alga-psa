'use client';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import UserPicker from '@alga-psa/ui/components/UserPicker';
import { Card } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
// Define default sort orders for each field
const defaultSortOrders = {
    'updated_at': 'desc', // Newest first
    'document_name': 'asc', // A-Z
    'file_size': 'desc', // Largest first
    'created_by_full_name': 'asc' // A-Z
};
export default function DocumentFilters({ filters, onFiltersChange, onClearFilters, entityTypeOptions, allUsersData, onShowAllDocuments, showAllDocumentsButton = false }) {
    const { t } = useTranslation('common');
    const documentTypes = useMemo(() => [
        { value: 'all', label: t('documents.filters.typeOptions.all', 'All Document Types') },
        { value: 'application/pdf', label: t('documents.filters.typeOptions.pdf', 'PDF') },
        { value: 'image', label: t('documents.filters.typeOptions.image', 'Images') },
        { value: 'text', label: t('documents.filters.typeOptions.text', 'Documents') },
        { value: 'video', label: t('documents.filters.typeOptions.video', 'Video') },
        { value: 'application', label: t('documents.filters.typeOptions.other', 'Other') }
    ], [t]);
    const sortOptions = useMemo(() => [
        { value: 'updated_at', label: t('documents.filters.sortOptions.updated_at', 'Date') },
        { value: 'document_name', label: t('documents.filters.sortOptions.document_name', 'Document name') },
        { value: 'file_size', label: t('documents.filters.sortOptions.file_size', 'File size') },
        { value: 'created_by_full_name', label: t('documents.filters.sortOptions.created_by_full_name', 'Created By') }
    ], [t]);
    const sortTooltip = (field, order) => {
        const sortField = field || 'updated_at';
        const sortOrder = order || defaultSortOrders[sortField] || 'desc';
        return t(`documents.filters.sortOrder.${sortField}.${sortOrder}`, {
            defaultValue: sortOrder === 'asc'
                ? t('documents.filters.sortOrder.default.asc', 'Show ascending order')
                : t('documents.filters.sortOrder.default.desc', 'Show descending order')
        });
    };
    return (<Card className="p-4 sticky top-6">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('documents.filters.searchLabel', 'Search Documents')}
          </label>
          <Input placeholder={t('documents.filters.searchPlaceholder', 'Search by document name...')} value={filters.searchTerm || ''} onChange={(e) => onFiltersChange({ ...filters, searchTerm: e.target.value })}/>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('documents.filters.typeLabel', 'Document Type')}
          </label>
          <CustomSelect options={documentTypes} value={filters.type || 'all'} onValueChange={(value) => {
            if (value === 'all') {
                const newFilters = { ...filters };
                delete newFilters.type;
                onFiltersChange(newFilters);
            }
            else {
                onFiltersChange({ ...filters, type: value });
            }
        }}/>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('documents.filters.entityTypeLabel', 'Associated Entity Type')}
          </label>
          <CustomSelect options={entityTypeOptions} value={filters.entityType || 'all_entities'} onValueChange={(value) => {
            if (value === 'all_entities') {
                onFiltersChange({ ...filters, entityType: '' });
            }
            else {
                onFiltersChange({ ...filters, entityType: value });
            }
        }}/>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('documents.filters.uploadedByLabel', 'Uploaded By')}
          </label>
          <UserPicker users={allUsersData} value={filters.uploadedBy || ''} onValueChange={(value) => {
            onFiltersChange({ ...filters, uploadedBy: value });
        }} placeholder={t('documents.filters.uploadedByPlaceholder', 'All Users')} buttonWidth="full" className="w-full"/>
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('documents.filters.updatedStartLabel', 'Updated Date Start')}
          </label>
          <DatePicker value={filters.updated_at_start ? new Date(filters.updated_at_start) : undefined} onChange={(date) => onFiltersChange({
            ...filters,
            updated_at_start: date ? date.toISOString().split('T')[0] : ''
        })} placeholder={t('documents.filters.startDatePlaceholder', 'Select start date')} className="w-full"/>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('documents.filters.updatedEndLabel', 'Updated Date End')}
          </label>
          <DatePicker value={filters.updated_at_end ? new Date(filters.updated_at_end) : undefined} onChange={(date) => onFiltersChange({
            ...filters,
            updated_at_end: date ? date.toISOString().split('T')[0] : ''
        })} placeholder={t('documents.filters.endDatePlaceholder', 'Select end date')} className="w-full"/>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('documents.filters.sortByLabel', 'Sort By')}
          </label>
          <div className="flex items-center space-x-2">
            <CustomSelect options={sortOptions} value={filters.sortBy || 'updated_at'} onValueChange={(value) => {
            const sortField = value;
            const defaultOrder = sortField ? defaultSortOrders[sortField] : 'desc';
            onFiltersChange({
                ...filters,
                sortBy: sortField,
                sortOrder: defaultOrder
            });
        }} className="flex-1"/>
            <button onClick={() => {
            const newOrder = filters.sortOrder === 'asc' ? 'desc' : 'asc';
            onFiltersChange({
                ...filters,
                sortOrder: newOrder
            });
        }} className="p-2 border border-gray-300 rounded-md hover:bg-gray-50" title={sortTooltip(filters.sortBy, filters.sortOrder)}>
              {filters.sortOrder === 'asc' ? (<ArrowUp className="h-4 w-4"/>) : (<ArrowDown className="h-4 w-4"/>)}
            </button>
          </div>
        </div>

        <div className="pt-4 space-y-2">
          {showAllDocumentsButton && onShowAllDocuments && (<Button id="show-all-documents-button" onClick={onShowAllDocuments} variant="default" className="w-full">
              {t('documents.filters.showAllDocuments', 'Show All Documents')}
            </Button>)}
          <Button id="clear-filters-button" onClick={onClearFilters} variant="outline" className="w-full">
            {t('documents.filters.clear', 'Clear Filters')}
          </Button>
        </div>
      </div>
    </Card>);
}
//# sourceMappingURL=DocumentFilters.jsx.map