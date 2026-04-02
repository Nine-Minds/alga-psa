'use client';

// Auth-owned user role assignment UI.

import { useState, useEffect, useMemo } from 'react';
import { Flex, Text } from '@radix-ui/themes';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardHeader, CardContent, CardTitle, CardDescription } from '@alga-psa/ui/components/Card';
import ViewSwitcher, { ViewSwitcherOption } from '@alga-psa/ui/components/ViewSwitcher';
import { SwitchWithLabel } from '@alga-psa/ui/components/SwitchWithLabel';
import { assignRoleToUser, removeRoleFromUser, getRoles, getUserRoles } from '@alga-psa/auth/actions';
import { getAllUsers, getUserAvatarUrlsBatchAction } from '@alga-psa/user-composition/actions';
import type { IRole, IUserWithRoles } from '@alga-psa/types';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import type { ColumnDefinition } from '@alga-psa/types';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import UserPicker from '@alga-psa/ui/components/UserPicker';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

type ViewMode = 'msp' | 'client';

// viewOptions is defined inside the component to access translations

export default function UserRoleAssignment() {
  const { t } = useTranslation('msp/profile');

  const viewOptions: ViewSwitcherOption<ViewMode>[] = [
    { value: 'msp', label: t('security.userRoles.viewSwitcher.msp') },
    { value: 'client', label: t('security.userRoles.viewSwitcher.clientPortal') },
  ];

  const [users, setUsers] = useState<IUserWithRoles[]>([]);
  const [roles, setRoles] = useState<IRole[]>([]);
  const [selectedUser, setSelectedUser] = useState<string>('');
  const [selectedRole, setSelectedRole] = useState<string>('');
  const [userRoles, setUserRoles] = useState<{ [key: string]: IRole[] }>({});
  const [viewMode, setViewMode] = useState<ViewMode>('msp');
  const [showInactiveUsers, setShowInactiveUsers] = useState<boolean>(false);

  useEffect(() => {
    fetchUsers();
    fetchRoles();
  }, []);

  const fetchUsers = async () => {
    try {
      const fetchedUsers = await getAllUsers();
      setUsers(fetchedUsers);
      // Fetch roles for each user
      fetchedUsers.forEach(user => {
        fetchUserRoles(user.user_id);
      });
    } catch (error) {
      console.error('Error fetching users:', error);
    }
  };

  const fetchRoles = async () => {
    const fetchedRoles = await getRoles();
    // Sort roles alphabetically by role_name
    const sortedRoles = fetchedRoles.sort((a, b) => a.role_name.localeCompare(b.role_name));
    setRoles(sortedRoles);
  };

  const fetchUserRoles = async (userId: string) => {
    const fetchedUserRoles = await getUserRoles(userId);
    setUserRoles(prevUserRoles => ({ ...prevUserRoles, [userId]: fetchedUserRoles }));
  };

  const handleAssignRole = async () => {
    if (selectedUser && selectedRole) {
      await assignRoleToUser(selectedUser, selectedRole);
      fetchUserRoles(selectedUser);
      // Reset selections
      setSelectedUser('');
      setSelectedRole('');
    }
  };

  const handleRemoveRole = async (userId: string, roleId: string) => {
    await removeRoleFromUser(userId, roleId);
    fetchUserRoles(userId);
  };

  // Filter users based on view mode and inactive status
  const filteredUsers = useMemo(() => {
    let filtered = users;

    // Filter by user roles based on view mode
    // A user should appear in a view if they have at least one role for that portal
    filtered = filtered.filter(user => {
      const userRoleList = userRoles[user.user_id] || [];
      if (viewMode === 'msp') {
        // Show users who have at least one MSP role
        return userRoleList.some(role => role.msp);
      } else {
        // Show users who have at least one client portal role
        return userRoleList.some(role => role.client);
      }
    });

    // Filter out inactive users unless showInactiveUsers is true
    if (!showInactiveUsers) {
      filtered = filtered.filter(user => !user.is_inactive);
    }

    return filtered;
  }, [users, viewMode, showInactiveUsers, userRoles]);

  // Filter roles based on view mode
  const filteredRoles = useMemo(() => {
    return roles.filter(role => viewMode === 'msp' ? role.msp : role.client);
  }, [roles, viewMode]);

  // Filter user roles to only show relevant roles for current view
  const getFilteredUserRoles = (userId: string) => {
    const roles = userRoles[userId] || [];
    return roles.filter(role => viewMode === 'msp' ? role.msp : role.client);
  };

  const columns: ColumnDefinition<IUserWithRoles>[] = [
    {
      title: t('security.userRoles.table.user'),
      dataIndex: 'username',
      render: (_, record) => {
        const displayName = `${record.first_name || ''} ${record.last_name || ''}`.trim()
          || record.username
          || t('security.userRoles.unnamedUser', { defaultValue: 'Unnamed User' });
        return (
          <div className="flex items-center gap-2">
            <span>{displayName}</span>
            {record.is_inactive && (
              <span className="text-xs text-gray-500">{t('security.userRoles.inactiveTag')}</span>
            )}
          </div>
        );
      },
    },
    {
      title: t('security.userRoles.table.email'),
      dataIndex: 'email',
    },
    {
      title: t('security.userRoles.table.roles'),
      dataIndex: 'user_id',
      render: (userId) => {
        const roles = getFilteredUserRoles(userId);
        return roles.map(role => role.role_name).join(', ') || t('security.userRoles.noRolesAssigned');
      },
    },
    {
      title: t('security.userRoles.table.actions'),
      dataIndex: 'user_id',
      width: '20%',
      render: (userId) => {
        const roles = getFilteredUserRoles(userId);
        return (
          <Flex gap="2" wrap="wrap">
            {roles.map((role) => (
              <Button
                id={`remove-role-${userId}-${role.role_id}-btn`}
                key={role.role_id}
                variant="destructive"
                size="sm"
                onClick={() => handleRemoveRole(userId, role.role_id)}
              >
                {t('security.userRoles.removeRole', { role: role.role_name })}
              </Button>
            ))}
          </Flex>
        );
      },
    },
  ];

  const roleOptions = filteredRoles.map((role): SelectOption => ({
    value: role.role_id,
    label: role.role_name
  }));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{t('security.userRoles.title')}</CardTitle>
            <CardDescription>
              {viewMode === 'msp' ? t('security.userRoles.description.msp') : t('security.userRoles.description.client')}
            </CardDescription>
          </div>
          <div className="flex items-center gap-4">
            <SwitchWithLabel
              label={t('security.userRoles.showInactive')}
              checked={showInactiveUsers}
              onCheckedChange={setShowInactiveUsers}
            />
            <ViewSwitcher
              currentView={viewMode}
              onChange={setViewMode}
              options={viewOptions}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Flex direction="column" gap="4">
          <div className="flex items-end gap-3 p-4 bg-gray-50 rounded-lg">
            <UserPicker
              value={selectedUser}
              onValueChange={setSelectedUser}
              users={filteredUsers}
              getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
              label={t('security.userRoles.fields.selectUser')}
              buttonWidth="fit"
              userTypeFilter={viewMode === 'client' ? 'client' : 'internal'}
            />
            <div>
              <h5 className="font-bold mb-1">{t('security.userRoles.fields.selectRole')}</h5>
              <CustomSelect
                value={selectedRole}
                onValueChange={setSelectedRole}
                options={roleOptions}
                placeholder={t('security.userRoles.fields.selectRole')}
              />
            </div>
            <Button 
              id="assign-role-btn" 
              onClick={handleAssignRole}
              disabled={!selectedUser || !selectedRole}
            >
              {t('security.userRoles.actions.assignRole')}
            </Button>
          </div>

          {filteredUsers.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              {t('security.userRoles.emptyState.noUsers', {
                type: viewMode === 'msp'
                  ? t('security.userRoles.viewSwitcher.msp', { defaultValue: 'MSP' })
                  : t('security.userRoles.viewSwitcher.clientPortal', { defaultValue: 'Client Portal' }),
              })}
              {!showInactiveUsers && ` ${t('security.userRoles.emptyState.inactiveHidden')}`}
            </div>
          ) : (
            <DataTable
              id="user-role-assignment-table"
              data={filteredUsers}
              columns={columns}
              pagination={false}
              pageSize={999} // Show all users
            />
          )}
        </Flex>
      </CardContent>
    </Card>
  );
}
