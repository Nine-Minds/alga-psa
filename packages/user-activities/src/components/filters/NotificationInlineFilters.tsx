'use client';

import React from 'react';
import { X } from 'lucide-react';
import { ActivityFilters, ActivityPriority, ISO8601String } from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { StringDateRangePicker } from '@alga-psa/ui/components/DateRangePicker';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export type NotificationPriorityKey = 'all' | 'high' | 'normal' | 'low';

const PRIORITY_KEYS: NotificationPriorityKey[] = ['all', 'high', 'normal', 'low'];

// Stored notification priority 'normal' is ActivityPriority.MEDIUM.
export function priorityKeyToActivityPriority(key: NotificationPriorityKey): ActivityPriority | undefined {
  switch (key) {
    case 'high':
      return ActivityPriority.HIGH;
    case 'normal':
      return ActivityPriority.MEDIUM;
    case 'low':
      return ActivityPriority.LOW;
    default:
      return undefined;
  }
}

export function activityFiltersToPriorityKey(filters: Partial<ActivityFilters>): NotificationPriorityKey {
  if (filters.priority?.includes(ActivityPriority.HIGH)) return 'high';
  if (filters.priority?.includes(ActivityPriority.MEDIUM)) return 'normal';
  if (filters.priority?.includes(ActivityPriority.LOW)) return 'low';
  return 'all';
}

interface NotificationInlineFiltersProps {
  filters: Partial<ActivityFilters>;
  /** Receives the complete next filters object. */
  onChange: (filters: Partial<ActivityFilters>) => void;
  disabled?: boolean;
}

/**
 * Inline notification filters (category, priority, date range). The Unread/All/Read tabs
 * stay the read-state control, so there is no separate "show read" toggle here.
 */
export function NotificationInlineFilters({ filters, onChange, disabled = false }: NotificationInlineFiltersProps) {
  const { t } = useTranslation('msp/user-activities');
  const activePriority = activityFiltersToPriorityKey(filters);

  const categories = (['tickets', 'projects', 'invoices', 'system'] as const).map((value) => ({
    value,
    label: t(`sections.notifications.filterDialog.fields.categories.${value}`, {
      defaultValue: value.charAt(0).toUpperCase() + value.slice(1),
    }),
  }));

  const hasExtra = Boolean(
    filters.search || filters.priority?.length || filters.dateRangeStart || filters.dateRangeEnd
  );

  const setCategory = (value: string) => {
    const next = { ...filters };
    // LEVERAGE: friction notification-category-in-search — category is smuggled through ActivityFilters.search, which processActivities also treats as a title/description substring
    if (value && value !== 'all') next.search = value;
    else delete next.search;
    onChange(next);
  };

  const setPriority = (key: NotificationPriorityKey) => {
    const next = { ...filters };
    const mapped = priorityKeyToActivityPriority(key);
    if (mapped) next.priority = [mapped];
    else delete next.priority;
    onChange(next);
  };

  const setDateRange = (range: { from: string; to: string }) => {
    const next = { ...filters };
    const start = range.from ? new Date(range.from + 'T00:00:00Z') : undefined;
    const end = range.to ? new Date(range.to + 'T23:59:59Z') : undefined;
    const effectiveStart = !start && end ? new Date(end) : start;
    if (effectiveStart && !start && end) effectiveStart.setUTCHours(0, 0, 0, 0);
    if (effectiveStart) next.dateRangeStart = effectiveStart.toISOString() as ISO8601String;
    else delete next.dateRangeStart;
    if (end) next.dateRangeEnd = end.toISOString() as ISO8601String;
    else delete next.dateRangeEnd;
    onChange(next);
  };

  const clear = () => {
    const next = { ...filters };
    delete next.search;
    delete next.priority;
    delete next.dateRangeStart;
    delete next.dateRangeEnd;
    onChange(next);
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex items-center gap-2">
        <Label htmlFor="notification-category-select" className="text-sm font-medium mb-0">
          {t('sections.notifications.filterDialog.fields.category', { defaultValue: 'Category' })}
        </Label>
        <CustomSelect
          id="notification-category-select"
          value={filters.search || 'all'}
          onValueChange={setCategory}
          options={[
            { value: 'all', label: t('sections.notifications.filterDialog.fields.allCategories', { defaultValue: 'All Categories' }) },
            ...categories,
          ]}
          placeholder={t('sections.notifications.filterDialog.fields.categoryPlaceholder', { defaultValue: 'Select Category...' })}
          disabled={disabled}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-gray-600 mr-1">
          {t('sections.notifications.priority.label', { defaultValue: 'Priority' })}
        </span>
        {PRIORITY_KEYS.map((key) => (
          <Button
            key={key}
            id={`notification-priority-filter-${key}`}
            variant={activePriority === key ? 'default' : 'outline'}
            size="sm"
            onClick={() => setPriority(key)}
            disabled={disabled}
          >
            {t(`sections.notifications.priority.${key}`, {
              defaultValue: key === 'all' ? 'All' : key === 'high' ? 'High' : key === 'normal' ? 'Normal' : 'Low',
            })}
          </Button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Label htmlFor="notification-date-range" className="text-sm font-medium mb-0">
          {t('sections.notifications.filterDialog.fields.dateRange', { defaultValue: 'Date Range' })}
        </Label>
        <StringDateRangePicker
          id="notification-date-range"
          value={{
            from: filters.dateRangeStart ? filters.dateRangeStart.split('T')[0] : '',
            to: filters.dateRangeEnd ? filters.dateRangeEnd.split('T')[0] : '',
          }}
          onChange={setDateRange}
        />
      </div>

      {hasExtra && (
        <Button
          id="clear-notification-filters-button"
          variant="ghost"
          size="sm"
          onClick={clear}
          disabled={disabled}
          aria-label={t('sections.notifications.actions.reset', { defaultValue: 'Reset' })}
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
