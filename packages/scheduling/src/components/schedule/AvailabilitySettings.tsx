'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@alga-psa/ui/components/Tabs';
import { Input } from '@alga-psa/ui/components/Input';
import { Button } from '@alga-psa/ui/components/Button';
import { Label } from '@alga-psa/ui/components/Label';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import MultiUserAndTeamPicker from '@alga-psa/ui/components/MultiUserAndTeamPicker';
import { readApproverIdsFromConfig } from '../../lib/appointmentApprovers';
import { TimePicker } from '@alga-psa/ui/components/TimePicker';
import { Calendar } from '@alga-psa/ui/components/Calendar';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@alga-psa/ui/components/Table';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { ColumnDefinition } from '@alga-psa/types';
import toast from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { Plus, Trash2, Save } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getAvailabilitySettings,
  getAvailabilitySettingsAccess,
  createOrUpdateAvailabilitySetting,
  saveUserAvailabilityWeek,
  deleteAvailabilitySetting,
  getAvailabilityExceptions,
  addAvailabilityException,
  deleteAvailabilityException,
  IAvailabilitySetting,
  IAvailabilityException
} from '@alga-psa/scheduling/actions';
import { IUser } from '@shared/interfaces/user.interfaces';
import { getServices } from '@alga-psa/scheduling/actions';
import { IService } from '@alga-psa/types';
import { ITeam } from '@alga-psa/types';
import {
  buildDefaultUserHours,
  hydrateUserHours,
  userHoursToOrderedWeek,
  UserHoursDay,
  UserHoursSource,
} from '../../lib/availabilityUserHours';
import { readAvailabilityContext, writeAvailabilityContext } from '../../lib/availabilityContext';

type UserHoursSetting = UserHoursDay;

interface AvailabilitySettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AvailabilitySettings({ isOpen, onClose }: AvailabilitySettingsProps) {
  const { t } = useTranslation('msp/schedule');
  const [activeTab, setActiveTab] = useState('general');
  const [isLoading, setIsLoading] = useState(true);
  const [contextHydrated, setContextHydrated] = useState(false);
  const [canReadSystemSettings, setCanReadSystemSettings] = useState(false);
  const [canManageSystemSettings, setCanManageSystemSettings] = useState(false);
  const [canManageUserHours, setCanManageUserHours] = useState(false);

  // Team management state
  const [allUsers, setAllUsers] = useState<IUser[]>([]);
  const [allTeams, setAllTeams] = useState<ITeam[]>([]);
  const [managedTeams, setManagedTeams] = useState<ITeam[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');
  const [isManager, setIsManager] = useState(false);

  // General settings state
  const [defaultAdvanceBookingDays, setDefaultAdvanceBookingDays] = useState('30');
  const [defaultMinimumNoticeHours, setDefaultMinimumNoticeHours] = useState('24');
  // Company-wide approvers (multiple users and/or teams)
  const [approverUserIds, setApproverUserIds] = useState<string[]>([]);
  const [approverTeamIds, setApproverTeamIds] = useState<string[]>([]);
  const [autoApprovalEnabled, setAutoApprovalEnabled] = useState(false);
  const [autoApprovalRequireAvailability, setAutoApprovalRequireAvailability] = useState(true);
  const [autoApprovalRequireContract, setAutoApprovalRequireContract] = useState(true);
  const [autoApprovalCheckConflicts, setAutoApprovalCheckConflicts] = useState(true);
  const [autoApprovalRespectBuffers, setAutoApprovalRespectBuffers] = useState(true);

  // User hours state
  const [users, setUsers] = useState<Omit<IUser, 'tenant'>[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [userHours, setUserHours] = useState<Record<number, UserHoursSetting>>(buildDefaultUserHours);
  const [userHoursSource, setUserHoursSource] = useState<UserHoursSource>('draft');
  const [isUserHoursLoading, setIsUserHoursLoading] = useState(false);
  const [userHoursError, setUserHoursError] = useState<string | null>(null);
  const [isSavingUserHours, setIsSavingUserHours] = useState(false);
  const [userDefaultDuration, setUserDefaultDuration] = useState('60');
  const [userBufferBefore, setUserBufferBefore] = useState('0');
  const [userBufferAfter, setUserBufferAfter] = useState('15');
  const [userAllowClientPreference, setUserAllowClientPreference] = useState(true);
  // Per-technician approver override (multiple users and/or teams)
  const [userApproverUserIds, setUserApproverUserIds] = useState<string[]>([]);
  const [userApproverTeamIds, setUserApproverTeamIds] = useState<string[]>([]);
  const [configuredUsers, setConfiguredUsers] = useState<Set<string>>(new Set());

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

  // Pagination state for configured users table
  const [usersCurrentPage, setUsersCurrentPage] = useState(1);
  const [usersPageSize, setUsersPageSize] = useState(10);

  // Pagination state for configured services table
  const [servicesCurrentPage, setServicesCurrentPage] = useState(1);
  const [servicesPageSize, setServicesPageSize] = useState(10);

  // Delete confirmation state
  const [userToDelete, setUserToDelete] = useState<Omit<IUser, 'tenant'> | null>(null);
  const [serviceToDelete, setServiceToDelete] = useState<IService | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Refs for scrolling edit forms into view
  const userHoursFormRef = useRef<HTMLDivElement>(null);
  const serviceRulesFormRef = useRef<HTMLDivElement>(null);
  const userHoursRequestRef = useRef(0);

  const daysOfWeek = useMemo(() => ([
    { value: 0, label: t('availabilitySettings.days.sunday', { defaultValue: 'Sunday' }) },
    { value: 1, label: t('availabilitySettings.days.monday', { defaultValue: 'Monday' }) },
    { value: 2, label: t('availabilitySettings.days.tuesday', { defaultValue: 'Tuesday' }) },
    { value: 3, label: t('availabilitySettings.days.wednesday', { defaultValue: 'Wednesday' }) },
    { value: 4, label: t('availabilitySettings.days.thursday', { defaultValue: 'Thursday' }) },
    { value: 5, label: t('availabilitySettings.days.friday', { defaultValue: 'Friday' }) },
    { value: 6, label: t('availabilitySettings.days.saturday', { defaultValue: 'Saturday' }) }
  ]), [t]);

  useEffect(() => {
    const persisted = readAvailabilityContext();
    if (persisted) {
      setActiveTab(persisted.activeTab);
      setSelectedTeamId(persisted.selectedTeamId);
      setSelectedUserId(persisted.selectedUserId);
    }
    setContextHydrated(true);
  }, []);

  useEffect(() => {
    if (!contextHydrated) return;
    writeAvailabilityContext({ isOpen, activeTab, selectedTeamId, selectedUserId });
  }, [activeTab, contextHydrated, isOpen, selectedTeamId, selectedUserId]);

  useEffect(() => {
    if (isOpen && contextHydrated) {
      loadInitialData();
    }
  }, [contextHydrated, isOpen]);

  const loadInitialData = async () => {
    setIsLoading(true);
    try {
      const [accessResult, servicesResponse, settingsResult, exceptionsResult] = await Promise.all([
        getAvailabilitySettingsAccess(),
        getServices().catch(() => null),
        getAvailabilitySettings(),
        getAvailabilityExceptions(),
      ]);
      if (!accessResult.success || !accessResult.data) {
        throw new Error(accessResult.error || 'Failed to load availability access');
      }

      const access = accessResult.data;
      const fetchedUsers = access.users as IUser[];
      const teams = access.teams.map((team): ITeam => ({
        tenant: fetchedUsers[0]?.tenant || '',
        team_id: team.team_id,
        team_name: team.team_name,
        manager_id: team.manager_id,
        members: team.member_ids
          .map((userId) => fetchedUsers.find((candidate) => candidate.user_id === userId))
          .filter(Boolean)
          .map((member) => ({ ...member!, roles: [], role: 'member' as const })),
      }));

      setCanReadSystemSettings(access.canReadSystemSettings);
      setCanManageSystemSettings(access.canManageSystemSettings);
      setCanManageUserHours(access.canManageUserHours);
      setIsManager(!access.canReadSystemSettings);
      setAllUsers(fetchedUsers);
      setUsers(fetchedUsers);
      setAllTeams(teams);
      setManagedTeams(teams);
      setServices(servicesResponse?.services ?? []);

      const settings = settingsResult.success && settingsResult.data ? settingsResult.data : [];
      processSettings(settings);
      setConfiguredUsers(new Set(settings.flatMap((setting) => setting.setting_type === 'user_hours' && setting.user_id ? [setting.user_id] : [])));
      setServiceSettings(Object.fromEntries(
        settings.flatMap((setting) => setting.setting_type === 'service_rules' && setting.service_id ? [[setting.service_id, setting]] : [])
      ));

      if (exceptionsResult.success && exceptionsResult.data) {
        setExceptions(exceptionsResult.data);
      } else {
        setExceptions([]);
      }

      const validTabs = new Set<string>();
      if (access.canReadSystemSettings) {
        validTabs.add('general');
        validTabs.add('service-rules');
        validTabs.add('exceptions');
      }
      if (access.canManageUserHours) validTabs.add('user-hours');
      setActiveTab((current) => validTabs.has(current)
        ? current
        : access.canReadSystemSettings ? 'general' : 'user-hours');
    } catch (error) {
      handleError(error, t('availabilitySettings.feedback.loadError', { defaultValue: 'Failed to load settings' }));
    } finally {
      setIsLoading(false);
    }
  };

  const processSettings = (settings: IAvailabilitySetting[]) => {
    settings.forEach(setting => {
      if (setting.setting_type === 'general_settings') {
        if (setting.advance_booking_days) setDefaultAdvanceBookingDays(String(setting.advance_booking_days));
        if (setting.minimum_notice_hours) setDefaultMinimumNoticeHours(String(setting.minimum_notice_hours));
        const generalApprovers = readApproverIdsFromConfig(setting.config_json);
        setApproverUserIds(generalApprovers.userIds);
        setApproverTeamIds(generalApprovers.teamIds);
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

  const loadUserHours = useCallback(async (userId: string) => {
    const requestId = ++userHoursRequestRef.current;
    setIsUserHoursLoading(true);
    setUserHoursError(null);
    setUserHours(buildDefaultUserHours());
    setUserHoursSource('draft');

    try {
      const result = await getAvailabilitySettings({ setting_type: 'user_hours', user_id: userId });
      if (requestId !== userHoursRequestRef.current) return;
      if (!result.success || !result.data) {
        throw new Error(result.error || 'Failed to load user hours');
      }

      const hydrated = hydrateUserHours(result.data);
      setUserHours(hydrated.hours);
      setUserHoursSource(hydrated.source);
      const first = result.data[0];
      setUserDefaultDuration(first?.config_json?.default_duration !== undefined ? String(first.config_json.default_duration) : '');
      setUserBufferBefore(first?.buffer_before_minutes !== undefined ? String(first.buffer_before_minutes) : '0');
      setUserBufferAfter(first?.buffer_after_minutes !== undefined ? String(first.buffer_after_minutes) : '15');
      setUserAllowClientPreference(first?.config_json?.allow_client_preference ?? true);
      const userApprovers = readApproverIdsFromConfig(first?.config_json);
      setUserApproverUserIds(userApprovers.userIds);
      setUserApproverTeamIds(userApprovers.teamIds);
    } catch (error) {
      if (requestId !== userHoursRequestRef.current) return;
      setUserHoursError(error instanceof Error ? error.message : 'Failed to load user hours');
    } finally {
      if (requestId === userHoursRequestRef.current) setIsUserHoursLoading(false);
    }
  }, []);

  const loadAllServiceRules = async () => {
    const result = await getAvailabilitySettings({
      setting_type: 'service_rules'
    });

    if (result.success && result.data) {
      const settingsMap: Record<string, IAvailabilitySetting> = {};
      result.data.forEach(setting => {
        if (setting.service_id) {
          settingsMap[setting.service_id] = setting;
        }
      });
      setServiceSettings(settingsMap);
    }
  };

  const loadConfiguredUsers = async () => {
    const result = await getAvailabilitySettings({
      setting_type: 'user_hours'
    });

    if (result.success && result.data) {
      const userIds = new Set<string>();
      result.data.forEach(setting => {
        if (setting.user_id) {
          userIds.add(setting.user_id);
        }
      });
      setConfiguredUsers(userIds);
    }
  };

  // Update users list when team selection changes
  useEffect(() => {
    if (isLoading) return;
    const selectedTeam = managedTeams.find((team) => team.team_id === selectedTeamId);
    if (selectedTeamId && !selectedTeam) {
      setSelectedTeamId('');
      return;
    }

    const nextUsers = selectedTeam
      ? allUsers.filter((user) => selectedTeam.members.some((member) => member.user_id === user.user_id))
      : allUsers;
    setUsers(nextUsers);
    if (selectedUserId && !nextUsers.some((user) => user.user_id === selectedUserId)) {
      setSelectedUserId('');
      setUserHours(buildDefaultUserHours());
      setUserHoursSource('draft');
    }
  }, [allUsers, isLoading, managedTeams, selectedTeamId, selectedUserId]);

  useEffect(() => {
    if (!isLoading && selectedUserId && activeTab === 'user-hours') {
      loadUserHours(selectedUserId);
    }
  }, [activeTab, isLoading, loadUserHours, selectedUserId]);

  const handleSaveGeneralSettings = async () => {
    try {
      const result = await createOrUpdateAvailabilitySetting({
        setting_type: 'general_settings',
        is_available: true,
        advance_booking_days: parseInt(defaultAdvanceBookingDays) || 30,
        minimum_notice_hours: parseInt(defaultMinimumNoticeHours) || 24,
        config_json: {
          approver_user_ids: approverUserIds,
          approver_team_ids: approverTeamIds,
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
        toast.success(t('availabilitySettings.general.feedback.saveSuccess', { defaultValue: 'General settings saved' }));
      } else {
        toast.error(result.error || t('availabilitySettings.general.feedback.saveError', { defaultValue: 'Failed to save settings' }));
      }
    } catch (error) {
      handleError(error, t('availabilitySettings.general.feedback.saveError', { defaultValue: 'Failed to save settings' }));
    }
  };

  const handleSaveUserHours = async () => {
    if (!selectedUserId) {
      toast.error(t('availabilitySettings.userHours.feedback.selectUserError', { defaultValue: 'Please select a user' }));
      return;
    }

    setIsSavingUserHours(true);
    try {
      // Build config_json, only including default_duration if it's set
      const configJson: any = {
        allow_client_preference: userAllowClientPreference,
        approver_user_ids: userApproverUserIds,
        approver_team_ids: userApproverTeamIds
      };

      // Only include default_duration if user has explicitly set it
      if (userDefaultDuration && userDefaultDuration.trim() !== '') {
        configJson.default_duration = parseInt(userDefaultDuration);
      }

      const result = await saveUserAvailabilityWeek({
        user_id: selectedUserId,
        days: userHoursToOrderedWeek(userHours),
        buffer_before_minutes: parseInt(userBufferBefore) || 0,
        buffer_after_minutes: parseInt(userBufferAfter) || 0,
        config_json: configJson,
      });
      if (!result.success || !result.data || result.data.length !== 7) {
        toast.error(result.error || t('availabilitySettings.userHours.feedback.saveError', { defaultValue: 'Failed to save user hours' }));
        return;
      }

      const authoritative = hydrateUserHours(result.data);
      setUserHours(authoritative.hours);
      setUserHoursSource('saved');
      setConfiguredUsers((current) => new Set(current).add(selectedUserId));
      toast.success(t('availabilitySettings.userHours.feedback.saveSuccess', { defaultValue: 'User hours saved' }));
    } catch (error) {
      handleError(error, t('availabilitySettings.userHours.feedback.saveError', { defaultValue: 'Failed to save user hours' }));
    } finally {
      setIsSavingUserHours(false);
    }
  };

  const handleSaveServiceRules = async () => {
    if (!selectedServiceId) {
      toast.error(t('availabilitySettings.serviceRules.feedback.selectServiceError', { defaultValue: 'Please select a service' }));
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
        toast.success(t('availabilitySettings.serviceRules.feedback.saveSuccess', { defaultValue: 'Service rules saved' }));
        // Reload all service rules to update the table
        await loadAllServiceRules();
      } else {
        toast.error(result.error || t('availabilitySettings.serviceRules.feedback.saveError', { defaultValue: 'Failed to save service rules' }));
      }
    } catch (error) {
      handleError(error, t('availabilitySettings.serviceRules.feedback.saveError', { defaultValue: 'Failed to save service rules' }));
    }
  };

  const handleAddException = async () => {
    if (!selectedDate) {
      toast.error(t('availabilitySettings.exceptions.feedback.selectDateError', { defaultValue: 'Please select a date' }));
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
        toast.success(t('availabilitySettings.exceptions.feedback.addSuccess', { defaultValue: 'Exception added' }));
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
        toast.error(result.error || t('availabilitySettings.exceptions.feedback.addError', { defaultValue: 'Failed to add exception' }));
      }
    } catch (error) {
      handleError(error, t('availabilitySettings.exceptions.feedback.addError', { defaultValue: 'Failed to add exception' }));
    }
  };

  const handleDeleteException = async (exceptionId: string) => {
    try {
      const result = await deleteAvailabilityException(exceptionId);
      if (result.success) {
        toast.success(t('availabilitySettings.exceptions.feedback.deleteSuccess', { defaultValue: 'Exception deleted' }));
        setExceptions(exceptions.filter(e => e.exception_id !== exceptionId));
      } else {
        toast.error(result.error || t('availabilitySettings.exceptions.feedback.deleteError', { defaultValue: 'Failed to delete exception' }));
      }
    } catch (error) {
      handleError(error, t('availabilitySettings.exceptions.feedback.deleteError', { defaultValue: 'Failed to delete exception' }));
    }
  };

  const handleEditUser = (userId: string) => {
    setSelectedUserId(userId);
    requestAnimationFrame(() => {
      userHoursFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const handleEditService = (serviceId: string) => {
    setSelectedServiceId(serviceId);
    requestAnimationFrame(() => {
      serviceRulesFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const handleConfirmDeleteUser = async () => {
    if (!userToDelete) return;
    setIsDeleting(true);
    try {
      const settingsResult = await getAvailabilitySettings({
        setting_type: 'user_hours',
        user_id: userToDelete.user_id
      });

      if (!settingsResult.success || !settingsResult.data) {
        toast.error(settingsResult.error || t('availabilitySettings.userHours.feedback.deleteError', { defaultValue: 'Failed to delete user availability' }));
        return;
      }

      for (const setting of settingsResult.data) {
        const deleteResult = await deleteAvailabilitySetting(setting.availability_setting_id);
        if (!deleteResult.success) {
          toast.error(deleteResult.error || t('availabilitySettings.userHours.feedback.deleteError', { defaultValue: 'Failed to delete user availability' }));
          return;
        }
      }

      toast.success(t('availabilitySettings.userHours.feedback.deleteSuccess', { defaultValue: 'User availability deleted' }));

      // Clear selection if the deleted user was being edited
      if (selectedUserId === userToDelete.user_id) {
        setSelectedUserId('');
        setUserHours({});
      }

      await loadConfiguredUsers();
      setUserToDelete(null);
    } catch (error) {
      handleError(error, t('availabilitySettings.userHours.feedback.deleteError', { defaultValue: 'Failed to delete user availability' }));
    } finally {
      setIsDeleting(false);
    }
  };

  const handleConfirmDeleteService = async () => {
    if (!serviceToDelete) return;
    setIsDeleting(true);
    try {
      const setting = serviceSettings[serviceToDelete.service_id];
      if (!setting) {
        setServiceToDelete(null);
        return;
      }

      const result = await deleteAvailabilitySetting(setting.availability_setting_id);
      if (result.success) {
        toast.success(t('availabilitySettings.serviceRules.feedback.deleteSuccess', { defaultValue: 'Service rules deleted' }));

        // Remove from local state
        setServiceSettings(prev => {
          const next = { ...prev };
          delete next[serviceToDelete.service_id];
          return next;
        });

        // Clear selection if the deleted service was being edited
        if (selectedServiceId === serviceToDelete.service_id) {
          setSelectedServiceId('');
        }

        setServiceToDelete(null);
      } else {
        toast.error(result.error || t('availabilitySettings.serviceRules.feedback.deleteError', { defaultValue: 'Failed to delete service rules' }));
      }
    } catch (error) {
      handleError(error, t('availabilitySettings.serviceRules.feedback.deleteError', { defaultValue: 'Failed to delete service rules' }));
    } finally {
      setIsDeleting(false);
    }
  };

  const userOptions: SelectOption[] = useMemo(() =>
    users.map(user => ({
      value: user.user_id,
      label: `${user.first_name} ${user.last_name}`
    })),
    [users]
  );

  const teamOptions: SelectOption[] = useMemo(() =>
    managedTeams.map((team) => ({ value: team.team_id, label: team.team_name })),
    [managedTeams]
  );

  const selectedUser = useMemo(
    () => allUsers.find((user) => user.user_id === selectedUserId),
    [allUsers, selectedUserId]
  );

  const selectedTeam = useMemo(
    () => managedTeams.find((team) => team.team_id === selectedTeamId),
    [managedTeams, selectedTeamId]
  );

  const serviceOptions: SelectOption[] = useMemo(() =>
    services.map(service => ({
      value: service.service_id,
      label: service.service_name
    })),
    [services]
  );

  // Column definitions for configured users table
  const configuredUsersColumns: ColumnDefinition<Omit<IUser, 'tenant'>>[] = useMemo(() => [
    {
      title: t('availabilitySettings.userHours.configuredUsers.columns.userName', { defaultValue: 'User Name' }),
      dataIndex: 'first_name' as any,
      render: (_, user: Omit<IUser, 'tenant'>) => `${user.first_name} ${user.last_name}`
    },
    {
      title: t('availabilitySettings.userHours.configuredUsers.columns.status', { defaultValue: 'Status' }),
      dataIndex: 'user_id' as any,
      render: () => <Badge variant="default">{t('availabilitySettings.userHours.configuredUsers.status.configured', { defaultValue: 'Configured' })}</Badge>
    },
    {
      title: t('availabilitySettings.common.columns.action', { defaultValue: 'Action' }),
      dataIndex: 'user_id' as any,
      render: (_, user: Omit<IUser, 'tenant'>) => (
        <div className="flex items-center gap-1">
          <Button
            id={`edit-user-${user.user_id}`}
            variant="ghost"
            size="sm"
            onClick={() => handleEditUser(user.user_id)}
          >
            {t('availabilitySettings.common.actions.edit', { defaultValue: 'Edit' })}
          </Button>
          <Button
            id={`delete-user-${user.user_id}`}
            variant="ghost"
            size="sm"
            onClick={() => setUserToDelete(user)}
            aria-label={t('availabilitySettings.common.actions.delete', { defaultValue: 'Delete' })}
          >
            <Trash2 className="h-4 w-4 text-red-600" />
          </Button>
        </div>
      )
    }
  ], [t]);

  // Column definitions for configured services table
  const configuredServicesColumns: ColumnDefinition<IService>[] = useMemo(() => [
    {
      title: t('availabilitySettings.serviceRules.configuredServices.columns.serviceName', { defaultValue: 'Service Name' }),
      dataIndex: 'service_name' as any,
    },
    {
      title: t('availabilitySettings.serviceRules.configuredServices.columns.duration', { defaultValue: 'Duration (min)' }),
      dataIndex: 'service_id' as any,
      render: (_, service: IService) => serviceSettings[service.service_id]?.config_json?.default_duration || '-'
    },
    {
      title: t('availabilitySettings.serviceRules.configuredServices.columns.withoutContract', { defaultValue: 'Without Contract' }),
      dataIndex: 'service_id' as any,
      render: (_, service: IService) => serviceSettings[service.service_id]?.allow_without_contract ? t('availabilitySettings.common.yes', { defaultValue: 'Yes' }) : t('availabilitySettings.common.no', { defaultValue: 'No' })
    },
    {
      title: t('availabilitySettings.serviceRules.configuredServices.columns.maxPerDay', { defaultValue: 'Max Per Day' }),
      dataIndex: 'service_id' as any,
      render: (_, service: IService) => serviceSettings[service.service_id]?.max_appointments_per_day || t('availabilitySettings.serviceRules.common.noLimit', { defaultValue: 'No limit' })
    },
    {
      title: t('availabilitySettings.common.columns.action', { defaultValue: 'Action' }),
      dataIndex: 'service_id' as any,
      render: (_, service: IService) => canManageSystemSettings ? (
        <div className="flex items-center gap-1">
          <Button
            id={`edit-service-${service.service_id}`}
            variant="ghost"
            size="sm"
            onClick={() => handleEditService(service.service_id)}
          >
            {t('availabilitySettings.common.actions.edit', { defaultValue: 'Edit' })}
          </Button>
          <Button
            id={`delete-service-${service.service_id}`}
            variant="ghost"
            size="sm"
            onClick={() => setServiceToDelete(service)}
            aria-label={t('availabilitySettings.common.actions.delete', { defaultValue: 'Delete' })}
          >
            <Trash2 className="h-4 w-4 text-red-600" />
          </Button>
        </div>
      ) : null
    }
  ], [canManageSystemSettings, serviceSettings, t]);

  // Filtered data for configured users
  const configuredUsersData = useMemo(() =>
    users.filter(user => configuredUsers.has(user.user_id)),
    [users, configuredUsers]
  );

  // Filtered data for configured services
  const configuredServicesData = useMemo(() =>
    services.filter(service => serviceSettings[service.service_id]),
    [services, serviceSettings]
  );

  return (
    <Dialog isOpen={isOpen} onClose={onClose} id="availability-settings" title={t('availabilitySettings.dialog.title', { defaultValue: 'Availability Settings' })} className="max-w-4xl">
      {isLoading ? (
        <div className="p-6">
          <div className="text-center">{t('availabilitySettings.loading', { defaultValue: 'Loading settings...' })}</div>
        </div>
      ) : (
        <div>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            {canReadSystemSettings && <TabsTrigger value="general">{t('availabilitySettings.tabs.general', { defaultValue: 'General Settings' })}</TabsTrigger>}
            {canManageUserHours && <TabsTrigger value="user-hours">{t('availabilitySettings.tabs.userHours', { defaultValue: 'User Hours' })}</TabsTrigger>}
            {canReadSystemSettings && <TabsTrigger value="service-rules">{t('availabilitySettings.tabs.serviceRules', { defaultValue: 'Service Rules' })}</TabsTrigger>}
            {canReadSystemSettings && <TabsTrigger value="exceptions">{t('availabilitySettings.tabs.exceptions', { defaultValue: 'Exceptions' })}</TabsTrigger>}
          </TabsList>

          <TabsContent value="general" className="space-y-4 mt-4">
            <Alert variant="info">
              <div className="space-y-4">
                <div className="flex items-start space-x-3">
                  <Switch
                    id="auto-approval-enabled"
                    checked={autoApprovalEnabled}
                    onCheckedChange={setAutoApprovalEnabled}
                  />
                  <div className="flex-1">
                    <Label htmlFor="auto-approval-enabled" className="text-base font-semibold">{t('availabilitySettings.general.autoApproval.title', { defaultValue: 'Enable Auto-Approval' })}</Label>
                    <p className="text-sm text-gray-600 mt-1">
                      {t('availabilitySettings.general.autoApproval.description', { defaultValue: 'Automatically approve appointments that meet the criteria configured below' })}
                    </p>
                  </div>
                </div>

              {autoApprovalEnabled && (
                <div className="ml-8 space-y-3 border-l-2 border-blue-300 pl-4">
                  <p className="text-sm font-medium text-gray-700">{t('availabilitySettings.general.autoApproval.criteriaTitle', { defaultValue: 'Auto-Approval Criteria:' })}</p>

                  <div className="flex items-center space-x-2">
                    <Switch
                      id="auto-approval-require-availability"
                      checked={autoApprovalRequireAvailability}
                      onCheckedChange={setAutoApprovalRequireAvailability}
                    />
                    <Label htmlFor="auto-approval-require-availability" className="text-sm">
                      {t('availabilitySettings.general.autoApproval.criteria.requireAvailability', { defaultValue: 'Technician must have availability configured for requested time' })}
                    </Label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Switch
                      id="auto-approval-require-contract"
                      checked={autoApprovalRequireContract}
                      onCheckedChange={setAutoApprovalRequireContract}
                    />
                    <Label htmlFor="auto-approval-require-contract" className="text-sm">
                      {t('availabilitySettings.general.autoApproval.criteria.requireContract', { defaultValue: 'Client must have active contract (if service requires it)' })}
                    </Label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Switch
                      id="auto-approval-check-conflicts"
                      checked={autoApprovalCheckConflicts}
                      onCheckedChange={setAutoApprovalCheckConflicts}
                    />
                    <Label htmlFor="auto-approval-check-conflicts" className="text-sm">
                      {t('availabilitySettings.general.autoApproval.criteria.checkConflicts', { defaultValue: 'No scheduling conflicts with existing appointments' })}
                    </Label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Switch
                      id="auto-approval-respect-buffers"
                      checked={autoApprovalRespectBuffers}
                      onCheckedChange={setAutoApprovalRespectBuffers}
                    />
                    <Label htmlFor="auto-approval-respect-buffers" className="text-sm">
                      {t('availabilitySettings.general.autoApproval.criteria.respectBuffers', { defaultValue: 'Respect buffer times before/after appointments' })}
                    </Label>
                  </div>
                </div>
              )}
              </div>
            </Alert>

            <div>
              <Label htmlFor="general-default-approver">{t('availabilitySettings.general.defaultApprover.label', { defaultValue: 'Approvers' })}</Label>
              <p className="text-xs text-gray-600 mb-2">
                {t('availabilitySettings.general.defaultApprover.help', { defaultValue: 'Company-wide approvers for appointment requests that require manual approval. Add multiple users and/or teams — everyone selected is notified and can approve. This can be overridden per technician in User Hours settings.' })}
              </p>
              <MultiUserAndTeamPicker
                id="general-default-approver"
                users={allUsers}
                values={approverUserIds}
                onValuesChange={setApproverUserIds}
                teams={allTeams}
                teamValues={approverTeamIds}
                onTeamValuesChange={setApproverTeamIds}
                showSearch
                placeholder={t('availabilitySettings.common.defaultApprover.placeholder', { defaultValue: 'Select approvers' })}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="advance-booking-days">{t('availabilitySettings.general.advanceBookingDays.label', { defaultValue: 'Default Advance Booking (Days)' })}</Label>
                <Input
                  id="advance-booking-days"
                  type="number"
                  value={defaultAdvanceBookingDays}
                  onChange={(e) => setDefaultAdvanceBookingDays(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="minimum-notice-hours">{t('availabilitySettings.general.minimumNoticeHours.label', { defaultValue: 'Minimum Notice (Hours)' })}</Label>
                <Input
                  id="minimum-notice-hours"
                  type="number"
                  value={defaultMinimumNoticeHours}
                  onChange={(e) => setDefaultMinimumNoticeHours(e.target.value)}
                />
              </div>
            </div>
            {canManageSystemSettings && <Button id="save-general-settings" onClick={handleSaveGeneralSettings}>
              <Save className="h-4 w-4 mr-2" />
              {t('availabilitySettings.general.actions.save', { defaultValue: 'Save General Settings' })}
            </Button>}
          </TabsContent>

          <TabsContent value="user-hours" className="space-y-4 mt-4">
            <Alert variant="info">
              <AlertDescription>
                {isManager ? (
                  <>
                    <strong>{t('availabilitySettings.userHours.roleManager.label', { defaultValue: 'Team Manager:' })}</strong> {t('availabilitySettings.userHours.roleManager.description', { defaultValue: 'You can configure booking availability only for authorized team members and direct reports. The table below follows the current team filter.' })}
                  </>
                ) : (
                  <>
                    <strong>{t('availabilitySettings.userHours.roleAdmin.label', { defaultValue: 'Administrator:' })}</strong> {t('availabilitySettings.userHours.roleAdmin.description', { defaultValue: 'You can configure user-wide booking availability for any authorized technician. The table below follows the current team filter.' })}
                  </>
                )}
              </AlertDescription>
            </Alert>

            {managedTeams.length > 0 && (
              <div>
                <Label htmlFor="team-selector">{t('availabilitySettings.common.teamSelect.label', { defaultValue: 'Filter technicians by team' })}</Label>
                <p className="text-xs text-gray-600 mb-2">
                  {t('availabilitySettings.common.teamSelect.help', { defaultValue: 'This filters the technician list only; booking availability belongs to the technician across every team.' })}
                </p>
                <CustomSelect
                  id="team-selector"
                  label={t('availabilitySettings.common.teamSelect.label', { defaultValue: 'Filter technicians by team' })}
                  options={teamOptions}
                  value={selectedTeamId || undefined}
                  onValueChange={setSelectedTeamId}
                  placeholder={t('availabilitySettings.common.teamSelect.placeholder', { defaultValue: 'All authorized technicians' })}
                  allowClear
                />
              </div>
            )}

            <div>
              <Label htmlFor="user-hours-selector">{t('availabilitySettings.userHours.userSelect.label', { defaultValue: 'Technician' })}</Label>
              <CustomSelect
                id="user-hours-selector"
                label={t('availabilitySettings.userHours.userSelect.label', { defaultValue: 'Technician' })}
                options={userOptions}
                value={selectedUserId || undefined}
                onValueChange={setSelectedUserId}
                placeholder={t('availabilitySettings.userHours.userSelect.placeholder', { defaultValue: 'Select a technician to configure' })}
                disabled={users.length === 0}
              />
            </div>

            {selectedUserId && (
              <div ref={userHoursFormRef} className="space-y-4 scroll-mt-4">
                <div className="rounded-lg border p-4 text-sm space-y-1" aria-live="polite">
                  <p><strong>{t('availabilitySettings.userHours.scope.team', { defaultValue: 'Team filter:' })}</strong> {selectedTeam?.team_name || t('availabilitySettings.userHours.scope.allTeams', { defaultValue: 'All authorized technicians' })}</p>
                  <p><strong>{t('availabilitySettings.userHours.scope.technician', { defaultValue: 'Technician:' })}</strong> {`${selectedUser?.first_name || ''} ${selectedUser?.last_name || ''}`.trim()}</p>
                  <p>
                    <strong>{t('availabilitySettings.userHours.scope.schedule', { defaultValue: 'Schedule:' })}</strong>{' '}
                    {isUserHoursLoading
                      ? t('availabilitySettings.userHours.scope.loading', { defaultValue: 'Checking saved booking hours' })
                      : userHoursSource === 'saved'
                      ? t('availabilitySettings.userHours.scope.saved', { defaultValue: 'Saved booking hours' })
                      : userHoursSource === 'partial'
                        ? t('availabilitySettings.userHours.scope.partial', { defaultValue: 'Saved booking hours with unsaved defaults for missing days' })
                        : t('availabilitySettings.userHours.scope.draft', { defaultValue: 'Unsaved Monday–Friday 9:00 AM–5:00 PM template' })}
                  </p>
                  <p className="text-gray-600">{t('availabilitySettings.userHours.scope.explanation', { defaultValue: 'These booking hours are user-wide across teams. They do not inherit from the separate work schedule.' })}</p>
                </div>

                {isUserHoursLoading ? (
                  <div className="p-6 text-center" role="status">{t('availabilitySettings.userHours.loading', { defaultValue: 'Loading technician hours...' })}</div>
                ) : userHoursError ? (
                  <Alert variant="destructive">
                    <AlertDescription className="flex items-center justify-between gap-4">
                      <span>{userHoursError}</span>
                      <Button id="retry-user-hours" variant="outline" size="sm" onClick={() => loadUserHours(selectedUserId)}>
                        {t('availabilitySettings.userHours.actions.retry', { defaultValue: 'Retry' })}
                      </Button>
                    </AlertDescription>
                  </Alert>
                ) : (
                <>
                <div className="border rounded-lg p-4 bg-gray-50 space-y-4">
                  <h3 className="text-sm font-semibold">{t('availabilitySettings.userHours.appointmentSettings.title', { defaultValue: 'Appointment Settings' })}</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="user-default-duration">{t('availabilitySettings.userHours.appointmentSettings.defaultDuration.label', { defaultValue: 'Default Appointment Duration (Minutes)' })}</Label>
                      <p className="text-xs text-gray-600 mb-2">
                        {t('availabilitySettings.userHours.appointmentSettings.defaultDuration.help', { defaultValue: 'Technician-specific duration override. Leave empty to use the service-specific duration from Service Rules.' })}
                      </p>
                      <Input
                        id="user-default-duration"
                        type="number"
                        value={userDefaultDuration}
                        onChange={(e) => setUserDefaultDuration(e.target.value)}
                        placeholder={t('availabilitySettings.userHours.appointmentSettings.defaultDuration.placeholder', { defaultValue: 'Leave empty to use service default' })}
                      />
                    </div>
                    <div>
                      <Label htmlFor="user-buffer-after">{t('availabilitySettings.userHours.appointmentSettings.bufferAfter.label', { defaultValue: 'Buffer Time Between Appointments (Minutes)' })}</Label>
                      <Input
                        id="user-buffer-after"
                        type="number"
                        value={userBufferAfter}
                        onChange={(e) => setUserBufferAfter(e.target.value)}
                        placeholder={t('availabilitySettings.userHours.appointmentSettings.bufferAfter.placeholder', { defaultValue: '15' })}
                      />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="user-default-approver">{t('availabilitySettings.userHours.appointmentSettings.defaultApprover.label', { defaultValue: 'Approvers' })}</Label>
                    <p className="text-xs text-gray-600 mb-2">{t('availabilitySettings.userHours.appointmentSettings.defaultApprover.help', { defaultValue: 'Who should review and approve appointment requests for this technician that require manual approval. Add multiple users and/or teams. Leave empty to use the company-wide approvers.' })}</p>
                    <MultiUserAndTeamPicker
                      id="user-default-approver"
                      users={allUsers.filter(u => u.user_id !== selectedUserId)}
                      values={userApproverUserIds}
                      onValuesChange={setUserApproverUserIds}
                      teams={allTeams}
                      teamValues={userApproverTeamIds}
                      onTeamValuesChange={setUserApproverTeamIds}
                      showSearch
                      placeholder={t('availabilitySettings.common.defaultApprover.placeholder', { defaultValue: 'Select approvers' })}
                    />
                  </div>
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="user-allow-client-preference"
                      checked={userAllowClientPreference}
                      onCheckedChange={setUserAllowClientPreference}
                    />
                    <div>
                      <Label htmlFor="user-allow-client-preference" className="font-medium">{t('availabilitySettings.userHours.appointmentSettings.allowClientPreference.label', { defaultValue: 'Allow Client Preference' })}</Label>
                      <p className="text-sm text-gray-600">{t('availabilitySettings.userHours.appointmentSettings.allowClientPreference.help', { defaultValue: 'Let clients request this technician specifically' })}</p>
                    </div>
                  </div>
                </div>

                <div className="border rounded-lg overflow-hidden">
                  <div className="px-4 py-2 bg-gray-100 dark:bg-gray-800 text-xs text-gray-600 dark:text-gray-400 border-b dark:border-gray-700">
                    {t('availabilitySettings.userHours.schedule.timezoneNotice', { defaultValue: 'Times are in your local timezone ({{timeZone}})', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })}
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="py-2">{t('availabilitySettings.userHours.schedule.columns.day', { defaultValue: 'Day' })}</TableHead>
                        <TableHead className="py-2">{t('availabilitySettings.userHours.schedule.columns.available', { defaultValue: 'Available' })}</TableHead>
                        <TableHead className="py-2">{t('availabilitySettings.userHours.schedule.columns.startTime', { defaultValue: 'Start Time' })}</TableHead>
                        <TableHead className="py-2">{t('availabilitySettings.userHours.schedule.columns.endTime', { defaultValue: 'End Time' })}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {daysOfWeek.map(day => {
                        const hours = userHours[day.value] || buildDefaultUserHours()[day.value];

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
                <Button id="save-user-hours" onClick={handleSaveUserHours} disabled={isSavingUserHours || !canManageUserHours}>
                  <Save className="h-4 w-4 mr-2" />
                  {isSavingUserHours
                    ? t('availabilitySettings.userHours.actions.saving', { defaultValue: 'Saving...' })
                    : t('availabilitySettings.userHours.actions.save', { defaultValue: 'Save User Hours' })}
                </Button>
                </>
                )}
              </div>
            )}

            {/* Configured Users Table */}
            <div className="border-t pt-4 mt-6">
              <h3 className="text-lg font-semibold mb-2">{t('availabilitySettings.userHours.configuredUsers.title', { defaultValue: 'Configured Users' })}</h3>
              <p className="text-sm text-gray-600 mb-4">{t('availabilitySettings.userHours.configuredUsers.description', { defaultValue: 'Technicians with saved booking availability in the current filter' })}</p>
              {configuredUsersData.length === 0 ? (
                <div className="text-center text-gray-500 py-8 border rounded-lg">
                  {t('availabilitySettings.userHours.configuredUsers.empty', { defaultValue: 'No technicians in this filter have saved booking availability yet' })}
                </div>
              ) : (
                <DataTable
                  id="configured-users-table"
                  data={configuredUsersData}
                  columns={configuredUsersColumns}
                  pagination={true}
                  currentPage={usersCurrentPage}
                  onPageChange={setUsersCurrentPage}
                  pageSize={usersPageSize}
                  onItemsPerPageChange={(newSize) => {
                    setUsersPageSize(newSize);
                    setUsersCurrentPage(1);
                  }}
                />
              )}
            </div>
          </TabsContent>

          <TabsContent value="service-rules" className="space-y-4 mt-4">
            <div>
              <Label>{t('availabilitySettings.serviceRules.serviceSelect.label', { defaultValue: 'Select Service to Configure' })}</Label>
              <CustomSelect
                id="service-rules-selector"
                options={serviceOptions}
                value={selectedServiceId || undefined}
                onValueChange={setSelectedServiceId}
                placeholder={t('availabilitySettings.serviceRules.serviceSelect.placeholder', { defaultValue: 'Select a service to configure' })}
              />
            </div>

            {selectedServiceId && (
              <div ref={serviceRulesFormRef} className="scroll-mt-4">
                <div className="border-t pt-4 mt-4">
                  <h3 className="text-lg font-semibold mb-4">
                    {t('availabilitySettings.serviceRules.editor.title', {
                      defaultValue: 'Edit Rules: {{serviceName}}',
                      serviceName: services.find(s => s.service_id === selectedServiceId)?.service_name || ''
                    })}
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
                      <Label htmlFor="allow-without-contract">{t('availabilitySettings.serviceRules.editor.allowWithoutContract.label', { defaultValue: 'Allow Booking Without Contract' })}</Label>
                    </div>

                    <div>
                      <Label htmlFor="max-appointments-per-day">{t('availabilitySettings.serviceRules.editor.maxAppointmentsPerDay.label', { defaultValue: 'Max Appointments Per Day' })}</Label>
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
                        placeholder={t('availabilitySettings.serviceRules.common.noLimit', { defaultValue: 'No limit' })}
                      />
                    </div>

                    <div>
                      <Label htmlFor="service-default-duration">{t('availabilitySettings.serviceRules.editor.defaultDuration.label', { defaultValue: 'Default Appointment Duration (Minutes)' })}</Label>
                      <p className="text-xs text-gray-600 mb-2">
                        {t('availabilitySettings.serviceRules.editor.defaultDuration.help', { defaultValue: 'Default duration for appointments of this service type. Can be overridden by technician-specific settings in User Hours.' })}
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
                        placeholder={t('availabilitySettings.serviceRules.editor.defaultDuration.placeholder', { defaultValue: 'e.g., 60 (minutes)' })}
                      />
                    </div>
                  </div>

                  {canManageSystemSettings && <Button id="save-service-rules" onClick={handleSaveServiceRules} className="mt-4">
                    <Save className="h-4 w-4 mr-2" />
                    {t('availabilitySettings.serviceRules.actions.save', { defaultValue: 'Save Service Rules' })}
                  </Button>}
                </div>
              </div>
            )}

            {/* Configured Services Table */}
            <div className="border-t pt-4 mt-6">
              <h3 className="text-lg font-semibold mb-2">{t('availabilitySettings.serviceRules.configuredServices.title', { defaultValue: 'Configured Services' })}</h3>
              <p className="text-sm text-gray-600 mb-4">{t('availabilitySettings.serviceRules.configuredServices.description', { defaultValue: 'Services with appointment rules configured' })}</p>
              {configuredServicesData.length === 0 ? (
                <div className="text-center text-gray-500 py-8 border rounded-lg">
                  {t('availabilitySettings.serviceRules.configuredServices.empty', { defaultValue: 'No services configured yet' })}
                </div>
              ) : (
                <DataTable
                  id="configured-services-table"
                  data={configuredServicesData}
                  columns={configuredServicesColumns}
                  pagination={true}
                  currentPage={servicesCurrentPage}
                  onPageChange={setServicesCurrentPage}
                  pageSize={servicesPageSize}
                  onItemsPerPageChange={(newSize) => {
                    setServicesPageSize(newSize);
                    setServicesCurrentPage(1);
                  }}
                />
              )}
            </div>
          </TabsContent>

          <TabsContent value="exceptions" className="space-y-4 mt-4">
            {isManager && managedTeams.length > 1 && (
              <div>
                <Label>{t('availabilitySettings.common.teamSelect.label', { defaultValue: 'Select Team' })}</Label>
                <CustomSelect
                  id="team-selector-exceptions"
                  options={managedTeams.map(team => ({
                    value: team.team_id,
                    label: team.team_name
                  }))}
                  value={selectedTeamId || undefined}
                  onValueChange={setSelectedTeamId}
                  placeholder={t('availabilitySettings.common.teamSelect.placeholder', { defaultValue: 'Select a team' })}
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-6">
              <div>
                <h3 className="text-lg font-semibold mb-2">{t('availabilitySettings.exceptions.form.title', { defaultValue: 'Add Exception' })}</h3>
                <div className="space-y-4">
                  <div>
                    <Label>{t('availabilitySettings.exceptions.form.date.label', { defaultValue: 'Select Date' })}</Label>
                    <Calendar
                      mode="single"
                      selected={selectedDate}
                      onSelect={setSelectedDate}
                      className="rounded-md border"
                    />
                  </div>

                  <div>
                    <Label>{t('availabilitySettings.exceptions.form.user.label', { defaultValue: 'User (Optional - leave empty for company-wide)' })}</Label>
                    <CustomSelect
                      id="exception-user-selector"
                      options={[{ value: '__company_wide__', label: t('availabilitySettings.exceptions.common.companyWide', { defaultValue: 'Company-wide' }) }, ...userOptions]}
                      value={exceptionUserId || '__company_wide__'}
                      onValueChange={setExceptionUserId}
                      placeholder={t('availabilitySettings.exceptions.form.user.placeholder', { defaultValue: 'Select user' })}
                      disabled={isManager && !selectedTeamId && managedTeams.length > 1}
                    />
                  </div>

                  <div className="flex items-center space-x-2">
                    <Switch
                      id="exception-is-available"
                      checked={exceptionIsAvailable}
                      onCheckedChange={setExceptionIsAvailable}
                    />
                    <Label htmlFor="exception-is-available">{t('availabilitySettings.exceptions.form.isAvailable.label', { defaultValue: 'Available on this day' })}</Label>
                  </div>

                  <div>
                    <Label htmlFor="exception-reason">{t('availabilitySettings.exceptions.form.reason.label', { defaultValue: 'Reason' })}</Label>
                    <Input
                      id="exception-reason"
                      value={exceptionReason}
                      onChange={(e) => setExceptionReason(e.target.value)}
                      placeholder={t('availabilitySettings.exceptions.form.reason.placeholder', { defaultValue: 'Holiday, Time off, etc.' })}
                    />
                  </div>

                  {canManageSystemSettings && <Button id="add-exception" onClick={handleAddException}>
                    <Plus className="h-4 w-4 mr-2" />
                    {t('availabilitySettings.exceptions.actions.add', { defaultValue: 'Add Exception' })}
                  </Button>}
                </div>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-2">{t('availabilitySettings.exceptions.list.title', { defaultValue: 'Existing Exceptions' })}</h3>
                <div className="space-y-2">
                  {exceptions.length === 0 ? (
                    <p className="text-gray-500 text-sm">{t('availabilitySettings.exceptions.list.empty', { defaultValue: 'No exceptions configured' })}</p>
                  ) : (
                    exceptions.map(exception => {
                      const user = users.find(u => u.user_id === exception.user_id);
                      // Format date properly - handle both string and Date object
                      const dateValue: any = exception.date;
                      const dateStr = dateValue instanceof Date
                        ? dateValue.toISOString().split('T')[0]
                        : typeof dateValue === 'string'
                        ? dateValue.split('T')[0] // Handle ISO strings
                        : String(dateValue);

                      return (
                        <div key={exception.exception_id} className="border rounded p-3 flex justify-between items-start">
                          <div className="flex-1">
                            <div className="font-medium">{dateStr}</div>
                            <div className="text-sm text-gray-600">
                              {user ? `${user.first_name} ${user.last_name}` : t('availabilitySettings.exceptions.common.companyWide', { defaultValue: 'Company-wide' })}
                            </div>
                            {exception.reason && (
                              <div className="text-sm text-gray-500 italic">{exception.reason}</div>
                            )}
                            <Badge variant={exception.is_available ? 'success' : 'error'} className="mt-1">
                              {exception.is_available ? t('availabilitySettings.exceptions.list.status.available', { defaultValue: 'Available' }) : t('availabilitySettings.exceptions.list.status.unavailable', { defaultValue: 'Unavailable' })}
                            </Badge>
                          </div>
                          {canManageSystemSettings && <Button
                            id={`delete-exception-${exception.exception_id}`}
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteException(exception.exception_id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>}
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

      <ConfirmationDialog
        isOpen={!!userToDelete}
        onClose={() => {
          if (!isDeleting) setUserToDelete(null);
        }}
        onConfirm={handleConfirmDeleteUser}
        title={t('availabilitySettings.userHours.deleteDialog.title', { defaultValue: 'Delete User Availability' })}
        message={t('availabilitySettings.userHours.deleteDialog.message', {
          defaultValue: 'Are you sure you want to delete availability settings for {{userName}}? This will remove all their configured working hours. This action cannot be undone.',
          userName: userToDelete ? `${userToDelete.first_name} ${userToDelete.last_name}` : ''
        })}
        confirmLabel={isDeleting
          ? t('availabilitySettings.common.actions.deleting', { defaultValue: 'Deleting...' })
          : t('availabilitySettings.common.actions.delete', { defaultValue: 'Delete' })}
      />

      <ConfirmationDialog
        isOpen={!!serviceToDelete}
        onClose={() => {
          if (!isDeleting) setServiceToDelete(null);
        }}
        onConfirm={handleConfirmDeleteService}
        title={t('availabilitySettings.serviceRules.deleteDialog.title', { defaultValue: 'Delete Service Rules' })}
        message={t('availabilitySettings.serviceRules.deleteDialog.message', {
          defaultValue: 'Are you sure you want to delete the rules for {{serviceName}}? This action cannot be undone.',
          serviceName: serviceToDelete?.service_name || ''
        })}
        confirmLabel={isDeleting
          ? t('availabilitySettings.common.actions.deleting', { defaultValue: 'Deleting...' })
          : t('availabilitySettings.common.actions.delete', { defaultValue: 'Delete' })}
      />
    </Dialog>
  );
}
