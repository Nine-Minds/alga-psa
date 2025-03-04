'use client';

import { useState, useEffect, useCallback } from 'react';
import { Flex, Text, Checkbox } from '@radix-ui/themes';
import { getPermissions, getRoles, getRolePermissions, assignPermissionToRole, removePermissionFromRole } from 'server/src/lib/actions/policyActions';
import { IPermission, IRole } from 'server/src/interfaces/auth.interfaces';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import CustomSelect from 'server/src/components/ui/CustomSelect';

export default function PermissionManagement() {
  const [permissions, setPermissions] = useState<IPermission[]>([]);
  const [roles, setRoles] = useState<IRole[]>([]);
  const [selectedResource, setSelectedResource] = useState<string>('');
  const [selectedRole, setSelectedRole] = useState<string>('');
  const [rolePermissions, setRolePermissions] = useState<string[]>([]);
  const [isUpdating, setIsUpdating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPermissions = useCallback(async () => {
    try {
      const fetchedPermissions = await getPermissions();
      console.log('Fetched permissions:', fetchedPermissions);
      setPermissions(fetchedPermissions);
    } catch (err) {
      console.error('Error fetching permissions:', err);
      setError('Failed to fetch permissions');
    }
  }, []);

  const fetchRoles = useCallback(async () => {
    try {
      const fetchedRoles = await getRoles();
      console.log('Fetched roles:', fetchedRoles);
      setRoles(fetchedRoles);
    } catch (err) {
      console.error('Error fetching roles:', err);
      setError('Failed to fetch roles');
    }
  }, []);

  const fetchRolePermissions = useCallback(async (roleId: string) => {
    try {
      const fetchedRolePermissions = await getRolePermissions(roleId);
      console.log('Fetched role permissions:', fetchedRolePermissions);
      setRolePermissions(fetchedRolePermissions.map((p: IPermission): string => p.permission_id));
    } catch (err) {
      console.error('Error fetching role permissions:', err);
      setError('Failed to fetch role permissions');
    }
  }, []);

  useEffect(() => {
    const initializeComponent = async () => {
      await Promise.all([
        fetchPermissions(),
        fetchRoles()
      ]);
    };
    initializeComponent();
  }, [fetchPermissions, fetchRoles]);

  useEffect(() => {
    if (roles.length > 0) {
      const adminRole = roles.find(role => role.role_name.toLowerCase() === 'admin');
      if (adminRole) {
        setSelectedRole(adminRole.role_id);
        fetchRolePermissions(adminRole.role_id);
      }
    }
  }, [roles, fetchRolePermissions]);

  useEffect(() => {
    if (selectedRole) {
      fetchRolePermissions(selectedRole);
    }
  }, [selectedRole, fetchRolePermissions]);

  const handlePermissionAssignment = async (permissionId: string, isAssigned: boolean) => {
    if (!selectedRole || isUpdating) return;

    setIsUpdating(true);
    setError(null);
    
    try {
      if (isAssigned) {
        await assignPermissionToRole(selectedRole, permissionId);
        setRolePermissions(prev => [...prev, permissionId]);
      } else {
        await removePermissionFromRole(selectedRole, permissionId);
        setRolePermissions(prev => prev.filter(id => id !== permissionId));
      }
    } catch (err) {
      console.error('Error updating permission:', err);
      setError('Failed to update permission');
      // Revert on error
      await fetchRolePermissions(selectedRole);
    } finally {
      setIsUpdating(false);
    }
  };

  const resources = Array.from(new Set(permissions.map((p: IPermission): string => p.resource)));
  
  const resourceOptions = [
    { value: 'all', label: 'All Resources' },
    ...resources.map((resource): { value: string; label: string } => ({
      value: resource,
      label: resource
    }))
  ];

  const roleOptions = roles.map((role): { value: string; label: string } => ({
    value: role.role_id,
    label: role.role_name
  }));

  const columns: ColumnDefinition<IPermission>[] = [
    {
      title: 'Resource',
      dataIndex: 'resource',
    },
    {
      title: 'Action',
      dataIndex: 'action',
    },
    {
      title: 'Allowed',
      dataIndex: 'permission_id',
      render: (value: string, record: IPermission) => (
        selectedRole && (
          <Checkbox 
            checked={rolePermissions.includes(record.permission_id)}
            onCheckedChange={(checked) => {
              if (typeof checked === 'boolean') {
                handlePermissionAssignment(record.permission_id, checked);
              }
            }}
            disabled={isUpdating}
          />
        )
      ),
    },
  ];

  const filteredPermissions = permissions.filter(p => 
    !selectedResource || selectedResource === 'all' || p.resource === selectedResource
  );

  if (permissions.length === 0 || roles.length === 0) {
    return <div>Loading...</div>;
  }

  return (
    <div>
      <Flex direction="column" gap="4">
        <Text size="5" weight="bold">Manage Permissions</Text>
        {error && (
          <Text color="red" size="2">{error}</Text>
        )}
        <Flex direction="column" gap="2">
          <Flex align="center" gap="2">
            <Text size="2" weight="bold" style={{ width: '100px' }}>Resource:</Text>
            <div className="relative z-20 inline-block">
              <CustomSelect
                value={selectedResource || 'all'}
                onValueChange={setSelectedResource}
                options={resourceOptions}
                placeholder="Select Resource"
              />
            </div>
          </Flex>
          <Flex align="center" gap="2">
            <Text size="2" weight="bold" style={{ width: '100px' }}>Role:</Text>
            <div className="relative z-10 inline-block">
              <CustomSelect
                value={selectedRole}
                onValueChange={setSelectedRole}
                options={roleOptions}
                placeholder="Select Role"
              />
            </div>
          </Flex>
        </Flex>
        
        <DataTable
          data={filteredPermissions}
          columns={columns}
          pagination={true}
        />
      </Flex>
    </div>
  );
}
