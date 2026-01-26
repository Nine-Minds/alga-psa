'use client';

// Auth-owned user role assignment UI.

import { useState, useEffect, useMemo } from 'react';
import { Flex, Text } from '@radix-ui/themes';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardHeader, CardContent, CardTitle, CardDescription } from '@alga-psa/ui/components/Card';
import ViewSwitcher, { ViewSwitcherOption } from '@alga-psa/ui/components/ViewSwitcher';
import { SwitchWithLabel } from '@alga-psa/ui/components/SwitchWithLabel';
import { assignRoleToUser, removeRoleFromUser, getRoles, getUserRoles } from '@alga-psa/auth/actions';
import { getAllUsers } from '@alga-psa/users/actions';
import type { IRole, IUserWithRoles } from '@alga-psa/types';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import type { ColumnDefinition } from '@alga-psa/types';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import UserPicker from '@alga-psa/ui/components/UserPicker';

type ViewMode = 'msp' | 'client';

const viewOptions: ViewSwitcherOption<ViewMode>[] = [
  { value: 'msp', label: 'MSP' },
  { value: 'client', label: 'Client Portal' },
];

export default function UserRoleAssignment() {
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
      title: 'User',
      dataIndex: 'username',
      render: (_, record) => {
        const displayName = `${record.first_name || ''} ${record.last_name || ''}`.trim() || record.username || 'Unnamed User';
        return (
          <div className="flex items-center gap-2">
            <span>{displayName}</span>
            {record.is_inactive && (
              <span className="text-xs text-gray-500">(Inactive)</span>
            )}
          </div>
        );
      },
    },
    {
      title: 'Email',
      dataIndex: 'email',
    },
    {
      title: 'Roles',
      dataIndex: 'user_id',
      render: (userId) => {
        const roles = getFilteredUserRoles(userId);
        return roles.map(role => role.role_name).join(', ') || 'No roles assigned';
      },
    },
    {
      title: 'Actions',
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
                Remove {role.role_name}
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
            <CardTitle>Assign Roles to Users</CardTitle>
            <CardDescription>
              Manage user role assignments for {viewMode === 'msp' ? 'MSP' : 'Client Portal'} users
            </CardDescription>
          </div>
          <div className="flex items-center gap-4">
            <SwitchWithLabel
              label="Show Inactive Users"
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
              label="Select User"
              buttonWidth="fit"
              userTypeFilter={viewMode === 'client' ? 'client' : 'internal'}
            />
            <div>
              <h5 className="font-bold mb-1">Select Role</h5>
              <CustomSelect
                value={selectedRole}
                onValueChange={setSelectedRole}
                options={roleOptions}
                placeholder="Select Role"
              />
            </div>
            <Button 
              id="assign-role-btn" 
              onClick={handleAssignRole}
              disabled={!selectedUser || !selectedRole}
            >
              Assign Role
            </Button>
          </div>

          {filteredUsers.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              No {viewMode === 'msp' ? 'MSP' : 'Client Portal'} users found
              {!showInactiveUsers && ' (inactive users hidden)'}
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
