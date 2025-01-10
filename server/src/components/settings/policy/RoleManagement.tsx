'use client';

import { useState, useEffect } from 'react';
import { Flex, Text } from '@radix-ui/themes';
import { Button } from '@/components/ui/Button';
import { createRole, updateRole, deleteRole, getRoles } from '@/lib/actions/policyActions';
import { IRole } from '@/interfaces/auth.interfaces';
import { DataTable } from '@/components/ui/DataTable';
import { ColumnDefinition } from '@/interfaces/dataTable.interfaces';

export default function RoleManagement() {
  const [roles, setRoles] = useState<IRole[]>([]);
  const [newRole, setNewRole] = useState({ role_name: '', description: '' });
  const [editingRole, setEditingRole] = useState<IRole | null>(null);

  useEffect(() => {
    fetchRoles();
  }, []);

  const fetchRoles = async () => {
    const fetchedRoles = await getRoles();
    setRoles(fetchedRoles);
  };

  const handleCreateRole = async () => {
    await createRole(newRole.role_name, newRole.description);
    setNewRole({ role_name: '', description: '' });
    fetchRoles();
  };

  const handleUpdateRole = async () => {
    if (editingRole) {
      await updateRole(editingRole.role_id, editingRole.role_name);
      setEditingRole(null);
      fetchRoles();
    }
  };

  const handleDeleteRole = async (roleId: string) => {
    await deleteRole(roleId);
    fetchRoles();
  };

  const columns: ColumnDefinition<IRole>[] = [
    {
      title: 'Role Name',
      dataIndex: 'role_name',
    },
    {
      title: 'Description',
      dataIndex: 'description',
    },
  ];

  return (
    <div>
      <Flex direction="column" gap="4">
        <Text size="5" weight="bold">Manage Roles</Text>
        <Flex gap="2">
          <input
            type="text"
            placeholder="Role Name"
            value={newRole.role_name}
            onChange={(e) => setNewRole({ ...newRole, role_name: e.target.value })}
          />
          <input
            type="text"
            placeholder="Description"
            value={newRole.description}
            onChange={(e) => setNewRole({ ...newRole, description: e.target.value })}
          />
          <Button id="create-role-btn" onClick={handleCreateRole}>Create Role</Button>
        </Flex>

        <DataTable
          data={roles}
          columns={columns}
          pagination={false}
        />

        {editingRole && (
          <Flex direction="column" gap="2">
            <Text size="4" weight="bold">Edit Role</Text>
            <input
              type="text"
              placeholder="Role Name"
              value={editingRole.role_name}
              onChange={(e) => setEditingRole({ ...editingRole, role_name: e.target.value })}
            />
            <Flex gap="2">
              <Button id="update-role-btn" onClick={handleUpdateRole}>Update Role</Button>
              <Button id="cancel-edit-role-btn" variant="soft" onClick={() => setEditingRole(null)}>Cancel</Button>
            </Flex>
          </Flex>
        )}
      </Flex>
    </div>
  );
}
