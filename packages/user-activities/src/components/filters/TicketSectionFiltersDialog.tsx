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
import { Input } from "@alga-psa/ui/components/Input";
import { StringDateRangePicker } from "@alga-psa/ui/components/DateRangePicker";
import { ActivityFilters, IPriority } from "@alga-psa/types";
import { IStatus } from "@alga-psa/types";
import { IClient } from "@alga-psa/types";
import { IContact } from "@alga-psa/types";
import { DateRange } from 'react-day-picker';
import { ISO8601String } from '@alga-psa/types';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { ContactPicker } from "@alga-psa/ui/components/ContactPicker";
import CustomSelect from "@alga-psa/ui/components/CustomSelect";
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface TicketSectionFiltersDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  initialFilters: Partial<ActivityFilters>;
  onApplyFilters: (filters: Partial<ActivityFilters>) => void;
  clients: IClient[];
  contacts: IContact[];
  statuses: IStatus[];
  priorities: IPriority[];
}

export function TicketSectionFiltersDialog({
  isOpen,
  onOpenChange,
  initialFilters,
  onApplyFilters,
  clients = [],
  contacts = [],
  statuses = [],
  priorities = [],
}: TicketSectionFiltersDialogProps) {
  const { t } = useTranslation('msp/user-activities');
  // Local state excluding status, which is handled separately
  const [localFilters, setLocalFilters] = useState<Omit<Partial<ActivityFilters>, 'status'>>(() => {
    const { status, ...rest } = initialFilters;
    return rest;
  });
  // Separate state for the single-select status dropdown
  const [selectedStatus, setSelectedStatus] = useState<string>(initialFilters.status?.[0] || 'all');

  const [clientFilterState, setClientFilterState] = useState<'all' | 'active' | 'inactive'>('active');
  const [clientClientTypeFilter, setClientClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');

  // Sync local state when initial filters change from parent
  useEffect(() => {
    const { status, priorityIds, ...rest } = initialFilters;
    setLocalFilters(rest);
    setSelectedStatus(status?.[0] || 'all');
    setSelectedPriorityId(priorityIds?.[0] || 'all');
  }, [initialFilters]);

  const [selectedPriorityId, setSelectedPriorityId] = useState<string>(initialFilters.priorityIds?.[0] || 'all');

  const handleSingleFilterChange = <K extends keyof Omit<ActivityFilters, 'status' | 'priority'>>( // Exclude array types
    key: K,
    value: string | null | undefined
  ) => {
    setLocalFilters((prev) => ({
      ...prev,
      [key]: value || undefined
    }));
  };


  const handleDateChange = (range: { from: string; to: string }) => {
    const startDate = range.from ? new Date(range.from + 'T00:00:00Z') : undefined;
    const endDate = range.to ? new Date(range.to + 'T23:59:59Z') : undefined;

    const effectiveStartDate = !startDate && endDate ? new Date(endDate) : startDate;
    if (effectiveStartDate && !startDate && endDate) {
        effectiveStartDate.setUTCHours(0, 0, 0, 0);
    }


    setLocalFilters((prev) => ({
      ...prev,
      dueDateStart: effectiveStartDate?.toISOString() as ISO8601String | undefined,
      dueDateEnd: endDate?.toISOString() as ISO8601String | undefined,
    }));
  };

  const handleApply = () => {
    // Construct the final filters object, converting single selects back to arrays
    const filtersToApply: Partial<ActivityFilters> = {
        ...localFilters,
        status: selectedStatus && selectedStatus !== 'all' ? [selectedStatus] : undefined,
        priorityIds: selectedPriorityId && selectedPriorityId !== 'all' ? [selectedPriorityId] : undefined,
    };

    if (!filtersToApply.clientId) delete filtersToApply.clientId;
    if (!filtersToApply.contactId) delete filtersToApply.contactId;
    if (!filtersToApply.status) delete filtersToApply.status;
    if (!filtersToApply.priorityIds) delete filtersToApply.priorityIds;

    onApplyFilters(filtersToApply);
    onOpenChange(false);
  };

  const handleClear = () => {
    const clearedFilters: Omit<Partial<ActivityFilters>, 'status' | 'priorityIds'> = {
      isClosed: undefined,
      dueDateStart: undefined,
      dueDateEnd: undefined,
      clientId: undefined,
      contactId: undefined,
      search: undefined,
    };
    setLocalFilters(clearedFilters);
    setSelectedStatus('all');
    setSelectedPriorityId('all');
  };


  const footer = (
    <div className="flex justify-between w-full">
      <Button id="ticket-filter-clear" variant="outline" onClick={handleClear}>{t('sections.tickets.filterDialog.actions.reset', { defaultValue: 'Reset' })}</Button>
      <div>
        <Button id="ticket-filter-cancel" variant="ghost" className="mr-2" onClick={() => onOpenChange(false)}>{t('sections.tickets.filterDialog.actions.cancel', { defaultValue: 'Cancel' })}</Button>
        <Button id="ticket-filter-apply" onClick={handleApply}>{t('sections.tickets.filterDialog.actions.apply', { defaultValue: 'Apply Filters' })}</Button>
      </div>
    </div>
  );

  return (
    <Dialog isOpen={isOpen} onClose={() => onOpenChange(false)} footer={footer}>
      <DialogContent className="sm:max-w-[700]">
        <DialogHeader>
          <DialogTitle>{t('sections.tickets.filterDialog.title', { defaultValue: 'Filter Tickets' })}</DialogTitle>
           <DialogDescription>
             {t('sections.tickets.filterDialog.description', { defaultValue: 'Select criteria to filter ticket activities.' })}
           </DialogDescription>
        </DialogHeader>
        <div className="py-2 space-y-4">

          {/* Search Filter */}
          <div className="space-y-1">
            <Label htmlFor="ticket-search" className="text-base font-semibold">{t('sections.tickets.filterDialog.fields.search', { defaultValue: 'Search' })}</Label>
            <Input
              id="ticket-search"
              value={localFilters.search || ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleSingleFilterChange('search', e.target.value)}
              placeholder={t('sections.tickets.filterDialog.fields.searchPlaceholder', { defaultValue: 'Search title, description, ticket #' })}
            />
          </div>


          {/* Client, Contact, and Status Filters */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-0">
            <div className="space-y-1">
              <Label htmlFor="ticket-client-picker" className="text-base font-semibold">{t('sections.tickets.filterDialog.fields.client', { defaultValue: 'Client' })}</Label>
              <ClientPicker
                id="ticket-client-picker"
                clients={clients}
                selectedClientId={localFilters.clientId || null}
                onSelect={(clientId: string | null) => handleSingleFilterChange('clientId', clientId)}
                filterState={clientFilterState}
                onFilterStateChange={setClientFilterState}
                clientTypeFilter={clientClientTypeFilter}
                onClientTypeFilterChange={setClientClientTypeFilter}
                fitContent={false}
              />
            </div>
             <div className="space-y-1">
              <Label htmlFor="ticket-contact-picker" className="text-base font-semibold">{t('sections.tickets.filterDialog.fields.contact', { defaultValue: 'Contact' })}</Label>
              <ContactPicker
                id="ticket-contact-picker"
                contacts={contacts}
                value={localFilters.contactId || ''}
                onValueChange={(contactId: string) => handleSingleFilterChange('contactId', contactId)}
                clientId={localFilters.clientId}
                buttonWidth="full"
              />
            </div>
            {/* Status Filter */}
            <div className="space-y-1">
              <Label htmlFor="ticket-status-select" className="text-base font-semibold">{t('sections.tickets.filterDialog.fields.status', { defaultValue: 'Status' })}</Label>
              <CustomSelect
                id="ticket-status-select"
                value={selectedStatus}
                onValueChange={(value) => setSelectedStatus(value)}
                options={[
                  { value: 'all', label: t('sections.tickets.filterDialog.fields.allStatuses', { defaultValue: 'All Statuses' }) },
                  ...statuses
                      .filter(s => !s.is_closed)
                      .map(status => ({ value: status.status_id, label: status.name }))
                ]}
                placeholder={t('sections.tickets.filterDialog.fields.statusPlaceholder', { defaultValue: 'Select Status...' })}
              />
            </div>
            {/* Priority Filter */}
            {priorities.length > 0 && (
              <div className="space-y-1">
                <Label htmlFor="ticket-priority-select" className="text-base font-semibold">{t('sections.tickets.filterDialog.fields.priority', { defaultValue: 'Priority' })}</Label>
                <CustomSelect
                  id="ticket-priority-select"
                  value={selectedPriorityId}
                  onValueChange={(value) => setSelectedPriorityId(value)}
                  options={[
                    { value: 'all', label: t('sections.tickets.filterDialog.fields.allPriorities', { defaultValue: 'All Priorities' }) },
                    ...priorities.map(p => ({
                      value: p.priority_id,
                      label: (
                        <span className="flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: p.color || '#94a3b8' }}
                          />
                          {p.priority_name}
                        </span>
                      ),
                      textValue: p.priority_name,
                    }))
                  ]}
                  placeholder={t('sections.tickets.filterDialog.fields.priorityPlaceholder', { defaultValue: 'Select Priority...' })}
                />
              </div>
            )}
          </div>

          {/* Due Date Range */}
          <div className="space-y-1">
             <Label htmlFor="ticket-due-date-range" className="text-base font-semibold">{t('sections.tickets.filterDialog.fields.dueDateRange', { defaultValue: 'Due Date Range' })}</Label>
             <StringDateRangePicker
                id="ticket-due-date-range"
                value={{
                    from: localFilters.dueDateStart ? localFilters.dueDateStart.split('T')[0] : '',
                    to: localFilters.dueDateEnd ? localFilters.dueDateEnd.split('T')[0] : '',
                }}
                onChange={handleDateChange}
             />
          </div>

          {/* Show Closed Tickets Filter */}
          <div className="pt-2">
             <Checkbox
                id="show-closed-tickets"
                label={t('sections.tickets.filterDialog.fields.showClosedTickets', { defaultValue: 'Show Closed Tickets' })}
                checked={localFilters.isClosed}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLocalFilters(prev => ({ ...prev, isClosed: e.target.checked }))}
              />
          </div>

        </div>
      </DialogContent>
    </Dialog>
  );
}
