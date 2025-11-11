'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Dialog } from 'server/src/components/ui/Dialog';
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
import { useSession } from 'next-auth/react';
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
import { getServices } from 'server/src/lib/actions/serviceActions';
import { IService } from 'server/src/interfaces/billing.interfaces';
import { getTeams } from 'server/src/lib/actions/team-actions/teamActions';
import { ITeam } from 'server/src/interfaces';

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

interface AvailabilitySettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AvailabilitySettings({ isOpen, onClose }: AvailabilitySettingsProps) {
  const [activeTab, setActiveTab] = useState('general');
  const [isLoading, setIsLoading] = useState(true);
  const { data: session } = useSession();

  // Team management state
  const [allUsers, setAllUsers] = useState<Omit<IUserWithRoles, 'tenant'>[]>([]);
  const [managedTeams, setManagedTeams] = useState<ITeam[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');
  const [isManager, setIsManager] = useState(false);

  // General settings state
  const [defaultAdvanceBookingDays, setDefaultAdvanceBookingDays] = useState('30');
  const [defaultMinimumNoticeHours, setDefaultMinimumNoticeHours] = useState('24');
  const [defaultApproverId, setDefaultApproverId] = useState<string>('');
  const [autoApprovalEnabled, setAutoApprovalEnabled] = useState(false);
  const [autoApprovalRequireAvailability, setAutoApprovalRequireAvailability] = useState(true);
  const [autoApprovalRequireContract, setAutoApprovalRequireContract] = useState(true);
  const [autoApprovalCheckConflicts, setAutoApprovalCheckConflicts] = useState(true);
  const [autoApprovalRespectBuffers, setAutoApprovalRespectBuffers] = useState(true);

  // User hours state
  const [users, setUsers] = useState<Omit<IUserWithRoles, 'tenant'>[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [userHours, setUserHours] = useState<Record<number, UserHoursSetting>>({});
  const [userDefaultDuration, setUserDefaultDuration] = useState('60');
  const [userBufferBefore, setUserBufferBefore] = useState('0');
  const [userBufferAfter, setUserBufferAfter] = useState('15');
  const [userAllowClientPreference, setUserAllowClientPreference] = useState(true);
  const [userDefaultApproverId, setUserDefaultApproverId] = useState<string>('');

  // Service rules state
  const [services, setServices] = useState<IService[]>([]);
  const [selectedServiceId, setSelectedServiceId] = useState<string>('');
  const [serviceSettings, setServiceSettings] = useState<Record<string, IAvailabilitySetting>>({});

  // Exceptions state
  const [exceptions, setExceptions] = useState<IAvailabilityException[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [exceptionUserId, setExceptionUserId] = useState<string>('__company_wide__');
  const [exceptionReason, setExceptionReason] = useState('');
  const [exceptionIsAvailable, setExceptionIsAvailable] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadInitialData();
    }
  }, [isOpen]);

  const loadInitialData = async () => {
    setIsLoading(true);
    try {
      console.log('[AvailabilitySettings] Starting loadInitialData');

      // Load all users first
      const fetchedUsers = await getAllUsers(false, 'internal');
      console.log('[AvailabilitySettings] Loaded users:', fetchedUsers.length);
      setAllUsers(fetchedUsers);

      // Check if current user is a manager
      if (session?.user?.id) {
        const teams = await getTeams();
        const userManagedTeams = teams.filter(team => team.manager_id === session.user.id);

        if (userManagedTeams.length > 0) {
          // User is a manager
          setIsManager(true);
          setManagedTeams(userManagedTeams);

          // Auto-select first team if only one team
          if (userManagedTeams.length === 1) {
            setSelectedTeamId(userManagedTeams[0].team_id);
            // Filter users for this team
            const teamMemberIds = userManagedTeams[0].members?.map(m => m.user_id) || [];
            const filteredUsers = fetchedUsers.filter(user => teamMemberIds.includes(user.user_id));
            setUsers(filteredUsers);
          } else {
            // Multiple teams - wait for user to select
            setUsers([]);
          }
        } else {
          // Not a manager - show all users (admin)
          setIsManager(false);
          setUsers(fetchedUsers);
        }
      } else {
        // No session - show all users
        setUsers(fetchedUsers);
      }

      // Load services
      const servicesResponse = await getServices();
      setServices(servicesResponse.services);

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
        if (setting.config_json?.default_approver_id) {
          setDefaultApproverId(setting.config_json.default_approver_id);
        }
        if (setting.config_json?.auto_approval_enabled !== undefined) {
          setAutoApprovalEnabled(setting.config_json.auto_approval_enabled);
        }
        if (setting.config_json?.auto_approval_criteria) {
          const criteria = setting.config_json.auto_approval_criteria;
          if (criteria.require_availability !== undefined) setAutoApprovalRequireAvailability(criteria.require_availability);
          if (criteria.require_contract !== undefined) setAutoApprovalRequireContract(criteria.require_contract);
          if (criteria.check_conflicts !== undefined) setAutoApprovalCheckConflicts(criteria.check_conflicts);
          if (criteria.respect_buffers !== undefined) setAutoApprovalRespectBuffers(criteria.respect_buffers);
        }
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
      let foundUserSettings = false;

      result.data.forEach(setting => {
        if (setting.day_of_week !== undefined && setting.day_of_week !== null) {
          hoursMap[setting.day_of_week] = {
            day_of_week: setting.day_of_week,
            is_available: setting.is_available,
            start_time: setting.start_time || '09:00',
            end_time: setting.end_time || '17:00'
          };
        }

        // Load per-user appointment settings from the first record
        if (!foundUserSettings) {
          foundUserSettings = true;
          if (setting.config_json?.default_duration !== undefined) {
            setUserDefaultDuration(String(setting.config_json.default_duration));
          } else {
            setUserDefaultDuration(''); // Empty means use service default
          }
          if (setting.buffer_before_minutes !== undefined) {
            setUserBufferBefore(String(setting.buffer_before_minutes));
          } else {
            setUserBufferBefore('0');
          }
          if (setting.buffer_after_minutes !== undefined) {
            setUserBufferAfter(String(setting.buffer_after_minutes));
          } else {
            setUserBufferAfter('15');
          }
          if (setting.config_json?.allow_client_preference !== undefined) {
            setUserAllowClientPreference(setting.config_json.allow_client_preference);
          } else {
            setUserAllowClientPreference(true);
          }
          if (setting.config_json?.default_approver_id) {
            setUserDefaultApproverId(setting.config_json.default_approver_id);
          } else {
            setUserDefaultApproverId('');
          }
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

      // Reset per-user settings to defaults
      setUserDefaultDuration(''); // Empty means use service default
      setUserBufferBefore('0');
      setUserBufferAfter('15');
      setUserAllowClientPreference(true);
      setUserDefaultApproverId('');
    }
  };

  const loadAllServiceRules = async () => {
    const result = await getAvailabilitySettings({
      setting_type: 'service_rules'
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

  // Update users list when team selection changes
  useEffect(() => {
    if (isManager && selectedTeamId) {
      const selectedTeam = managedTeams.find(t => t.team_id === selectedTeamId);
      if (selectedTeam) {
        const teamMemberIds = selectedTeam.members?.map(m => m.user_id) || [];
        const filteredUsers = allUsers.filter(user => teamMemberIds.includes(user.user_id));
        setUsers(filteredUsers);
      }
    }
  }, [selectedTeamId, isManager, managedTeams, allUsers]);

  useEffect(() => {
    if (selectedUserId && activeTab === 'user-hours') {
      loadUserHours(selectedUserId);
    }
  }, [selectedUserId, activeTab]);

  useEffect(() => {
    if (activeTab === 'service-rules') {
      loadAllServiceRules();
    }
  }, [activeTab]);

  const handleSaveGeneralSettings = async () => {
    try {
      const result = await createOrUpdateAvailabilitySetting({
        setting_type: 'general_settings',
        is_available: true,
        advance_booking_days: parseInt(defaultAdvanceBookingDays) || 30,
        minimum_notice_hours: parseInt(defaultMinimumNoticeHours) || 24,
        config_json: {
          default_approver_id: defaultApproverId || undefined,
          auto_approval_enabled: autoApprovalEnabled,
          auto_approval_criteria: {
            require_availability: autoApprovalRequireAvailability,
            require_contract: autoApprovalRequireContract,
            check_conflicts: autoApprovalCheckConflicts,
            respect_buffers: autoApprovalRespectBuffers
          }
        }
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
      // Build config_json, only including default_duration if it's set
      const configJson: any = {
        allow_client_preference: userAllowClientPreference,
        default_approver_id: userDefaultApproverId || undefined
      };

      // Only include default_duration if user has explicitly set it
      if (userDefaultDuration && userDefaultDuration.trim() !== '') {
        configJson.default_duration = parseInt(userDefaultDuration);
      }

      for (const [dayStr, hours] of Object.entries(userHours)) {
        const day = parseInt(dayStr);
        await createOrUpdateAvailabilitySetting({
          setting_type: 'user_hours',
          user_id: selectedUserId,
          day_of_week: day,
          is_available: hours.is_available,
          start_time: hours.start_time,
          end_time: hours.end_time,
          buffer_before_minutes: parseInt(userBufferBefore) || 0,
          buffer_after_minutes: parseInt(userBufferAfter) || 0,
          config_json: configJson
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
        max_appointments_per_day: setting?.max_appointments_per_day,
        config_json: {
          default_duration: setting?.config_json?.default_duration
        }
      });

      if (result.success) {
        toast.success('Service rules saved');
        // Reload all service rules to update the table
        await loadAllServiceRules();
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
        user_id: exceptionUserId && exceptionUserId !== '__company_wide__' ? exceptionUserId : undefined,
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
        setExceptionUserId('__company_wide__');
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
      value: service.service_id,
      label: service.service_name
    })),
    [services]
  );

  return (
    <Dialog isOpen={isOpen} onClose={onClose} id="availability-settings" title="Availability Settings" className="max-w-4xl">
      {isLoading ? (
        <div className="p-6">
          <div className="text-center">Loading settings...</div>
        </div>
      ) : (
        <div>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="general">General Settings</TabsTrigger>
            <TabsTrigger value="user-hours">User Hours</TabsTrigger>
            <TabsTrigger value="service-rules">Service Rules</TabsTrigger>
            <TabsTrigger value="exceptions">Exceptions</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="space-y-4 mt-4">
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg space-y-4">
              <div className="flex items-start space-x-3">
                <Switch
                  id="auto-approval-enabled"
                  checked={autoApprovalEnabled}
                  onCheckedChange={setAutoApprovalEnabled}
                />
                <div className="flex-1">
                  <Label htmlFor="auto-approval-enabled" className="text-base font-semibold">Enable Auto-Approval</Label>
                  <p className="text-sm text-gray-600 mt-1">
                    Automatically approve appointments that meet the criteria configured below
                  </p>
                </div>
              </div>

              {autoApprovalEnabled && (
                <div className="ml-8 space-y-3 border-l-2 border-blue-300 pl-4">
                  <p className="text-sm font-medium text-gray-700">Auto-Approval Criteria:</p>

                  <div className="flex items-center space-x-2">
                    <Switch
                      id="auto-approval-require-availability"
                      checked={autoApprovalRequireAvailability}
                      onCheckedChange={setAutoApprovalRequireAvailability}
                    />
                    <Label htmlFor="auto-approval-require-availability" className="text-sm">
                      Technician must have availability configured for requested time
                    </Label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Switch
                      id="auto-approval-require-contract"
                      checked={autoApprovalRequireContract}
                      onCheckedChange={setAutoApprovalRequireContract}
                    />
                    <Label htmlFor="auto-approval-require-contract" className="text-sm">
                      Client must have active contract (if service requires it)
                    </Label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Switch
                      id="auto-approval-check-conflicts"
                      checked={autoApprovalCheckConflicts}
                      onCheckedChange={setAutoApprovalCheckConflicts}
                    />
                    <Label htmlFor="auto-approval-check-conflicts" className="text-sm">
                      No scheduling conflicts with existing appointments
                    </Label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Switch
                      id="auto-approval-respect-buffers"
                      checked={autoApprovalRespectBuffers}
                      onCheckedChange={setAutoApprovalRespectBuffers}
                    />
                    <Label htmlFor="auto-approval-respect-buffers" className="text-sm">
                      Respect buffer times before/after appointments
                    </Label>
                  </div>
                </div>
              )}
            </div>

            <div>
              <Label htmlFor="general-default-approver">Default Approver</Label>
              <p className="text-xs text-gray-600 mb-2">
                Company-wide default approver for appointment requests that require manual approval.
                This can be overridden per technician in User Hours settings.
              </p>
              <CustomSelect
                id="general-default-approver"
                options={allUsers.map(user => ({
                  value: user.user_id,
                  label: `${user.first_name} ${user.last_name}`
                }))}
                value={defaultApproverId || undefined}
                onValueChange={setDefaultApproverId}
                placeholder="Select an approver"
              />
            </div>

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
            </div>
            <Button id="save-general-settings" onClick={handleSaveGeneralSettings}>
              <Save className="h-4 w-4 mr-2" />
              Save General Settings
            </Button>
          </TabsContent>

          <TabsContent value="user-hours" className="space-y-4 mt-4">
            {isManager && managedTeams.length > 1 && (
              <div>
                <Label>Select Team</Label>
                <CustomSelect
                  id="team-selector"
                  options={managedTeams.map(team => ({
                    value: team.team_id,
                    label: team.team_name
                  }))}
                  value={selectedTeamId || undefined}
                  onValueChange={setSelectedTeamId}
                  placeholder="Select a team"
                />
              </div>
            )}

            <div>
              <Label>Select User</Label>
              <CustomSelect
                id="user-hours-selector"
                options={userOptions}
                value={selectedUserId || undefined}
                onValueChange={setSelectedUserId}
                placeholder={isManager && !selectedTeamId && managedTeams.length > 1 ? "Select a team first" : "Select a user"}
                disabled={isManager && !selectedTeamId && managedTeams.length > 1}
              />
            </div>

            {selectedUserId && (
              <>
                <div className="border rounded-lg p-4 bg-gray-50 space-y-4">
                  <h3 className="text-sm font-semibold">Appointment Settings</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="user-default-duration">Default Appointment Duration (Minutes)</Label>
                      <p className="text-xs text-gray-600 mb-2">
                        Technician-specific duration override. Leave empty to use the service-specific duration from Service Rules.
                      </p>
                      <Input
                        id="user-default-duration"
                        type="number"
                        value={userDefaultDuration}
                        onChange={(e) => setUserDefaultDuration(e.target.value)}
                        placeholder="Leave empty to use service default"
                      />
                    </div>
                    <div>
                      <Label htmlFor="user-buffer-after">Buffer Time Between Appointments (Minutes)</Label>
                      <Input
                        id="user-buffer-after"
                        type="number"
                        value={userBufferAfter}
                        onChange={(e) => setUserBufferAfter(e.target.value)}
                        placeholder="15"
                      />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="user-default-approver">Default Approver</Label>
                    <p className="text-xs text-gray-600 mb-2">Who should review and approve appointment requests for this technician that require manual approval</p>
                    <CustomSelect
                      id="user-default-approver"
                      options={allUsers
                        .filter(u => u.user_id !== selectedUserId)
                        .map(user => ({
                          value: user.user_id,
                          label: `${user.first_name} ${user.last_name}`
                        }))}
                      value={userDefaultApproverId || undefined}
                      onValueChange={setUserDefaultApproverId}
                      placeholder="Select an approver"
                    />
                  </div>
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="user-allow-client-preference"
                      checked={userAllowClientPreference}
                      onCheckedChange={setUserAllowClientPreference}
                    />
                    <div>
                      <Label htmlFor="user-allow-client-preference" className="font-medium">Allow Client Preference</Label>
                      <p className="text-sm text-gray-600">Let clients request this technician specifically</p>
                    </div>
                  </div>
                </div>

                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="py-2">Day</TableHead>
                        <TableHead className="py-2">Available</TableHead>
                        <TableHead className="py-2">Start Time</TableHead>
                        <TableHead className="py-2">End Time</TableHead>
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
                          <TableRow key={day.value} className="hover:bg-gray-50">
                            <TableCell className="py-2 font-medium">{day.label}</TableCell>
                            <TableCell className="py-2">
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
                            <TableCell className="py-2">
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
                            <TableCell className="py-2">
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
                </div>
                <Button id="save-user-hours" onClick={handleSaveUserHours}>
                  <Save className="h-4 w-4 mr-2" />
                  Save User Hours
                </Button>
              </>
            )}
          </TabsContent>

          <TabsContent value="service-rules" className="space-y-4 mt-4">
            <div>
              <h3 className="text-lg font-semibold mb-2">Service Rules Overview</h3>
              <p className="text-sm text-gray-600 mb-4">Click a service to configure its rules</p>
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Service Name</TableHead>
                      <TableHead>Duration (min)</TableHead>
                      <TableHead>Without Contract</TableHead>
                      <TableHead>Max Per Day</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {services.map(service => {
                      const setting = serviceSettings[service.service_id];
                      const hasRules = !!setting;
                      return (
                        <TableRow
                          key={service.service_id}
                          className={`cursor-pointer hover:bg-gray-50 ${selectedServiceId === service.service_id ? 'bg-blue-50' : ''}`}
                          onClick={() => setSelectedServiceId(service.service_id)}
                        >
                          <TableCell className="font-medium">{service.service_name}</TableCell>
                          <TableCell>
                            {setting?.config_json?.default_duration || '-'}
                          </TableCell>
                          <TableCell>
                            {hasRules ? (setting.allow_without_contract ? 'Yes' : 'No') : '-'}
                          </TableCell>
                          <TableCell>
                            {setting?.max_appointments_per_day || 'No limit'}
                          </TableCell>
                          <TableCell>
                            <Badge variant={hasRules ? 'default' : 'secondary'}>
                              {hasRules ? 'Configured' : 'Not configured'}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>

            {selectedServiceId && (
              <>
                <div className="border-t pt-4 mt-4">
                  <h3 className="text-lg font-semibold mb-4">
                    Edit Rules: {services.find(s => s.service_id === selectedServiceId)?.service_name}
                  </h3>
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

                    <div>
                      <Label htmlFor="service-default-duration">Default Appointment Duration (Minutes)</Label>
                      <p className="text-xs text-gray-600 mb-2">
                        Default duration for appointments of this service type. Can be overridden by technician-specific settings in User Hours.
                      </p>
                      <Input
                        id="service-default-duration"
                        type="number"
                        value={serviceSettings[selectedServiceId]?.config_json?.default_duration || ''}
                        onChange={(e) => {
                          setServiceSettings(prev => ({
                            ...prev,
                            [selectedServiceId]: {
                              ...(prev[selectedServiceId] || {} as IAvailabilitySetting),
                              config_json: {
                                ...(prev[selectedServiceId]?.config_json || {}),
                                default_duration: parseInt(e.target.value) || undefined
                              }
                            }
                          }));
                        }}
                        placeholder="e.g., 60 (minutes)"
                      />
                    </div>
                  </div>

                  <Button id="save-service-rules" onClick={handleSaveServiceRules} className="mt-4">
                    <Save className="h-4 w-4 mr-2" />
                    Save Service Rules
                  </Button>
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="exceptions" className="space-y-4 mt-4">
            {isManager && managedTeams.length > 1 && (
              <div>
                <Label>Select Team</Label>
                <CustomSelect
                  id="team-selector-exceptions"
                  options={managedTeams.map(team => ({
                    value: team.team_id,
                    label: team.team_name
                  }))}
                  value={selectedTeamId || undefined}
                  onValueChange={setSelectedTeamId}
                  placeholder="Select a team"
                />
              </div>
            )}

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
                      options={[{ value: '__company_wide__', label: 'Company-wide' }, ...userOptions]}
                      value={exceptionUserId || '__company_wide__'}
                      onValueChange={setExceptionUserId}
                      placeholder="Select user"
                      disabled={isManager && !selectedTeamId && managedTeams.length > 1}
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
                      // Format date properly - handle both string and Date object
                      const dateStr = exception.date instanceof Date
                        ? exception.date.toISOString().split('T')[0]
                        : typeof exception.date === 'string'
                        ? exception.date.split('T')[0] // Handle ISO strings
                        : String(exception.date);

                      return (
                        <div key={exception.exception_id} className="border rounded p-3 flex justify-between items-start">
                          <div className="flex-1">
                            <div className="font-medium">{dateStr}</div>
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
        </div>
      )}
    </Dialog>
  );
}
