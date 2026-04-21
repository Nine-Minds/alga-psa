'use client';


import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@alga-psa/ui/components/Dialog";
import { Button } from "@alga-psa/ui/components/Button";
import { Checkbox } from "@alga-psa/ui/components/Checkbox";
import { Label } from "@alga-psa/ui/components/Label";
import { StringDateRangePicker } from "@alga-psa/ui/components/DateRangePicker";
import { ActivityFilters } from "@alga-psa/types";
import { ISO8601String } from '@alga-psa/types';
import CustomSelect from "@alga-psa/ui/components/CustomSelect";
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface NotificationSectionFiltersDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  initialFilters: Partial<ActivityFilters>;
  onApplyFilters: (filters: Partial<ActivityFilters>) => void;
}

export function NotificationSectionFiltersDialog({
  isOpen,
  onOpenChange,
  initialFilters,
  onApplyFilters,
}: NotificationSectionFiltersDialogProps) {
  const { t } = useTranslation('msp/user-activities');

  // Notification categories mapping
  const NOTIFICATION_CATEGORIES = [
    { value: 'tickets', label: t('sections.notifications.filterDialog.fields.categories.tickets', { defaultValue: 'Tickets' }) },
    { value: 'projects', label: t('sections.notifications.filterDialog.fields.categories.projects', { defaultValue: 'Projects' }) },
    { value: 'invoices', label: t('sections.notifications.filterDialog.fields.categories.invoices', { defaultValue: 'Invoices' }) },
    { value: 'system', label: t('sections.notifications.filterDialog.fields.categories.system', { defaultValue: 'System' }) },
  ];
  // Local state for filters
  const [localFilters, setLocalFilters] = useState<Partial<ActivityFilters>>(() => initialFilters);
  const [selectedCategory, setSelectedCategory] = useState<string>(initialFilters.search || 'all');

  // Sync local state when initial filters change from parent
  useEffect(() => {
    setLocalFilters(initialFilters);
    setSelectedCategory(initialFilters.search || 'all');
  }, [initialFilters]);

  const handleDateChange = (range: { from: string; to: string }) => {
    const startDate = range.from ? new Date(range.from + 'T00:00:00Z') : undefined;
    const endDate = range.to ? new Date(range.to + 'T23:59:59Z') : undefined;

    const effectiveStartDate = !startDate && endDate ? new Date(endDate) : startDate;
    if (effectiveStartDate && !startDate && endDate) {
      effectiveStartDate.setUTCHours(0, 0, 0, 0);
    }

    setLocalFilters((prev) => ({
      ...prev,
      dateRangeStart: effectiveStartDate?.toISOString() as ISO8601String | undefined,
      dateRangeEnd: endDate?.toISOString() as ISO8601String | undefined,
    }));
  };

  const handleApply = () => {
    // Construct the final filters object
    const filtersToApply: Partial<ActivityFilters> = {
      ...localFilters,
      search: selectedCategory && selectedCategory !== 'all' ? selectedCategory : undefined,
    };

    if (!filtersToApply.search) delete filtersToApply.search;

    onApplyFilters(filtersToApply);
    onOpenChange(false);
  };

  const handleClear = () => {
    const clearedFilters: Partial<ActivityFilters> = {
      isClosed: false,
      dateRangeStart: undefined,
      dateRangeEnd: undefined,
      search: undefined,
    };
    setLocalFilters(clearedFilters);
    setSelectedCategory('all');
  };

  const footer = (
    <div className="flex justify-between w-full">
      <Button id="notification-filter-clear" variant="outline" onClick={handleClear}>{t('sections.notifications.filterDialog.actions.reset', { defaultValue: 'Reset' })}</Button>
      <div>
        <Button id="notification-filter-cancel" variant="ghost" className="mr-2" onClick={() => onOpenChange(false)}>{t('sections.notifications.filterDialog.actions.cancel', { defaultValue: 'Cancel' })}</Button>
        <Button id="notification-filter-apply" onClick={handleApply}>{t('sections.notifications.filterDialog.actions.apply', { defaultValue: 'Apply Filters' })}</Button>
      </div>
    </div>
  );

  return (
    <Dialog isOpen={isOpen} onClose={() => onOpenChange(false)} footer={footer}>
      <DialogContent className="sm:max-w-[700]">
        <DialogHeader>
          <DialogTitle>{t('sections.notifications.filterDialog.title', { defaultValue: 'Filter Notifications' })}</DialogTitle>
          <DialogDescription>
            {t('sections.notifications.filterDialog.description', { defaultValue: 'Select criteria to filter notification activities.' })}
          </DialogDescription>
        </DialogHeader>
        <div className="py-2 space-y-4">

          {/* Read/Unread Filter */}
          <div className="space-y-1">
            <Label className="text-base font-semibold">{t('sections.notifications.filterDialog.fields.status', { defaultValue: 'Status' })}</Label>
            <div className="flex items-center space-x-4 pt-1">
              <Checkbox
                id="show-unread-only"
                label={t('sections.notifications.filterDialog.fields.unreadOnly', { defaultValue: 'Unread Only' })}
                checked={!localFilters.isClosed}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setLocalFilters(prev => ({ ...prev, isClosed: !e.target.checked }))
                }
              />
              <Checkbox
                id="show-read-notifications"
                label={t('sections.notifications.filterDialog.fields.showRead', { defaultValue: 'Show Read' })}
                checked={localFilters.isClosed === true}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setLocalFilters(prev => ({ ...prev, isClosed: e.target.checked }))
                }
              />
            </div>
          </div>

          {/* Category Filter */}
          <div className="space-y-1">
            <Label htmlFor="notification-category-select" className="text-base font-semibold">{t('sections.notifications.filterDialog.fields.category', { defaultValue: 'Category' })}</Label>
            <CustomSelect
              id="notification-category-select"
              value={selectedCategory}
              onValueChange={(value) => setSelectedCategory(value)}
              options={[
                { value: 'all', label: t('sections.notifications.filterDialog.fields.allCategories', { defaultValue: 'All Categories' }) },
                ...NOTIFICATION_CATEGORIES
              ]}
              placeholder={t('sections.notifications.filterDialog.fields.categoryPlaceholder', { defaultValue: 'Select Category...' })}
            />
          </div>

          {/* Date Range */}
          <div className="space-y-1">
            <Label htmlFor="notification-date-range" className="text-base font-semibold">{t('sections.notifications.filterDialog.fields.dateRange', { defaultValue: 'Date Range' })}</Label>
            <StringDateRangePicker
              id="notification-date-range"
              value={{
                from: localFilters.dateRangeStart ? localFilters.dateRangeStart.split('T')[0] : '',
                to: localFilters.dateRangeEnd ? localFilters.dateRangeEnd.split('T')[0] : '',
              }}
              onChange={handleDateChange}
            />
          </div>

        </div>
      </DialogContent>
    </Dialog>
  );
}
