'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from 'server/src/components/ui/Tabs';
import { Input } from 'server/src/components/ui/Input';
import { Button } from 'server/src/components/ui/Button';
import { Label } from 'server/src/components/ui/Label';
import { Switch } from 'server/src/components/ui/Switch';
import CustomSelect, { SelectOption } from 'server/src/components/ui/CustomSelect';
import { TimePicker } from 'server/src/components/ui/TimePicker';
import { Calendar } from 'server/src/components/ui/Calendar';
import { Badge } from 'server/src/components/ui/Badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from 'server/src/components/ui/Table';
import toast from 'react-hot-toast';
import { Plus, Trash2, Save } from 'lucide-react';
import {
  getAvailabilitySettings,
  createOrUpdateAvailabilitySetting,
  deleteAvailabilitySetting,
  getAvailabilityExceptions,
  addAvailabilityException,
  deleteAvailabilityException,
  IAvailabilitySetting,
  IAvailabilityException
} from 'server/src/lib/actions/availabilitySettingsActions';
import { getAllUsers } from 'server/src/lib/actions/user-actions/userActions';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { getAllServiceCategories } from 'server/src/lib/actions/serviceActions';
import { IServiceCategory } from 'server/src/interfaces/billing.interfaces';

const DAYS_OF_WEEK = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' }
];

interface UserHoursSetting {
  day_of_week: number;
  is_available: boolean;
  start_time: string;
  end_time: string;
}

export default function AvailabilitySettings() {
  const [activeTab, setActiveTab] = useState('general');
  const [isLoading, setIsLoading] = useState(true);

  // General settings state
  const [defaultAdvanceBookingDays, setDefaultAdvanceBookingDays] = useState('30');
  const [defaultMinimumNoticeHours, setDefaultMinimumNoticeHours] = useState('24');
  const [defaultBufferBefore, setDefaultBufferBefore] = useState('0');
  const [defaultBufferAfter, setDefaultBufferAfter] = useState('0');

  // User hours state
  const [users, setUsers] = useState<Omit<IUserWithRoles, 'tenant'>[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [userHours, setUserHours] = useState<Record<number, UserHoursSetting>>({});

  // Service rules state
  const [services, setServices] = useState<IServiceCategory[]>([]);
  const [selectedServiceId, setSelectedServiceId] = useState<string>('');
  const [serviceSettings, setServiceSettings] = useState<Record<string, IAvailabilitySetting>>({});

  // Exceptions state
  const [exceptions, setExceptions] = useState<IAvailabilityException[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [exceptionUserId, setExceptionUserId] = useState<string>('');
  const [exceptionReason, setExceptionReason] = useState('');
  const [exceptionIsAvailable, setExceptionIsAvailable] = useState(false);

  useEffect(() => {
    loadInitialData();
  }, []);

  const loadInitialData = async () => {
    setIsLoading(true);
    try {
      // Load users
      const fetchedUsers = await getAllUsers(false, 'internal');
      setUsers(fetchedUsers);

      // Load services
      const fetchedServices = await getAllServiceCategories();
      setServices(fetchedServices);

      // Load availability settings
      const settingsResult = await getAvailabilitySettings();
      if (settingsResult.success && settingsResult.data) {
        processSettings(settingsResult.data);
      }

      // Load exceptions
      const exceptionsResult = await getAvailabilityExceptions();
      if (exceptionsResult.success && exceptionsResult.data) {
        setExceptions(exceptionsResult.data);
      }
    } catch (error) {
      console.error('Failed to load availability settings:', error);
      toast.error('Failed to load settings');
    } finally {
      setIsLoading(false);
    }
  };

  const processSettings = (settings: IAvailabilitySetting[]) => {
    settings.forEach(setting => {
      if (setting.setting_type === 'general_settings') {
        if (setting.advance_booking_days) setDefaultAdvanceBookingDays(String(setting.advance_booking_days));
        if (setting.minimum_notice_hours) setDefaultMinimumNoticeHours(String(setting.minimum_notice_hours));
        if (setting.buffer_before_minutes) setDefaultBufferBefore(String(setting.buffer_before_minutes));
        if (setting.buffer_after_minutes) setDefaultBufferAfter(String(setting.buffer_after_minutes));
      }
    });
  };

  const loadUserHours = async (userId: string) => {
    const result = await getAvailabilitySettings({
      setting_type: 'user_hours',
      user_id: userId
    });

    if (result.success && result.data) {
      const hoursMap: Record<number, UserHoursSetting> = {};
      result.data.forEach(setting => {
        if (setting.day_of_week !== undefined && setting.day_of_week !== null) {
          hoursMap[setting.day_of_week] = {
            day_of_week: setting.day_of_week,
            is_available: setting.is_available,
            start_time: setting.start_time || '09:00',
            end_time: setting.end_time || '17:00'
          };
        }
      });
      setUserHours(hoursMap);
    } else {
      // Initialize with default hours
      const defaultHours: Record<number, UserHoursSetting> = {};
      for (let day = 1; day <= 5; day++) {
        defaultHours[day] = {
          day_of_week: day,
          is_available: true,
          start_time: '09:00',
          end_time: '17:00'
        };
      }
      defaultHours[0] = { day_of_week: 0, is_available: false, start_time: '09:00', end_time: '17:00' };
      defaultHours[6] = { day_of_week: 6, is_available: false, start_time: '09:00', end_time: '17:00' };
      setUserHours(defaultHours);
    }
  };

  const loadServiceRules = async (serviceId: string) => {
    const result = await getAvailabilitySettings({
      setting_type: 'service_rules',
      service_id: serviceId
    });

    if (result.success && result.data && result.data.length > 0) {
      const settingsMap: Record<string, IAvailabilitySetting> = {};
      result.data.forEach(setting => {
        if (setting.service_id) {
          settingsMap[setting.service_id] = setting;
        }
      });
      setServiceSettings(settingsMap);
    }
  };

  useEffect(() => {
    if (selectedUserId && activeTab === 'user-hours') {
      loadUserHours(selectedUserId);
    }
  }, [selectedUserId, activeTab]);

  useEffect(() => {
    if (selectedServiceId && activeTab === 'service-rules') {
      loadServiceRules(selectedServiceId);
    }
  }, [selectedServiceId, activeTab]);

  const handleSaveGeneralSettings = async () => {
    try {
      const result = await createOrUpdateAvailabilitySetting({
        setting_type: 'general_settings',
        is_available: true,
        advance_booking_days: parseInt(defaultAdvanceBookingDays) || 30,
        minimum_notice_hours: parseInt(defaultMinimumNoticeHours) || 24,
        buffer_before_minutes: parseInt(defaultBufferBefore) || 0,
        buffer_after_minutes: parseInt(defaultBufferAfter) || 0
      });

      if (result.success) {
        toast.success('General settings saved');
      } else {
        toast.error(result.error || 'Failed to save settings');
      }
    } catch (error) {
      console.error('Failed to save general settings:', error);
      toast.error('Failed to save settings');
    }
  };

  const handleSaveUserHours = async () => {
    if (!selectedUserId) {
      toast.error('Please select a user');
      return;
    }

    try {
      for (const [dayStr, hours] of Object.entries(userHours)) {
        const day = parseInt(dayStr);
        await createOrUpdateAvailabilitySetting({
          setting_type: 'user_hours',
          user_id: selectedUserId,
          day_of_week: day,
          is_available: hours.is_available,
          start_time: hours.start_time,
          end_time: hours.end_time
        });
      }
      toast.success('User hours saved');
    } catch (error) {
      console.error('Failed to save user hours:', error);
      toast.error('Failed to save user hours');
    }
  };

  const handleSaveServiceRules = async () => {
    if (!selectedServiceId) {
      toast.error('Please select a service');
      return;
    }

    try {
      const setting = serviceSettings[selectedServiceId];
      const result = await createOrUpdateAvailabilitySetting({
        setting_type: 'service_rules',
        service_id: selectedServiceId,
        is_available: true,
        allow_without_contract: setting?.allow_without_contract ?? false,
        max_appointments_per_day: setting?.max_appointments_per_day
      });

      if (result.success) {
        toast.success('Service rules saved');
      } else {
        toast.error(result.error || 'Failed to save service rules');
      }
    } catch (error) {
      console.error('Failed to save service rules:', error);
      toast.error('Failed to save service rules');
    }
  };

  const handleAddException = async () => {
    if (!selectedDate) {
      toast.error('Please select a date');
      return;
    }

    try {
      const dateStr = selectedDate.toISOString().split('T')[0];
      const result = await addAvailabilityException({
        date: dateStr,
        user_id: exceptionUserId || undefined,
        is_available: exceptionIsAvailable,
        reason: exceptionReason || undefined
      });

      if (result.success) {
        toast.success('Exception added');
        // Reload exceptions
        const exceptionsResult = await getAvailabilityExceptions();
        if (exceptionsResult.success && exceptionsResult.data) {
          setExceptions(exceptionsResult.data);
        }
        // Reset form
        setSelectedDate(undefined);
        setExceptionUserId('');
        setExceptionReason('');
        setExceptionIsAvailable(false);
      } else {
        toast.error(result.error || 'Failed to add exception');
      }
    } catch (error) {
      console.error('Failed to add exception:', error);
      toast.error('Failed to add exception');
    }
  };

  const handleDeleteException = async (exceptionId: string) => {
    try {
      const result = await deleteAvailabilityException(exceptionId);
      if (result.success) {
        toast.success('Exception deleted');
        setExceptions(exceptions.filter(e => e.exception_id !== exceptionId));
      } else {
        toast.error(result.error || 'Failed to delete exception');
      }
    } catch (error) {
      console.error('Failed to delete exception:', error);
      toast.error('Failed to delete exception');
    }
  };

  const userOptions: SelectOption[] = useMemo(() =>
    users.map(user => ({
      value: user.user_id,
      label: `${user.first_name} ${user.last_name}`
    })),
    [users]
  );

  const serviceOptions: SelectOption[] = useMemo(() =>
    services.map(service => ({
      value: service.service_catalog_id,
      label: service.service_name
    })),
    [services]
  );

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center">Loading settings...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Availability Settings</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="general">General Settings</TabsTrigger>
            <TabsTrigger value="user-hours">User Hours</TabsTrigger>
            <TabsTrigger value="service-rules">Service Rules</TabsTrigger>
            <TabsTrigger value="exceptions">Exceptions</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="advance-booking-days">Default Advance Booking (Days)</Label>
                <Input
                  id="advance-booking-days"
                  type="number"
                  value={defaultAdvanceBookingDays}
                  onChange={(e) => setDefaultAdvanceBookingDays(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="minimum-notice-hours">Minimum Notice (Hours)</Label>
                <Input
                  id="minimum-notice-hours"
                  type="number"
                  value={defaultMinimumNoticeHours}
                  onChange={(e) => setDefaultMinimumNoticeHours(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="buffer-before">Buffer Before (Minutes)</Label>
                <Input
                  id="buffer-before"
                  type="number"
                  value={defaultBufferBefore}
                  onChange={(e) => setDefaultBufferBefore(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="buffer-after">Buffer After (Minutes)</Label>
                <Input
                  id="buffer-after"
                  type="number"
                  value={defaultBufferAfter}
                  onChange={(e) => setDefaultBufferAfter(e.target.value)}
                />
              </div>
            </div>
            <Button id="save-general-settings" onClick={handleSaveGeneralSettings}>
              <Save className="h-4 w-4 mr-2" />
              Save General Settings
            </Button>
          </TabsContent>

          <TabsContent value="user-hours" className="space-y-4 mt-4">
            <div>
              <Label>Select User</Label>
              <CustomSelect
                id="user-hours-selector"
                options={userOptions}
                value={selectedUserId}
                onValueChange={setSelectedUserId}
                placeholder="Select a user"
              />
            </div>

            {selectedUserId && (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Day</TableHead>
                      <TableHead>Available</TableHead>
                      <TableHead>Start Time</TableHead>
                      <TableHead>End Time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {DAYS_OF_WEEK.map(day => {
                      const hours = userHours[day.value] || {
                        day_of_week: day.value,
                        is_available: false,
                        start_time: '09:00',
                        end_time: '17:00'
                      };

                      return (
                        <TableRow key={day.value}>
                          <TableCell>{day.label}</TableCell>
                          <TableCell>
                            <Switch
                              id={`day-${day.value}-available`}
                              checked={hours.is_available}
                              onCheckedChange={(checked) => {
                                setUserHours(prev => ({
                                  ...prev,
                                  [day.value]: { ...hours, is_available: checked }
                                }));
                              }}
                            />
                          </TableCell>
                          <TableCell>
                            <TimePicker
                              id={`day-${day.value}-start-time`}
                              value={hours.start_time}
                              onChange={(time) => {
                                setUserHours(prev => ({
                                  ...prev,
                                  [day.value]: { ...hours, start_time: time }
                                }));
                              }}
                              disabled={!hours.is_available}
                            />
                          </TableCell>
                          <TableCell>
                            <TimePicker
                              id={`day-${day.value}-end-time`}
                              value={hours.end_time}
                              onChange={(time) => {
                                setUserHours(prev => ({
                                  ...prev,
                                  [day.value]: { ...hours, end_time: time }
                                }));
                              }}
                              disabled={!hours.is_available}
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                <Button id="save-user-hours" onClick={handleSaveUserHours}>
                  <Save className="h-4 w-4 mr-2" />
                  Save User Hours
                </Button>
              </>
            )}
          </TabsContent>

          <TabsContent value="service-rules" className="space-y-4 mt-4">
            <div>
              <Label>Select Service</Label>
              <CustomSelect
                id="service-rules-selector"
                options={serviceOptions}
                value={selectedServiceId}
                onValueChange={setSelectedServiceId}
                placeholder="Select a service"
              />
            </div>

            {selectedServiceId && (
              <>
                <div className="space-y-4">
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="allow-without-contract"
                      checked={serviceSettings[selectedServiceId]?.allow_without_contract ?? false}
                      onCheckedChange={(checked) => {
                        setServiceSettings(prev => ({
                          ...prev,
                          [selectedServiceId]: {
                            ...(prev[selectedServiceId] || {} as IAvailabilitySetting),
                            allow_without_contract: checked
                          }
                        }));
                      }}
                    />
                    <Label htmlFor="allow-without-contract">Allow Booking Without Contract</Label>
                  </div>

                  <div>
                    <Label htmlFor="max-appointments-per-day">Max Appointments Per Day</Label>
                    <Input
                      id="max-appointments-per-day"
                      type="number"
                      value={serviceSettings[selectedServiceId]?.max_appointments_per_day || ''}
                      onChange={(e) => {
                        setServiceSettings(prev => ({
                          ...prev,
                          [selectedServiceId]: {
                            ...(prev[selectedServiceId] || {} as IAvailabilitySetting),
                            max_appointments_per_day: parseInt(e.target.value) || undefined
                          }
                        }));
                      }}
                      placeholder="No limit"
                    />
                  </div>
                </div>

                <Button id="save-service-rules" onClick={handleSaveServiceRules}>
                  <Save className="h-4 w-4 mr-2" />
                  Save Service Rules
                </Button>
              </>
            )}
          </TabsContent>

          <TabsContent value="exceptions" className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <h3 className="text-lg font-semibold mb-2">Add Exception</h3>
                <div className="space-y-4">
                  <div>
                    <Label>Select Date</Label>
                    <Calendar
                      mode="single"
                      selected={selectedDate}
                      onSelect={setSelectedDate}
                      className="rounded-md border"
                    />
                  </div>

                  <div>
                    <Label>User (Optional - leave empty for company-wide)</Label>
                    <CustomSelect
                      id="exception-user-selector"
                      options={[{ value: '', label: 'Company-wide' }, ...userOptions]}
                      value={exceptionUserId}
                      onValueChange={setExceptionUserId}
                      placeholder="Select user"
                    />
                  </div>

                  <div className="flex items-center space-x-2">
                    <Switch
                      id="exception-is-available"
                      checked={exceptionIsAvailable}
                      onCheckedChange={setExceptionIsAvailable}
                    />
                    <Label htmlFor="exception-is-available">Available on this day</Label>
                  </div>

                  <div>
                    <Label htmlFor="exception-reason">Reason</Label>
                    <Input
                      id="exception-reason"
                      value={exceptionReason}
                      onChange={(e) => setExceptionReason(e.target.value)}
                      placeholder="Holiday, Time off, etc."
                    />
                  </div>

                  <Button id="add-exception" onClick={handleAddException}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Exception
                  </Button>
                </div>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-2">Existing Exceptions</h3>
                <div className="space-y-2">
                  {exceptions.length === 0 ? (
                    <p className="text-gray-500 text-sm">No exceptions configured</p>
                  ) : (
                    exceptions.map(exception => {
                      const user = users.find(u => u.user_id === exception.user_id);
                      return (
                        <div key={exception.exception_id} className="border rounded p-3 flex justify-between items-start">
                          <div className="flex-1">
                            <div className="font-medium">{exception.date}</div>
                            <div className="text-sm text-gray-600">
                              {user ? `${user.first_name} ${user.last_name}` : 'Company-wide'}
                            </div>
                            {exception.reason && (
                              <div className="text-sm text-gray-500 italic">{exception.reason}</div>
                            )}
                            <Badge variant={exception.is_available ? 'success' : 'error'} className="mt-1">
                              {exception.is_available ? 'Available' : 'Unavailable'}
                            </Badge>
                          </div>
                          <Button
                            id={`delete-exception-${exception.exception_id}`}
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteException(exception.exception_id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
