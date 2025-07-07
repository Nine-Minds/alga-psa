'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardHeader, CardContent, CardTitle, CardDescription } from 'server/src/components/ui/Card';
import { SelectOption } from 'server/src/components/ui/CustomSelect';
import { ChevronDown, ChevronRight } from 'lucide-react';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Checkbox } from 'server/src/components/ui/Checkbox';
import { Tooltip } from 'server/src/components/ui/Tooltip';
import ViewSwitcher, { ViewSwitcherOption } from 'server/src/components/ui/ViewSwitcher';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { 
  getPermissions, 
  getRoles, 
  getRolePermissions, 
  assignPermissionToRole, 
  removePermissionFromRole 
} from 'server/src/lib/actions/policyActions';
import { IPermission, IRole } from 'server/src/interfaces/auth.interfaces';

type ViewMode = 'msp' | 'client';

const viewOptions: ViewSwitcherOption<ViewMode>[] = [
  { value: 'msp', label: 'MSP' },
  { value: 'client', label: 'Client Portal' },
];

interface PermissionRow {
  resource: string;
  create?: IPermission;
  read?: IPermission;
  update?: IPermission;
  delete?: IPermission;
  specialActions: IPermission[];
}

export default function PermissionsMatrix() {
  const [permissions, setPermissions] = useState<IPermission[]>([]);
  const [roles, setRoles] = useState<IRole[]>([]);
  const [selectedRole, setSelectedRole] = useState<string>('');
  const [rolePermissions, setRolePermissions] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('msp');
  const [selectedResource, setSelectedResource] = useState<string>('all');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Standard CRUD actions
  const standardActions = ['create', 'read', 'update', 'delete'];

  // Fetch initial data
  const fetchPermissions = useCallback(async () => {
    try {
      const data = await getPermissions();
      setPermissions(data);
    } catch (err) {
      console.error('Error fetching permissions:', err);
      setError('Failed to fetch permissions');
    }
  }, []);

  const fetchRoles = useCallback(async () => {
    try {
      const data = await getRoles();
      setRoles(data);
    } catch (err) {
      console.error('Error fetching roles:', err);
      setError('Failed to fetch roles');
    }
  }, []);

  const fetchRolePermissions = useCallback(async (roleId: string) => {
    try {
      const data = await getRolePermissions(roleId);
      setRolePermissions(data.map((p: IPermission) => p.permission_id));
    } catch (err) {
      console.error('Error fetching role permissions:', err);
      setError('Failed to fetch role permissions');
    }
  }, []);

  useEffect(() => {
    fetchPermissions();
    fetchRoles();
  }, [fetchPermissions, fetchRoles]);

  useEffect(() => {
    if (selectedRole) {
      fetchRolePermissions(selectedRole);
    }
  }, [selectedRole, fetchRolePermissions]);

  // Filter permissions by view mode
  const filteredPermissions = useMemo(() => {
    return permissions.filter(p => viewMode === 'msp' ? p.msp : p.client);
  }, [permissions, viewMode]);

  // Filter roles by view mode
  const filteredRoles = useMemo(() => {
    return roles.filter(r => viewMode === 'msp' ? r.msp : r.client);
  }, [roles, viewMode]);

  // Get unique resources for dropdown
  const resourceOptions = useMemo((): SelectOption[] => {
    const resources = new Set<string>();
    filteredPermissions.forEach(p => resources.add(p.resource));
    
    const sortedResources = Array.from(resources).sort();
    
    return [
      { value: 'all', label: 'All Resources' },
      ...sortedResources.map(resource => ({
        value: resource,
        label: resource.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
      }))
    ];
  }, [filteredPermissions]);

  // Create permission rows (one per resource)
  const permissionRows = useMemo((): PermissionRow[] => {
    const rows = new Map<string, PermissionRow>();
    
    filteredPermissions.forEach(permission => {
      if (!rows.has(permission.resource)) {
        rows.set(permission.resource, {
          resource: permission.resource,
          specialActions: []
        });
      }
      
      const row = rows.get(permission.resource)!;
      
      if (standardActions.includes(permission.action)) {
        row[permission.action as 'create' | 'read' | 'update' | 'delete'] = permission;
      } else {
        row.specialActions.push(permission);
      }
    });

    // Sort and filter by selected resource
    return Array.from(rows.values())
      .filter(row => 
        selectedResource === 'all' || 
        row.resource === selectedResource
      )
      .sort((a, b) => a.resource.localeCompare(b.resource));
  }, [filteredPermissions, selectedResource]);

  // Handle permission toggle
  const handlePermissionToggle = async (permissionId: string, checked: boolean) => {
    if (!selectedRole || isUpdating) return;

    setIsUpdating(true);
    setError(null);

    try {
      if (checked) {
        await assignPermissionToRole(selectedRole, permissionId);
        setRolePermissions(prev => [...prev, permissionId]);
      } else {
        await removePermissionFromRole(selectedRole, permissionId);
        setRolePermissions(prev => prev.filter(id => id !== permissionId));
      }
    } catch (err) {
      console.error('Error updating permission:', err);
      setError('Failed to update permission');
      await fetchRolePermissions(selectedRole);
    } finally {
      setIsUpdating(false);
    }
  };

  // Toggle row expansion for special actions
  const toggleRow = (resource: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(resource)) {
        next.delete(resource);
      } else {
        next.add(resource);
      }
      return next;
    });
  };

  // Calculate statistics
  const stats = useMemo(() => {
    const totalPermissions = filteredPermissions.length;
    const assignedPermissions = filteredPermissions.filter(p => 
      rolePermissions.includes(p.permission_id)
    ).length;
    return { total: totalPermissions, assigned: assignedPermissions };
  }, [filteredPermissions, rolePermissions]);

  // Helper function to render permission checkbox with optional tooltip
  const renderPermissionCheckbox = (permission: IPermission | undefined) => {
    if (!permission) {
      return <span className="text-gray-400">-</span>;
    }

    const checkbox = (
      <Checkbox
        checked={rolePermissions.includes(permission.permission_id)}
        onChange={(e) => handlePermissionToggle(permission.permission_id, e.target.checked)}
        disabled={isUpdating || !selectedRole}
      />
    );

    if (permission.description) {
      return (
        <Tooltip content={permission.description}>
          <div className="inline-block">
            {checkbox}
          </div>
        </Tooltip>
      );
    }

    return checkbox;
  };

  // Define columns for DataTable
  const columns: ColumnDefinition<PermissionRow>[] = [
    {
      title: 'Resource',
      dataIndex: 'resource',
      width: '30%',
      render: (value: string) => (
        <span className="font-medium capitalize">
          {value.replace(/_/g, ' ')}
        </span>
      )
    },
    {
      title: 'Create',
      dataIndex: 'create',
      width: '10%',
      render: (value: IPermission | undefined) => (
        <div>
          {renderPermissionCheckbox(value)}
        </div>
      )
    },
    {
      title: 'Read',
      dataIndex: 'read',
      width: '10%',
      render: (value: IPermission | undefined) => (
        <div>
          {renderPermissionCheckbox(value)}
        </div>
      )
    },
    {
      title: 'Update',
      dataIndex: 'update',
      width: '10%',
      render: (value: IPermission | undefined) => (
        <div>
          {renderPermissionCheckbox(value)}
        </div>
      )
    },
    {
      title: 'Delete',
      dataIndex: 'delete',
      width: '10%',
      render: (value: IPermission | undefined) => (
        <div>
          {renderPermissionCheckbox(value)}
        </div>
      )
    },
    {
      title: 'Special Actions',
      dataIndex: 'specialActions',
      width: '30%',
      render: (value: IPermission[], record: PermissionRow) => {
        if (value.length === 0) {
          return <span className="text-sm text-gray-400">None</span>;
        }

        const isExpanded = expandedRows.has(record.resource);
        
        return (
          <div>
            <button
              onClick={() => toggleRow(record.resource)}
              className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 flex items-center gap-1"
            >
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              {value.length} actions
            </button>
            {isExpanded && (
              <div className="mt-2 space-y-1">
                {value.map(permission => (
                  <label
                    key={permission.permission_id}
                    className="flex items-center gap-2 text-sm"
                  >
                    {renderPermissionCheckbox(permission)}
                    <span className="capitalize">
                      {permission.action.replace(/_/g, ' ')}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      }
    }
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Manage Permissions</CardTitle>
            <CardDescription>
              Configure access permissions for different roles and resources
            </CardDescription>
          </div>
          {/* View Switcher */}
          <ViewSwitcher
            currentView={viewMode}
            onChange={setViewMode}
            options={viewOptions}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Controls Row */}
        <div className="flex items-center gap-4">
          {/* Role Selector */}
          <div className="w-64">
            <CustomSelect
              value={selectedRole}
              onValueChange={setSelectedRole}
              options={filteredRoles.map(role => ({
                value: role.role_id,
                label: role.role_name
              }))}
              placeholder="Select a role"
              className="w-full"
            />
          </div>

          {/* Resource Filter */}
          <div className="w-64">
            <CustomSelect
              value={selectedResource}
              onValueChange={setSelectedResource}
              options={resourceOptions}
              placeholder="Filter by resource"
              className="w-full"
              customStyles={{
                content: 'max-h-[256px]'
              }}
            />
          </div>
        </div>

        {/* Stats */}
        <div className="text-sm text-gray-600 dark:text-gray-400">
          {permissionRows.length} resources • {stats.assigned}/{stats.total} permissions
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-3 rounded-md text-sm">
            {error}
          </div>
        )}

        {/* Permissions Table */}
        {!selectedRole ? (
          <div className="text-center py-12 text-gray-500">
            Please select a role to manage permissions
          </div>
        ) : (
          <DataTable
            data={permissionRows}
            columns={columns}
            pagination={false}
            pageSize={999}
          />
        )}
      </CardContent>
    </Card>
  );
}