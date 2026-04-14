'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Label } from '@alga-psa/ui/components/Label';
import { StringDateRangePicker } from '@alga-psa/ui/components/DateRangePicker';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import type { ActivityFilters, ISO8601String } from '@alga-psa/types';

interface ClientNotificationFiltersDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  initialFilters: Partial<ActivityFilters>;
  onApplyFilters: (filters: Partial<ActivityFilters>) => void;
}

const NOTIFICATION_CATEGORIES = [
  { value: 'tickets', label: 'Tickets' },
  { value: 'projects', label: 'Projects' },
  { value: 'invoices', label: 'Invoices' },
  { value: 'system', label: 'System' },
];

export function ClientNotificationFiltersDialog({
  isOpen,
  onOpenChange,
  initialFilters,
  onApplyFilters,
}: ClientNotificationFiltersDialogProps) {
  const [localFilters, setLocalFilters] = useState<Partial<ActivityFilters>>(() => initialFilters);
  const [selectedCategory, setSelectedCategory] = useState<string>(initialFilters.search || 'all');

  useEffect(() => {
    setLocalFilters(initialFilters);
    setSelectedCategory(initialFilters.search || 'all');
  }, [initialFilters]);

  const handleDateChange = (range: { from: string; to: string }) => {
    const startDate = range.from ? new Date(`${range.from}T00:00:00Z`) : undefined;
    const endDate = range.to ? new Date(`${range.to}T23:59:59Z`) : undefined;

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
    const filtersToApply: Partial<ActivityFilters> = {
      ...localFilters,
      search: selectedCategory && selectedCategory !== 'all' ? selectedCategory : undefined,
    };

    if (!filtersToApply.search) {
      delete filtersToApply.search;
    }

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
    <div className="flex w-full justify-between">
      <Button id="notification-filter-clear" variant="outline" onClick={handleClear}>Reset</Button>
      <div>
        <Button id="notification-filter-cancel" variant="ghost" className="mr-2" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button id="notification-filter-apply" onClick={handleApply}>Apply Filters</Button>
      </div>
    </div>
  );

  return (
    <Dialog isOpen={isOpen} onClose={() => onOpenChange(false)} footer={footer}>
      <DialogContent className="sm:max-w-[700]">
        <DialogHeader>
          <DialogTitle>Filter Notifications</DialogTitle>
          <DialogDescription>Select criteria to filter notification activities.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label className="text-base font-semibold">Status</Label>
            <div className="flex items-center space-x-4 pt-1">
              <Checkbox
                id="show-unread-only"
                label="Unread Only"
                checked={!localFilters.isClosed}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setLocalFilters((prev) => ({ ...prev, isClosed: !e.target.checked }))
                }
              />
              <Checkbox
                id="show-read-notifications"
                label="Show Read"
                checked={localFilters.isClosed === true}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setLocalFilters((prev) => ({ ...prev, isClosed: e.target.checked }))
                }
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="notification-category-select" className="text-base font-semibold">Category</Label>
            <CustomSelect
              id="notification-category-select"
              value={selectedCategory}
              onValueChange={setSelectedCategory}
              options={[{ value: 'all', label: 'All Categories' }, ...NOTIFICATION_CATEGORIES]}
              placeholder="Select Category..."
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="notification-date-range" className="text-base font-semibold">Date Range</Label>
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
