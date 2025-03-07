import React, { useState } from 'react';
import { 
  ActivityFilters as ActivityFiltersType,
  ActivityPriority,
  ActivityType
} from '../../interfaces/activity.interfaces';
import { Button } from '../ui/Button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/Dialog';
import { Label } from '../ui/Label';
import { Checkbox } from '../ui/Checkbox';
import { Filter } from 'lucide-react';
import { DateRangePicker } from '../ui/DateRangePicker';
import { Input } from '../ui/Input';

interface ActivityFiltersProps {
  filters: ActivityFiltersType;
  onChange: (filters: ActivityFiltersType) => void;
}

export function ActivityFilters({ filters, onChange }: ActivityFiltersProps) {
  const [open, setOpen] = useState(false);
  const [localFilters, setLocalFilters] = useState<ActivityFiltersType>(filters);

  // Reset filters to initial state
  const handleReset = () => {
    const resetFilters: ActivityFiltersType = {
      types: [],
      status: [],
      priority: [],
      assignedTo: [],
      isClosed: false
    };
    setLocalFilters(resetFilters);
  };

  // Apply filters and close dialog
  const handleApply = () => {
    onChange(localFilters);
    setOpen(false);
  };

  // Update local filters state
  const handleFilterChange = <K extends keyof ActivityFiltersType>(
    key: K, 
    value: ActivityFiltersType[K]
  ) => {
    setLocalFilters(prev => ({
      ...prev,
      [key]: value
    }));
  };

  // Toggle a value in an array filter
  const toggleArrayFilter = <T extends string>(
    key: keyof ActivityFiltersType,
    value: T,
    currentValues: T[] = []
  ) => {
    const newValues = [...currentValues];
    const index = newValues.indexOf(value);
    
    if (index >= 0) {
      newValues.splice(index, 1);
    } else {
      newValues.push(value);
    }
    
    handleFilterChange(key, newValues as any);
  };

  // Check if a value is selected in an array filter
  const isSelected = <T extends string>(
    value: T,
    currentValues: T[] = []
  ): boolean => {
    return currentValues.includes(value);
  };

  return (
    <>
      <Button 
        id="activity-filters-button" 
        variant="outline" 
        size="sm"
        onClick={() => setOpen(true)}
      >
        <Filter className="h-4 w-4 mr-2" />
        Filters
        {Object.values(localFilters).some(val => 
          Array.isArray(val) ? val.length > 0 : Boolean(val)
        ) && (
          <span className="ml-1 rounded-full bg-primary w-2 h-2" />
        )}
      </Button>

      <Dialog isOpen={open} onClose={() => setOpen(false)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Filter Activities</DialogTitle>
            <DialogDescription>
              Select criteria to filter your activities
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Activity Types Filter */}
            <div className="space-y-2">
              <Label htmlFor="activity-types">Activity Types</Label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { value: ActivityType.SCHEDULE, label: 'Schedule' },
                  { value: ActivityType.PROJECT_TASK, label: 'Project Tasks' },
                  { value: ActivityType.TICKET, label: 'Tickets' },
                  { value: ActivityType.TIME_ENTRY, label: 'Time Entries' },
                  { value: ActivityType.WORKFLOW_TASK, label: 'Workflow Tasks' }
                ].map(option => (
                  <div key={option.value} className="flex items-center space-x-2">
                    <Checkbox
                      id={`activity-type-${option.value}`}
                      checked={isSelected(option.value, localFilters.types)}
                      onChange={() => toggleArrayFilter('types', option.value, localFilters.types)}
                    />
                    <Label htmlFor={`activity-type-${option.value}`}>{option.label}</Label>
                  </div>
                ))}
              </div>
            </div>
            
            {/* Priority Filter */}
            <div className="space-y-2">
              <Label htmlFor="priority">Priority</Label>
              <div className="flex space-x-4">
                {[
                  { value: ActivityPriority.LOW, label: 'Low' },
                  { value: ActivityPriority.MEDIUM, label: 'Medium' },
                  { value: ActivityPriority.HIGH, label: 'High' }
                ].map(option => (
                  <div key={option.value} className="flex items-center space-x-2">
                    <Checkbox
                      id={`priority-${option.value}`}
                      checked={isSelected(option.value, localFilters.priority)}
                      onChange={() => toggleArrayFilter('priority', option.value, localFilters.priority)}
                    />
                    <Label htmlFor={`priority-${option.value}`}>{option.label}</Label>
                  </div>
                ))}
              </div>
            </div>
            
            {/* Date Range Filter */}
            <div className="space-y-2">
              <Label>Due Date Range</Label>
              <DateRangePicker
                value={{
                  from: localFilters.dueDateStart ? new Date(localFilters.dueDateStart).toISOString().split('T')[0] : '',
                  to: localFilters.dueDateEnd ? new Date(localFilters.dueDateEnd).toISOString().split('T')[0] : ''
                }}
                onChange={(range) => {
                  handleFilterChange('dueDateStart', range.from ? new Date(range.from).toISOString() as any : undefined);
                  handleFilterChange('dueDateEnd', range.to ? new Date(range.to).toISOString() as any : undefined);
                }}
              />
            </div>
            
            {/* Show Closed Activities */}
            <div className="flex items-center space-x-2">
              <Checkbox
                id="show-closed"
                checked={localFilters.isClosed}
                onChange={(e) =>
                  handleFilterChange('isClosed', e.target.checked)
                }
              />
              <Label htmlFor="show-closed">Show closed activities</Label>
            </div>
          </div>

          <DialogFooter>
            <div className="flex justify-between w-full">
              <Button
                id="reset-filters-button"
                type="button"
                variant="outline"
                onClick={handleReset}
              >
                Reset
              </Button>
              <Button
                id="apply-filters-button"
                type="submit"
                onClick={handleApply}
              >
                Apply Filters
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}