'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, MoreVertical, Clock, Calendar, Star } from 'lucide-react';
import toast from 'react-hot-toast';

import { Button } from '@alga-psa/ui/components/Button';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Switch } from '@alga-psa/ui/components/Switch';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import GenericDialog from '@alga-psa/ui/components/GenericDialog';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@alga-psa/ui/components/DropdownMenu';

import {
  IBusinessHoursSchedule,
  IBusinessHoursScheduleWithEntries,
  IBusinessHoursEntryInput,
  IHoliday,
  IHolidayInput
} from '../types';
import {
  getBusinessHoursSchedules,
  getBusinessHoursScheduleById,
  createBusinessHoursSchedule,
  updateBusinessHoursSchedule,
  deleteBusinessHoursSchedule,
  upsertBusinessHoursEntries,
  createHoliday,
  deleteHoliday,
  createDefaultBusinessHoursSchedule
} from '../actions';
import { ColumnDefinition } from '@alga-psa/types';

// Common timezones
const TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern Time (America/New_York)' },
  { value: 'America/Chicago', label: 'Central Time (America/Chicago)' },
  { value: 'America/Denver', label: 'Mountain Time (America/Denver)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (America/Los_Angeles)' },
  { value: 'Europe/London', label: 'London (Europe/London)' },
  { value: 'Europe/Paris', label: 'Paris (Europe/Paris)' },
  { value: 'Asia/Tokyo', label: 'Tokyo (Asia/Tokyo)' },
  { value: 'Australia/Sydney', label: 'Sydney (Australia/Sydney)' },
  { value: 'UTC', label: 'UTC' },
];

// Day names with Sunday = 0
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Default schedule entry template
const getDefaultEntries = (): IBusinessHoursEntryInput[] => [
  { day_of_week: 0, start_time: '08:00', end_time: '18:00', is_enabled: false }, // Sunday
  { day_of_week: 1, start_time: '08:00', end_time: '18:00', is_enabled: true },  // Monday
  { day_of_week: 2, start_time: '08:00', end_time: '18:00', is_enabled: true },  // Tuesday
  { day_of_week: 3, start_time: '08:00', end_time: '18:00', is_enabled: true },  // Wednesday
  { day_of_week: 4, start_time: '08:00', end_time: '18:00', is_enabled: true },  // Thursday
  { day_of_week: 5, start_time: '08:00', end_time: '18:00', is_enabled: true },  // Friday
  { day_of_week: 6, start_time: '08:00', end_time: '18:00', is_enabled: false }, // Saturday
];

interface ScheduleFormData {
  schedule_name: string;
  timezone: string;
  is_default: boolean;
  is_24x7: boolean;
  entries: IBusinessHoursEntryInput[];
}

interface HolidayFormData {
  holiday_name: string;
  holiday_date: string;
  is_recurring: boolean;
}

export function BusinessHoursSettings() {
  // Main state
  const [schedules, setSchedules] = useState<IBusinessHoursSchedule[]>([]);
  const [selectedSchedule, setSelectedSchedule] = useState<IBusinessHoursScheduleWithEntries | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Schedule dialog state
  const [isScheduleDialogOpen, setIsScheduleDialogOpen] = useState(false);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [scheduleFormData, setScheduleFormData] = useState<ScheduleFormData>({
    schedule_name: '',
    timezone: 'America/New_York',
    is_default: false,
    is_24x7: false,
    entries: getDefaultEntries(),
  });
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);

  // Delete schedule dialog state
  const [deleteScheduleDialog, setDeleteScheduleDialog] = useState<{
    isOpen: boolean;
    scheduleId: string;
    scheduleName: string;
  }>({ isOpen: false, scheduleId: '', scheduleName: '' });

  // Holiday dialog state
  const [isHolidayDialogOpen, setIsHolidayDialogOpen] = useState(false);
  const [holidayFormData, setHolidayFormData] = useState<HolidayFormData>({
    holiday_name: '',
    holiday_date: '',
    is_recurring: false,
  });
  const [isSavingHoliday, setIsSavingHoliday] = useState(false);

  // Delete holiday dialog state
  const [deleteHolidayDialog, setDeleteHolidayDialog] = useState<{
    isOpen: boolean;
    holidayId: string;
    holidayName: string;
  }>({ isOpen: false, holidayId: '', holidayName: '' });

  // Pagination state for schedules list
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
  };

  // Fetch schedules
  const fetchSchedules = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getBusinessHoursSchedules();
      setSchedules(data);
      setError(null);
    } catch (err) {
      console.error('Error fetching business hours schedules:', err);
      setError('Failed to load business hours schedules');
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch schedule details
  const fetchScheduleDetails = useCallback(async (scheduleId: string) => {
    try {
      const data = await getBusinessHoursScheduleById(scheduleId);
      setSelectedSchedule(data);
    } catch (err) {
      console.error('Error fetching schedule details:', err);
      toast.error('Failed to load schedule details');
    }
  }, []);

  useEffect(() => {
    fetchSchedules();
  }, [fetchSchedules]);

  // Open schedule dialog for creating
  const handleOpenCreateScheduleDialog = () => {
    setEditingScheduleId(null);
    setScheduleFormData({
      schedule_name: '',
      timezone: 'America/New_York',
      is_default: schedules.length === 0,
      is_24x7: false,
      entries: getDefaultEntries(),
    });
    setIsScheduleDialogOpen(true);
    setError(null);
  };

  // Open schedule dialog for editing
  const handleOpenEditScheduleDialog = async (schedule: IBusinessHoursSchedule) => {
    try {
      const fullSchedule = await getBusinessHoursScheduleById(schedule.schedule_id);
      if (!fullSchedule) {
        toast.error('Schedule not found');
        return;
      }

      setEditingScheduleId(schedule.schedule_id);

      // Map existing entries or use defaults for missing days
      const entriesMap = new Map(fullSchedule.entries.map(e => [e.day_of_week, e]));
      const entries: IBusinessHoursEntryInput[] = [];
      for (let i = 0; i < 7; i++) {
        const existing = entriesMap.get(i);
        if (existing) {
          entries.push({
            day_of_week: existing.day_of_week,
            start_time: existing.start_time,
            end_time: existing.end_time,
            is_enabled: existing.is_enabled,
          });
        } else {
          const defaultEntry = getDefaultEntries()[i];
          entries.push(defaultEntry);
        }
      }

      setScheduleFormData({
        schedule_name: fullSchedule.schedule_name,
        timezone: fullSchedule.timezone,
        is_default: fullSchedule.is_default,
        is_24x7: fullSchedule.is_24x7,
        entries,
      });
      setSelectedSchedule(fullSchedule);
      setIsScheduleDialogOpen(true);
      setError(null);
    } catch (err) {
      console.error('Error loading schedule for editing:', err);
      toast.error('Failed to load schedule details');
    }
  };

  // Close schedule dialog
  const handleCloseScheduleDialog = () => {
    setIsScheduleDialogOpen(false);
    setEditingScheduleId(null);
    setError(null);
  };

  // Save schedule
  const handleSaveSchedule = async () => {
    // Validation
    if (!scheduleFormData.schedule_name.trim()) {
      setError('Schedule name is required');
      return;
    }

    // Validate times
    if (!scheduleFormData.is_24x7) {
      for (const entry of scheduleFormData.entries) {
        if (entry.is_enabled && entry.start_time >= entry.end_time) {
          setError(`Invalid time range for ${DAY_NAMES[entry.day_of_week]}: End time must be after start time`);
          return;
        }
      }
    }

    setIsSavingSchedule(true);
    setError(null);

    try {
      if (editingScheduleId) {
        // Update existing schedule
        await updateBusinessHoursSchedule(editingScheduleId, {
          schedule_name: scheduleFormData.schedule_name,
          timezone: scheduleFormData.timezone,
          is_default: scheduleFormData.is_default,
          is_24x7: scheduleFormData.is_24x7,
        });

        // Update entries if not 24x7
        if (!scheduleFormData.is_24x7) {
          await upsertBusinessHoursEntries(editingScheduleId, scheduleFormData.entries);
        }

        toast.success('Schedule updated successfully');
      } else {
        // Create new schedule
        await createBusinessHoursSchedule(
          {
            schedule_name: scheduleFormData.schedule_name,
            timezone: scheduleFormData.timezone,
            is_default: scheduleFormData.is_default,
            is_24x7: scheduleFormData.is_24x7,
          },
          scheduleFormData.is_24x7 ? undefined : scheduleFormData.entries
        );

        toast.success('Schedule created successfully');
      }

      handleCloseScheduleDialog();
      await fetchSchedules();
    } catch (err) {
      console.error('Error saving schedule:', err);
      setError(err instanceof Error ? err.message : 'Failed to save schedule');
    } finally {
      setIsSavingSchedule(false);
    }
  };

  // Delete schedule
  const handleDeleteSchedule = async () => {
    if (!deleteScheduleDialog.scheduleId) return;

    try {
      await deleteBusinessHoursSchedule(deleteScheduleDialog.scheduleId);
      toast.success('Schedule deleted successfully');
      setDeleteScheduleDialog({ isOpen: false, scheduleId: '', scheduleName: '' });

      // Clear selection if deleted schedule was selected
      if (selectedSchedule?.schedule_id === deleteScheduleDialog.scheduleId) {
        setSelectedSchedule(null);
      }

      await fetchSchedules();
    } catch (err) {
      console.error('Error deleting schedule:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to delete schedule');
    }
  };

  // Create default schedule
  const handleCreateDefaultSchedule = async () => {
    try {
      setLoading(true);
      await createDefaultBusinessHoursSchedule();
      toast.success('Default business hours schedule created');
      await fetchSchedules();
    } catch (err) {
      console.error('Error creating default schedule:', err);
      toast.error('Failed to create default schedule');
    } finally {
      setLoading(false);
    }
  };

  // Update entry field
  const updateEntry = (dayOfWeek: number, field: keyof IBusinessHoursEntryInput, value: string | boolean) => {
    setScheduleFormData(prev => ({
      ...prev,
      entries: prev.entries.map(entry =>
        entry.day_of_week === dayOfWeek
          ? { ...entry, [field]: value }
          : entry
      ),
    }));
  };

  // Holiday handlers
  const handleOpenHolidayDialog = () => {
    if (!selectedSchedule) {
      toast.error('Please select a schedule first');
      return;
    }
    setHolidayFormData({
      holiday_name: '',
      holiday_date: '',
      is_recurring: false,
    });
    setIsHolidayDialogOpen(true);
  };

  const handleCloseHolidayDialog = () => {
    setIsHolidayDialogOpen(false);
  };

  const handleSaveHoliday = async () => {
    if (!selectedSchedule) return;

    if (!holidayFormData.holiday_name.trim()) {
      toast.error('Holiday name is required');
      return;
    }

    if (!holidayFormData.holiday_date) {
      toast.error('Holiday date is required');
      return;
    }

    setIsSavingHoliday(true);

    try {
      await createHoliday({
        holiday_name: holidayFormData.holiday_name,
        holiday_date: holidayFormData.holiday_date,
        is_recurring: holidayFormData.is_recurring,
        schedule_id: selectedSchedule.schedule_id,
      });

      toast.success('Holiday added successfully');
      handleCloseHolidayDialog();
      await fetchScheduleDetails(selectedSchedule.schedule_id);
    } catch (err) {
      console.error('Error adding holiday:', err);
      toast.error('Failed to add holiday');
    } finally {
      setIsSavingHoliday(false);
    }
  };

  const handleDeleteHoliday = async () => {
    if (!deleteHolidayDialog.holidayId) return;

    try {
      await deleteHoliday(deleteHolidayDialog.holidayId);
      toast.success('Holiday deleted successfully');
      setDeleteHolidayDialog({ isOpen: false, holidayId: '', holidayName: '' });

      if (selectedSchedule) {
        await fetchScheduleDetails(selectedSchedule.schedule_id);
      }
    } catch (err) {
      console.error('Error deleting holiday:', err);
      toast.error('Failed to delete holiday');
    }
  };

  // Table columns for schedules
  const scheduleColumns: ColumnDefinition<IBusinessHoursSchedule>[] = [
    {
      title: 'Name',
      dataIndex: 'schedule_name',
      render: (value: string, record: IBusinessHoursSchedule) => (
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-gray-400" />
          <span className="font-medium">{value}</span>
          {record.is_default && (
            <Badge variant="default" className="bg-blue-500">Default</Badge>
          )}
          {record.is_24x7 && (
            <Badge variant="outline">24/7</Badge>
          )}
        </div>
      ),
    },
    {
      title: 'Timezone',
      dataIndex: 'timezone',
      render: (value: string) => (
        <span className="text-gray-600">{value}</span>
      ),
    },
    {
      title: 'Actions',
      dataIndex: 'schedule_id',
      width: '80px',
      render: (_: unknown, record: IBusinessHoursSchedule) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="h-8 w-8 p-0"
              id={`schedule-actions-${record.schedule_id}`}
              onClick={(e) => e.stopPropagation()}
            >
              <span className="sr-only">Open menu</span>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              id={`edit-schedule-${record.schedule_id}`}
              onClick={(e) => {
                e.stopPropagation();
                handleOpenEditScheduleDialog(record);
              }}
            >
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              id={`view-schedule-${record.schedule_id}`}
              onClick={(e) => {
                e.stopPropagation();
                fetchScheduleDetails(record.schedule_id);
              }}
            >
              View Details
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              id={`delete-schedule-${record.schedule_id}`}
              className="text-red-600 focus:text-red-600"
              onClick={(e) => {
                e.stopPropagation();
                setDeleteScheduleDialog({
                  isOpen: true,
                  scheduleId: record.schedule_id,
                  scheduleName: record.schedule_name,
                });
              }}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  // Table columns for holidays
  const holidayColumns: ColumnDefinition<IHoliday>[] = [
    {
      title: 'Holiday Name',
      dataIndex: 'holiday_name',
      render: (value: string, record: IHoliday) => (
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-gray-400" />
          <span>{value}</span>
          {record.is_recurring && (
            <Badge variant="outline">Recurring</Badge>
          )}
        </div>
      ),
    },
    {
      title: 'Date',
      dataIndex: 'holiday_date',
      render: (value: string) => (
        <span className="text-gray-600">
          {new Date(value).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })}
        </span>
      ),
    },
    {
      title: 'Actions',
      dataIndex: 'holiday_id',
      width: '80px',
      render: (_: unknown, record: IHoliday) => (
        <Button
          variant="ghost"
          className="h-8 w-8 p-0 text-red-600 hover:text-red-700"
          id={`delete-holiday-${record.holiday_id}`}
          onClick={(e) => {
            e.stopPropagation();
            setDeleteHolidayDialog({
              isOpen: true,
              holidayId: record.holiday_id,
              holidayName: record.holiday_name,
            });
          }}
        >
          <span className="sr-only">Delete</span>
          <MoreVertical className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  if (loading && schedules.length === 0) {
    return (
      <div className="bg-white p-6 rounded-lg shadow-sm">
        <div className="flex items-center justify-center py-8">
          <LoadingIndicator
            layout="stacked"
            text="Loading business hours schedules..."
            spinnerProps={{ size: 'md' }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm space-y-6" id="business-hours-settings">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-800">Business Hours Schedules</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Define when your support team is available for SLA calculations
          </p>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Empty state */}
      {schedules.length === 0 && !loading && (
        <div className="text-center p-8 border border-dashed rounded-lg">
          <Clock className="h-12 w-12 mx-auto text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No Business Hours Schedules</h3>
          <p className="text-sm text-gray-500 mb-4">
            Create your first business hours schedule to start calculating SLA times.
          </p>
          <div className="flex gap-2 justify-center">
            <Button
              id="create-default-schedule"
              onClick={handleCreateDefaultSchedule}
              className="bg-primary-500 text-white hover:bg-primary-600"
            >
              <Star className="h-4 w-4 mr-2" />
              Create Default Schedule
            </Button>
            <Button
              id="create-custom-schedule"
              variant="outline"
              onClick={handleOpenCreateScheduleDialog}
            >
              <Plus className="h-4 w-4 mr-2" />
              Create Custom Schedule
            </Button>
          </div>
        </div>
      )}

      {/* Schedules list */}
      {schedules.length > 0 && (
        <>
          <DataTable
            id="business-hours-schedules-table"
            data={schedules}
            columns={scheduleColumns}
            pagination={true}
            currentPage={currentPage}
            onPageChange={setCurrentPage}
            pageSize={pageSize}
            onItemsPerPageChange={handlePageSizeChange}
            onRowClick={(row) => fetchScheduleDetails(row.schedule_id)}
          />
          <div className="flex gap-2">
            <Button
              id="add-schedule-button"
              onClick={handleOpenCreateScheduleDialog}
              className="bg-primary-500 text-white hover:bg-primary-600"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Schedule
            </Button>
          </div>
        </>
      )}

      {/* Selected schedule details */}
      {selectedSchedule && (
        <div className="border-t pt-6 mt-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h4 className="text-lg font-medium text-gray-800">
                {selectedSchedule.schedule_name}
                {selectedSchedule.is_default && (
                  <Badge variant="default" className="bg-blue-500 ml-2">Default</Badge>
                )}
              </h4>
              <p className="text-sm text-gray-500">Timezone: {selectedSchedule.timezone}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedSchedule(null)}
              id="close-schedule-details"
            >
              Close
            </Button>
          </div>

          {/* Daily hours */}
          {!selectedSchedule.is_24x7 && (
            <div className="mb-6">
              <h5 className="text-sm font-medium text-gray-700 mb-3">Working Hours</h5>
              <div className="space-y-2">
                {selectedSchedule.entries.sort((a, b) => a.day_of_week - b.day_of_week).map((entry) => (
                  <div
                    key={entry.entry_id}
                    className={`flex items-center gap-4 p-2 rounded ${
                      entry.is_enabled ? 'bg-green-50' : 'bg-gray-50'
                    }`}
                  >
                    <span className="w-24 font-medium">{DAY_NAMES[entry.day_of_week]}</span>
                    {entry.is_enabled ? (
                      <span className="text-gray-700">
                        {entry.start_time} - {entry.end_time}
                      </span>
                    ) : (
                      <span className="text-gray-400 italic">Closed</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {selectedSchedule.is_24x7 && (
            <div className="mb-6 p-4 bg-blue-50 rounded-lg">
              <p className="text-blue-700 font-medium">This is a 24/7 schedule - available all day, every day.</p>
            </div>
          )}

          {/* Holidays */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h5 className="text-sm font-medium text-gray-700">Holidays</h5>
              <Button
                variant="outline"
                size="sm"
                onClick={handleOpenHolidayDialog}
                id="add-holiday-button"
              >
                <Plus className="h-4 w-4 mr-1" />
                Add Holiday
              </Button>
            </div>

            {(!selectedSchedule.holidays || selectedSchedule.holidays.length === 0) ? (
              <div className="text-center p-4 border border-dashed rounded-lg">
                <p className="text-sm text-gray-500">No holidays defined for this schedule.</p>
              </div>
            ) : (
              <DataTable
                id="holidays-table"
                data={selectedSchedule.holidays}
                columns={holidayColumns}
                pagination={false}
              />
            )}
          </div>
        </div>
      )}

      {/* Schedule Dialog */}
      <GenericDialog
        isOpen={isScheduleDialogOpen}
        onClose={handleCloseScheduleDialog}
        title={editingScheduleId ? 'Edit Schedule' : 'Create Schedule'}
        id="schedule-dialog"
      >
        <div className="space-y-4 py-4 max-h-[70vh] overflow-y-auto">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Schedule Name */}
          <div className="space-y-1">
            <Label htmlFor="schedule-name-field">Schedule Name *</Label>
            <Input
              id="schedule-name-field"
              value={scheduleFormData.schedule_name}
              onChange={(e) => setScheduleFormData(prev => ({ ...prev, schedule_name: e.target.value }))}
              placeholder="e.g., Standard Business Hours"
              disabled={isSavingSchedule}
            />
          </div>

          {/* Timezone */}
          <div className="space-y-1">
            <Label>Timezone *</Label>
            <CustomSelect
              id="schedule-timezone-field"
              options={TIMEZONES}
              value={scheduleFormData.timezone}
              onValueChange={(value) => setScheduleFormData(prev => ({ ...prev, timezone: value }))}
              placeholder="Select timezone"
              disabled={isSavingSchedule}
            />
          </div>

          {/* Is 24/7 */}
          <div className="flex items-center gap-2">
            <Switch
              id="schedule-is-24x7-field"
              checked={scheduleFormData.is_24x7}
              onCheckedChange={(checked) => setScheduleFormData(prev => ({ ...prev, is_24x7: checked }))}
              disabled={isSavingSchedule}
            />
            <Label htmlFor="schedule-is-24x7-field">24/7 Schedule (always available)</Label>
          </div>

          {/* Is Default */}
          <div className="flex items-center gap-2">
            <Switch
              id="schedule-is-default-field"
              checked={scheduleFormData.is_default}
              onCheckedChange={(checked) => setScheduleFormData(prev => ({ ...prev, is_default: checked }))}
              disabled={isSavingSchedule}
            />
            <Label htmlFor="schedule-is-default-field">Set as default schedule</Label>
          </div>

          {/* Daily hours grid */}
          {!scheduleFormData.is_24x7 && (
            <div className="space-y-2">
              <Label>Daily Hours</Label>
              <div className="border rounded-lg overflow-hidden">
                <div className="bg-gray-50 px-3 py-2 grid grid-cols-4 gap-2 text-xs font-medium text-gray-600 border-b">
                  <span>Day</span>
                  <span>Enabled</span>
                  <span>Start Time</span>
                  <span>End Time</span>
                </div>
                {scheduleFormData.entries.map((entry) => (
                  <div
                    key={entry.day_of_week}
                    className={`px-3 py-2 grid grid-cols-4 gap-2 items-center border-b last:border-b-0 ${
                      entry.is_enabled ? 'bg-white' : 'bg-gray-50'
                    }`}
                  >
                    <span className="text-sm font-medium">{DAY_NAMES[entry.day_of_week]}</span>
                    <div className="[&>div]:mb-0">
                      <Checkbox
                        id={`day-enabled-${entry.day_of_week}`}
                        checked={entry.is_enabled}
                        onChange={(e) => updateEntry(entry.day_of_week, 'is_enabled', (e.target as HTMLInputElement).checked)}
                        disabled={isSavingSchedule}
                      />
                    </div>
                    <Input
                      id={`day-start-${entry.day_of_week}`}
                      type="time"
                      value={entry.start_time}
                      onChange={(e) => updateEntry(entry.day_of_week, 'start_time', e.target.value)}
                      disabled={isSavingSchedule || !entry.is_enabled}
                      className="h-8 text-sm"
                    />
                    <Input
                      id={`day-end-${entry.day_of_week}`}
                      type="time"
                      value={entry.end_time}
                      onChange={(e) => updateEntry(entry.day_of_week, 'end_time', e.target.value)}
                      disabled={isSavingSchedule || !entry.is_enabled}
                      className="h-8 text-sm"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Dialog actions */}
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button
              variant="outline"
              onClick={handleCloseScheduleDialog}
              disabled={isSavingSchedule}
              id="schedule-dialog-cancel"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveSchedule}
              disabled={isSavingSchedule}
              id="schedule-dialog-save"
            >
              {isSavingSchedule ? 'Saving...' : (editingScheduleId ? 'Update' : 'Create')}
            </Button>
          </div>
        </div>
      </GenericDialog>

      {/* Holiday Dialog */}
      <GenericDialog
        isOpen={isHolidayDialogOpen}
        onClose={handleCloseHolidayDialog}
        title="Add Holiday"
        id="holiday-dialog"
      >
        <div className="space-y-4 py-4">
          {/* Holiday Name */}
          <div className="space-y-1">
            <Label htmlFor="holiday-name-field">Holiday Name *</Label>
            <Input
              id="holiday-name-field"
              value={holidayFormData.holiday_name}
              onChange={(e) => setHolidayFormData(prev => ({ ...prev, holiday_name: e.target.value }))}
              placeholder="e.g., Christmas Day"
              disabled={isSavingHoliday}
            />
          </div>

          {/* Holiday Date */}
          <div className="space-y-1">
            <Label htmlFor="holiday-date-field">Date *</Label>
            <Input
              id="holiday-date-field"
              type="date"
              value={holidayFormData.holiday_date}
              onChange={(e) => setHolidayFormData(prev => ({ ...prev, holiday_date: e.target.value }))}
              disabled={isSavingHoliday}
            />
          </div>

          {/* Is Recurring */}
          <div className="flex items-center gap-2">
            <Checkbox
              id="holiday-is-recurring-field"
              checked={holidayFormData.is_recurring}
              onChange={(e) => setHolidayFormData(prev => ({
                ...prev,
                is_recurring: (e.target as HTMLInputElement).checked
              }))}
              disabled={isSavingHoliday}
            />
            <Label htmlFor="holiday-is-recurring-field">Repeats annually</Label>
          </div>

          {/* Dialog actions */}
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button
              variant="outline"
              onClick={handleCloseHolidayDialog}
              disabled={isSavingHoliday}
              id="holiday-dialog-cancel"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveHoliday}
              disabled={isSavingHoliday}
              id="holiday-dialog-save"
            >
              {isSavingHoliday ? 'Adding...' : 'Add Holiday'}
            </Button>
          </div>
        </div>
      </GenericDialog>

      {/* Delete Schedule Confirmation */}
      <ConfirmationDialog
        isOpen={deleteScheduleDialog.isOpen}
        onClose={() => setDeleteScheduleDialog({ isOpen: false, scheduleId: '', scheduleName: '' })}
        onConfirm={handleDeleteSchedule}
        title="Delete Schedule"
        message={`Are you sure you want to delete "${deleteScheduleDialog.scheduleName}"? This will also delete all associated holidays. This action cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />

      {/* Delete Holiday Confirmation */}
      <ConfirmationDialog
        isOpen={deleteHolidayDialog.isOpen}
        onClose={() => setDeleteHolidayDialog({ isOpen: false, holidayId: '', holidayName: '' })}
        onConfirm={handleDeleteHoliday}
        title="Delete Holiday"
        message={`Are you sure you want to delete "${deleteHolidayDialog.holidayName}"? This action cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />
    </div>
  );
}

export default BusinessHoursSettings;
