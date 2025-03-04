'use client';

import { useState, useEffect } from 'react';
import { Flex, Text } from '@radix-ui/themes';
import { Button } from 'server/src/components/ui/Button';
import { assignRoleToUser, removeRoleFromUser, getRoles, getUserRoles } from 'server/src/lib/actions/policyActions';
import { getAllUsers } from 'server/src/lib/actions/user-actions/userActions';
import { IRole, IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import CustomSelect, { SelectOption } from 'server/src/components/ui/CustomSelect';
import UserPicker from 'server/src/components/ui/UserPicker';

export default function UserRoleAssignment() {
  const [users, setUsers] = useState<IUserWithRoles[]>([]);
  const [roles, setRoles] = useState<IRole[]>([]);
  const [selectedUser, setSelectedUser] = useState<string>('');
  const [selectedRole, setSelectedRole] = useState<string>('');
  const [userRoles, setUserRoles] = useState<{ [key: string]: IRole[] }>({});

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
    setRoles(fetchedRoles);
  };

  const fetchUserRoles = async (userId: string) => {
    const fetchedUserRoles = await getUserRoles(userId);
    setUserRoles(prevUserRoles => ({ ...prevUserRoles, [userId]: fetchedUserRoles }));
  };

  const handleAssignRole = async () => {
    if (selectedUser && selectedRole) {
      await assignRoleToUser(selectedUser, selectedRole);
      fetchUserRoles(selectedUser);
    }
  };

  const handleRemoveRole = async (userId: string, roleId: string) => {
    await removeRoleFromUser(userId, roleId);
    fetchUserRoles(userId);
  };

  const columns: ColumnDefinition<IUserWithRoles>[] = [
    {
      title: 'User',
      dataIndex: 'username',
      render: (_, record) => `${record.first_name || ''} ${record.last_name || ''}`.trim() || record.username || 'Unnamed User',
    },
    {
      title: 'Roles',
      dataIndex: 'user_id',
      render: (_, record) => userRoles[record.user_id]?.map((role): string => role.role_name).join(', '),
    },
    {
      title: 'Actions',
      dataIndex: 'user_id',
      render: (userId) => (
        <Flex gap="2">
          {userRoles[userId]?.map((role): JSX.Element => (
            <Button 
              id={`remove-role-${userId}-${role.role_id}-btn`}
              key={role.role_id} 
              color="red" 
              onClick={() => handleRemoveRole(userId, role.role_id)}
            >
              Remove {role.role_name}
            </Button>
          ))}
        </Flex>
      ),
    },
  ];

  const roleOptions = roles.map((role): SelectOption => ({
    value: role.role_id,
    label: role.role_name
  }));

  return (
    <div>
      <Flex direction="column" gap="4">
        <Text size="5" weight="bold">Assign Roles to Users</Text>
        <Flex gap="2" align="center">
          <div className="relative z-20 inline-block">
            <UserPicker
              value={selectedUser}
              onValueChange={setSelectedUser}
              users={users}
              label="Select User"
            />
          </div>
          <div className="relative z-10 inline-block">
            <CustomSelect
              value={selectedRole}
              onValueChange={setSelectedRole}
              options={roleOptions}
              placeholder="Select Role"
            />
          </div>
          <Button id="assign-role-btn" onClick={handleAssignRole}>Assign Role</Button>
        </Flex>

        <DataTable
          data={users}
          columns={columns}
          pagination={false}
        />
      </Flex>
    </div>
  );
}
