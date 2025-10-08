'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "server/src/components/ui/Dialog";
import { Button } from "server/src/components/ui/Button";
import { Checkbox } from "server/src/components/ui/Checkbox";
import { Label } from "server/src/components/ui/Label";
import { Input } from "server/src/components/ui/Input";
import { StringDateRangePicker } from "server/src/components/ui/DateRangePicker";
import { ActivityFilters, ActivityPriority } from "server/src/interfaces/activity.interfaces";
import { IStatus } from "server/src/interfaces/status.interface";
import { IClient } from "server/src/interfaces/client.interfaces";
import { IContact } from "server/src/interfaces/contact.interfaces";
import { DateRange } from 'react-day-picker';
import { ISO8601String } from '@alga-psa/shared/types';
import { ClientPicker } from "server/src/components/clients/ClientPicker";
import { ContactPicker } from "server/src/components/ui/ContactPicker";
import CustomSelect from "server/src/components/ui/CustomSelect";

interface TicketSectionFiltersDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  initialFilters: Partial<ActivityFilters>;
  onApplyFilters: (filters: Partial<ActivityFilters>) => void;
  clients: IClient[];
  contacts: IContact[];
  statuses: IStatus[];
}

export function TicketSectionFiltersDialog({
  isOpen,
  onOpenChange,
  initialFilters,
  onApplyFilters,
  clients = [],
  contacts = [],
  statuses = [],
}: TicketSectionFiltersDialogProps) {
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
    const { status, ...rest } = initialFilters;
    setLocalFilters(rest);
    setSelectedStatus(status?.[0] || 'all');
  }, [initialFilters]);

  const toggleArrayFilter = <K extends keyof ActivityFilters>(
    key: K,
    value: string,
  ) => {
    // Ensure we only toggle array types like 'priority' here
    if (key === 'priority') {
        setLocalFilters((prev) => {
            const currentValues = (prev[key] as string[] | undefined) || [];
            const newValues = [...currentValues];
            const index = newValues.indexOf(value);

            if (index >= 0) {
                newValues.splice(index, 1);
            } else {
                newValues.push(value);
            }
            return { ...prev, [key]: newValues };
        });
    }
  };

  const isPrioritySelected = (value: ActivityPriority): boolean => {
    const currentValues = localFilters.priority || [];
    return currentValues.includes(value);
  };

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
    // Construct the final filters object, converting single status back to array
    const filtersToApply: Partial<ActivityFilters> = {
        ...localFilters,
        status: selectedStatus && selectedStatus !== 'all' ? [selectedStatus] : undefined,
    };

    if (filtersToApply.priority?.length === 0) delete filtersToApply.priority;
    if (!filtersToApply.clientId) delete filtersToApply.clientId;
    if (!filtersToApply.contactId) delete filtersToApply.contactId;
    if (!filtersToApply.status) delete filtersToApply.status; // Remove if undefined/empty array

    onApplyFilters(filtersToApply);
    onOpenChange(false);
  };

  const handleClear = () => {
    const clearedFilters: Omit<Partial<ActivityFilters>, 'status'> = {
      priority: [],
      isClosed: undefined,
      dueDateStart: undefined,
      dueDateEnd: undefined,
      clientId: undefined,
      contactId: undefined,
      // ticketNumber: undefined,
      search: undefined,
    };
    setLocalFilters(clearedFilters);
    setSelectedStatus('all');
  };


  return (
    <Dialog isOpen={isOpen} onClose={() => onOpenChange(false)}>
      <DialogContent className="sm:max-w-[700]">
        <DialogHeader>
          <DialogTitle>Filter Tickets</DialogTitle>
           <DialogDescription>
             Select criteria to filter ticket activities.
           </DialogDescription>
        </DialogHeader>
        <div className="py-2 space-y-4">

          {/* Search Filter */}
          <div className="space-y-1">
            <Label htmlFor="ticket-search" className="text-base font-semibold">Search</Label>
            <Input
              id="ticket-search"
              value={localFilters.search || ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleSingleFilterChange('search', e.target.value)}
              placeholder="Search title, description, ticket #"
            />
          </div>


          {/* Client, Contact, and Status Filters */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-0">
            <div className="space-y-1">
              <Label htmlFor="ticket-client-picker" className="text-base font-semibold">Client</Label>
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
              <Label htmlFor="ticket-contact-picker" className="text-base font-semibold">Contact</Label>
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
              <Label htmlFor="ticket-status-select" className="text-base font-semibold">Status</Label>
              <CustomSelect
                id="ticket-status-select"
                value={selectedStatus}
                onValueChange={(value) => setSelectedStatus(value)}
                options={[
                  { value: 'all', label: 'All Statuses' },
                  ...statuses
                      .filter(s => !s.is_closed)
                      .map(status => ({ value: status.status_id, label: status.name }))
                ]}
                placeholder="Select Status..."
              />
            </div>
          </div>

          {/* Priority Filters */}
          <div>
            <Label className="text-base font-semibold">Priority</Label>
            <div className="flex items-center space-x-4 pt-1">
              {[
                { value: ActivityPriority.LOW, label: 'Low' },
                { value: ActivityPriority.MEDIUM, label: 'Medium' },
                { value: ActivityPriority.HIGH, label: 'High' }
              ].map((option) => (
                 <Checkbox
                    key={option.value}
                    id={`priority-${option.value}`}
                    label={option.label}
                    checked={isPrioritySelected(option.value)}
                    onChange={() => toggleArrayFilter('priority', option.value)}
                  />
              ))}
            </div>
          </div>

          {/* Due Date Range */}
          <div className="space-y-1">
             <Label htmlFor="ticket-due-date-range" className="text-base font-semibold">Due Date Range</Label>
             <StringDateRangePicker
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
                label="Show Closed Tickets"
                checked={localFilters.isClosed}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLocalFilters(prev => ({ ...prev, isClosed: e.target.checked }))}
              />
          </div>

        </div>
        <DialogFooter>
           <div className="flex justify-between w-full">
             <Button id="ticket-filter-clear" variant="outline" onClick={handleClear}>Clear Filters</Button>
             <div>
               <Button id="ticket-filter-cancel" variant="ghost" className="mr-2" onClick={() => onOpenChange(false)}>Cancel</Button>
               <Button id="ticket-filter-apply" onClick={handleApply}>Apply Filters</Button>
             </div>
           </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
