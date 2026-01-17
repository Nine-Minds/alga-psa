'use client';

import { useState, useEffect } from 'react';
import { Flex, Text } from '@radix-ui/themes';
import { Button } from '@alga-psa/ui/components/Button';
import { createRole, updateRole, deleteRole, getRoles } from 'server/src/lib/actions/policyActions';
import { IRole } from 'server/src/interfaces/auth.interfaces';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import GenericDialog from '@alga-psa/ui/components/GenericDialog';
import { Card, CardHeader, CardContent, CardTitle, CardDescription } from '@alga-psa/ui/components/Card';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';

export default function RoleManagement() {
  const [roles, setRoles] = useState<IRole[]>([]);
  const [newRole, setNewRole] = useState({ 
    role_name: '', 
    description: '',
    msp: true,
    client: false
  });
  const [editingRole, setEditingRole] = useState<IRole | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  useEffect(() => {
    fetchRoles();
  }, []);

  const fetchRoles = async () => {
    const fetchedRoles = await getRoles();
    // Sort roles alphabetically by role_name
    const sortedRoles = fetchedRoles.sort((a, b) => a.role_name.localeCompare(b.role_name));
    setRoles(sortedRoles);
  };

  const handleCreateRole = async () => {
    await createRole(newRole.role_name, newRole.description, newRole.msp, newRole.client);
    setNewRole({ 
      role_name: '', 
      description: '',
      msp: true,
      client: false
    });
    setIsCreateDialogOpen(false);
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
    try {
      await deleteRole(roleId);
      fetchRoles();
    } catch (error) {
      console.error('Error deleting role:', error);
      // Show error message to user
      alert(error instanceof Error ? error.message : 'Failed to delete role');
    }
  };

  const columns: ColumnDefinition<IRole>[] = [
    {
      title: 'Role Name *',
      dataIndex: 'role_name',
    },
    {
      title: 'Description',
      dataIndex: 'description',
    },
    {
      title: 'Portal',
      dataIndex: 'role_id',
      width: '150px',
      render: (_, record) => {
        const portals: string[] = [];
        if (record.msp) portals.push('MSP');
        if (record.client) portals.push('Client');
        return (
          <span className="text-sm">
            {portals.join(', ') || 'None'}
          </span>
        );
      }
    },
    {
      title: 'Actions',
      dataIndex: 'role_id',
      width: '150px',
      render: (roleId, role) => {
        const isAdminRole = role.role_name.toLowerCase() === 'admin';
        const button = (
          <Button
            variant="destructive"
            id="delete-role-button"
            size="sm"
            onClick={() => handleDeleteRole(roleId)}
            disabled={isAdminRole}
          >
            Delete
          </Button>
        );

        if (isAdminRole) {
          return (
            <Tooltip content="Admin roles cannot be deleted as they are system roles">
              <span>{button}</span>
            </Tooltip>
          );
        }
        
        return button;
      }
    }
  ];

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Manage Roles</CardTitle>
              <CardDescription>
                Create and manage roles for MSP and Client Portal access
              </CardDescription>
            </div>
            <Button 
              id="create-role-btn" 
              onClick={() => setIsCreateDialogOpen(true)}
            >
              Add Role
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            id="roles-table"
            data={roles}
            columns={columns}
            pagination={false}
            pageSize={999}
          />
        </CardContent>
      </Card>

      {/* Create Role Dialog */}
      <GenericDialog
        isOpen={isCreateDialogOpen}
        onClose={() => {
          setIsCreateDialogOpen(false);
          setNewRole({ 
            role_name: '', 
            description: '',
            msp: true,
            client: false
          });
        }}
        title="Create New Role"
        id="create-role-dialog"
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="role-name">Role Name</Label>
            <Input
              id="role-name"
              type="text"
              placeholder="Enter role name"
              value={newRole.role_name}
              onChange={(e) => setNewRole({ ...newRole, role_name: e.target.value })}
            />
          </div>
          
          <div>
            <Label htmlFor="role-description">Description</Label>
            <TextArea
              id="role-description"
              placeholder="Enter role description"
              value={newRole.description}
              onChange={(e) => setNewRole({ ...newRole, description: e.target.value })}
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label>Portal Access</Label>
            <div className="space-y-2">
              <label className="flex items-center space-x-2">
                <Checkbox
                  checked={newRole.msp}
                  onChange={(e) => 
                    setNewRole({ ...newRole, msp: e.target.checked })
                  }
                />
                <span>MSP Portal</span>
              </label>
              <label className="flex items-center space-x-2">
                <Checkbox
                  checked={newRole.client}
                  onChange={(e) => 
                    setNewRole({ ...newRole, client: e.target.checked })
                  }
                />
                <span>Client Portal</span>
              </label>
            </div>
            <p className="text-sm text-gray-500">
              A role must have access to at least one portal
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button
              id="cancel-create-role-btn"
              variant="outline"
              onClick={() => {
                setIsCreateDialogOpen(false);
                setNewRole({ 
                  role_name: '', 
                  description: '',
                  msp: true,
                  client: false
                });
              }}
            >
              Cancel
            </Button>
            <Button
              id="confirm-create-role-btn"
              onClick={handleCreateRole}
              disabled={!newRole.role_name || (!newRole.msp && !newRole.client)}
            >
              Create Role
            </Button>
          </div>
        </div>
      </GenericDialog>
    </>
  );
}
