'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardHeader, CardContent, CardTitle, CardDescription } from '@alga-psa/ui/components/Card';
import { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { ChevronDown, ChevronRight } from 'lucide-react';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import ViewSwitcher, { ViewSwitcherOption } from '@alga-psa/ui/components/ViewSwitcher';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { Button } from '@alga-psa/ui/components/Button';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { 
  getPermissions, 
  getRoles, 
  getRolePermissions, 
  assignPermissionToRole, 
  removePermissionFromRole 
} from 'server/src/lib/actions/policyActions';
import { IPermission, IRole } from 'server/src/interfaces/auth.interfaces';
import toast from 'react-hot-toast';

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

interface RolePermissionRow {
  role_id: string;
  role_name: string;
  create?: IPermission;
  read?: IPermission;
  update?: IPermission;
  delete?: IPermission;
  specialActions: IPermission[];
  rolePermissions: string[];
}

export default function PermissionsMatrix() {
  const [permissions, setPermissions] = useState<IPermission[]>([]);
  const [roles, setRoles] = useState<IRole[]>([]);
  const [selectedRole, setSelectedRole] = useState<string>('all');
  const [rolePermissions, setRolePermissions] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('msp');
  const [selectedResource, setSelectedResource] = useState<string>('all');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingChanges, setPendingChanges] = useState<Map<string, Map<string, boolean>>>(new Map());
  const [isSaving, setIsSaving] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [allRolePermissions, setAllRolePermissions] = useState<Map<string, string[]>>(new Map());
  const [originalRolePermissions, setOriginalRolePermissions] = useState<Map<string, string[]>>(new Map());

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
    if (selectedRole && selectedRole !== 'all') {
      fetchRolePermissions(selectedRole);
    }
  }, [selectedRole, fetchRolePermissions]);

  // Filter permissions by view mode
  const filteredPermissions = useMemo(() => {
    return permissions.filter(p => viewMode === 'msp' ? p.msp : p.client);
  }, [permissions, viewMode]);

  // Filter roles by view mode and sort alphabetically
  const filteredRoles = useMemo(() => {
    return roles
      .filter(r => viewMode === 'msp' ? r.msp : r.client)
      .sort((a, b) => a.role_name.localeCompare(b.role_name));
  }, [roles, viewMode]);

  const hasUnsavedChanges = useMemo(() => {
    return pendingChanges.size > 0;
  }, [pendingChanges]);

  const hasAdminRoleChanges = useMemo(() => {
    const adminRoleIds = roles
      .filter(r => r.role_name.toLowerCase() === 'admin')
      .map(r => r.role_id);
    
    return Array.from(pendingChanges.keys()).some(roleId => 
      adminRoleIds.includes(roleId)
    );
  }, [pendingChanges, roles]);

  // Fetch all role permissions
  const fetchAllRolePermissions = useCallback(async () => {
    try {
      const rolePermissionsMap = new Map<string, string[]>();
      
      // For each role, get their permissions
      for (const role of filteredRoles) {
        const rolePerms = await getRolePermissions(role.role_id);
        const permIds = rolePerms.map((p: IPermission) => p.permission_id);
        rolePermissionsMap.set(role.role_id, permIds);
      }
      
      setAllRolePermissions(rolePermissionsMap);
      setOriginalRolePermissions(new Map(rolePermissionsMap));
    } catch (err) {
      console.error('Error fetching all role permissions:', err);
      setError('Failed to fetch role permissions');
    }
  }, [filteredRoles]);

  useEffect(() => {
    if (filteredRoles.length > 0) {
      fetchAllRolePermissions();
    }
  }, [filteredRoles, fetchAllRolePermissions]);

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
  const handlePermissionToggle = (permissionId: string, checked: boolean) => {
    if (!selectedRole || selectedRole === 'all') return;

    // Check if this is an admin role
    const selectedRoleObj = roles.find(r => r.role_id === selectedRole);
    if (selectedRoleObj && selectedRoleObj.role_name.toLowerCase() === 'admin') {
      toast.error("Admin role permissions cannot be modified");
      return; // Don't make any changes for admin roles
    }

    // Store the change locally
    setPendingChanges(prev => {
      const newChanges = new Map(prev);
      const roleChanges = newChanges.get(selectedRole) || new Map();
      
      // Get original state
      const originalPermissions = originalRolePermissions.get(selectedRole) || [];
      const isOriginallyChecked = originalPermissions.includes(permissionId);
      
      // If the new state matches the original, remove the pending change
      if (checked === isOriginallyChecked) {
        roleChanges.delete(permissionId);
      } else {
        roleChanges.set(permissionId, checked);
      }
      
      if (roleChanges.size === 0) {
        newChanges.delete(selectedRole);
      } else {
        newChanges.set(selectedRole, roleChanges);
      }
      
      return newChanges;
    });
    
    // Update the UI immediately
    if (checked) {
      setRolePermissions(prev => [...prev, permissionId]);
    } else {
      setRolePermissions(prev => prev.filter(id => id !== permissionId));
    }
  };

  // Handle permission toggle for a specific role (resource view)
  const handlePermissionToggleForRole = (permissionId: string, roleId: string, checked: boolean) => {
    // Check if this is an admin role
    const roleObj = roles.find(r => r.role_id === roleId);
    if (roleObj && roleObj.role_name.toLowerCase() === 'admin') {
      toast.error("Admin role permissions cannot be modified");
      return; // Don't make any changes for admin roles
    }

    // Store the change locally
    setPendingChanges(prev => {
      const newChanges = new Map(prev);
      const roleChanges = newChanges.get(roleId) || new Map();
      
      // Get original state
      const originalPermissions = originalRolePermissions.get(roleId) || [];
      const isOriginallyChecked = originalPermissions.includes(permissionId);
      
      // If the new state matches the original, remove the pending change
      if (checked === isOriginallyChecked) {
        roleChanges.delete(permissionId);
      } else {
        roleChanges.set(permissionId, checked);
      }
      
      if (roleChanges.size === 0) {
        newChanges.delete(roleId);
      } else {
        newChanges.set(roleId, roleChanges);
      }
      
      return newChanges;
    });
    
    // Update the UI immediately
    setAllRolePermissions(prev => {
      const newMap = new Map(prev);
      const rolePerms = newMap.get(roleId) || [];
      if (checked && !rolePerms.includes(permissionId)) {
        newMap.set(roleId, [...rolePerms, permissionId]);
      } else if (!checked) {
        newMap.set(roleId, rolePerms.filter(id => id !== permissionId));
      }
      return newMap;
    });
    
    // Update current role permissions if it's the selected role
    if (roleId === selectedRole) {
      if (checked) {
        setRolePermissions(prev => [...prev, permissionId]);
      } else {
        setRolePermissions(prev => prev.filter(id => id !== permissionId));
      }
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

  // Handle save changes
  const handleSaveChanges = async () => {
    // Since the button is disabled for admin changes, this will only be called for non-admin changes
    setShowConfirmDialog(true);
  };

  // Perform the actual save
  const performSave = async () => {
    setIsSaving(true);
    setError(null);
    
    try {
      const promises: Promise<void>[] = [];
      
      // Process all pending changes
      pendingChanges.forEach((roleChanges, roleId) => {
        roleChanges.forEach((shouldAdd, permissionId) => {
          if (shouldAdd) {
            promises.push(assignPermissionToRole(roleId, permissionId));
          } else {
            promises.push(removePermissionFromRole(roleId, permissionId));
          }
        });
      });
      
      await Promise.all(promises);
      
      // Clear pending changes
      setPendingChanges(new Map());
      
      // Refresh data
      await fetchAllRolePermissions();
      if (selectedRole && selectedRole !== 'all') {
        await fetchRolePermissions(selectedRole);
      }
      
      toast.success("Permissions updated successfully");
    } catch (err) {
      console.error('Error saving permissions:', err);
      setError('Failed to save permissions');
      toast.error("Failed to save permissions");
    } finally {
      setIsSaving(false);
      setShowConfirmDialog(false);
    }
  };

  // Handle cancel changes
  const handleCancelChanges = async () => {
    setPendingChanges(new Map());
    
    // Refresh data to restore original state
    await fetchAllRolePermissions();
    if (selectedRole && selectedRole !== 'all') {
      await fetchRolePermissions(selectedRole);
    }
  };

  // Calculate statistics
  const stats = useMemo(() => {
    const totalPermissions = filteredPermissions.length;
    const assignedPermissions = filteredPermissions.filter(p => 
      rolePermissions.includes(p.permission_id)
    ).length;
    return { total: totalPermissions, assigned: assignedPermissions };
  }, [filteredPermissions, rolePermissions]);

  // Determine what type of view to show based on selections
  const viewType = useMemo(() => {
    if (selectedRole !== 'all' && selectedResource === 'all') return 'role-all-resources';
    if (selectedRole !== 'all' && selectedResource !== 'all') return 'role-specific-resource';
    if (selectedRole === 'all' && selectedResource !== 'all') return 'all-roles-specific-resource';
    return 'empty';
  }, [selectedRole, selectedResource]);

  // Prepare table data based on view type
  const tableData = useMemo((): PermissionRow[] | RolePermissionRow[] => {
    switch (viewType) {
      case 'role-all-resources':
        // Show all resources for selected role (current behavior)
        return permissionRows;
      
      case 'role-specific-resource':
        // Show specific resource for selected role
        return permissionRows.filter(row => row.resource === selectedResource);
      
      case 'all-roles-specific-resource':
        // Show all roles for specific resource
        const resourcePermissions = filteredPermissions.filter(p => 
          p.resource === selectedResource
        );
        
        // Group permissions by action for easy lookup
        const permissionsByAction = new Map<string, IPermission>();
        const specialActions: IPermission[] = [];
        
        resourcePermissions.forEach(p => {
          if (standardActions.includes(p.action)) {
            permissionsByAction.set(p.action, p);
          } else {
            specialActions.push(p);
          }
        });
        
        // Create a row for each role showing their permissions for this resource
        return filteredRoles.map(role => {
          const rolePerms = allRolePermissions.get(role.role_id) || [];
          
          return {
            role_id: role.role_id,
            role_name: role.role_name,
            create: permissionsByAction.get('create'),
            read: permissionsByAction.get('read'),
            update: permissionsByAction.get('update'),
            delete: permissionsByAction.get('delete'),
            specialActions: specialActions,
            rolePermissions: rolePerms
          };
        });
        
      default:
        return [];
    }
  }, [viewType, permissionRows, selectedResource, filteredPermissions, filteredRoles, allRolePermissions, standardActions]);

  // Helper function to render permission checkbox with optional tooltip
  const renderPermissionCheckbox = (permission: IPermission | undefined) => {
    if (!permission) {
      return <span className="text-gray-400">-</span>;
    }

    // Check if there's a pending change for this permission
    const pendingChange = selectedRole !== 'all' && pendingChanges.get(selectedRole)?.get(permission.permission_id);
    const isChecked = pendingChange !== undefined 
      ? pendingChange 
      : rolePermissions.includes(permission.permission_id);
    
    const checkbox = (
      <Checkbox
        checked={isChecked}
        onChange={(e) => handlePermissionToggle(permission.permission_id, e.target.checked)}
        disabled={!selectedRole || selectedRole === 'all'}
        className={pendingChange !== undefined ? 'ring-2 ring-purple-500' : ''}
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

  // Helper function to render permission checkbox for any role/permission combination
  const renderPermissionCheckboxForRole = (permission: IPermission | undefined, roleId: string, rolePermissions: string[]) => {
    if (!permission) {
      return <span className="text-gray-400">-</span>;
    }

    // Check if there's a pending change for this permission
    const pendingChange = pendingChanges.get(roleId)?.get(permission.permission_id);
    const isChecked = pendingChange !== undefined 
      ? pendingChange 
      : rolePermissions.includes(permission.permission_id);

    const checkbox = (
      <Checkbox
        checked={isChecked}
        onChange={(e) => handlePermissionToggleForRole(permission.permission_id, roleId, e.target.checked)}
        disabled={false}
        className={pendingChange !== undefined ? 'ring-2 ring-purple-500' : ''}
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

  // Define columns for role-based view
  const roleColumns: ColumnDefinition<PermissionRow>[] = [
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

  // Define columns for resource-based view
  const resourceColumns: ColumnDefinition<RolePermissionRow>[] = [
    {
      title: 'Role',
      dataIndex: 'role_name',
      width: '30%',
      render: (value: string) => (
        <span className="font-medium">
          {value}
        </span>
      )
    },
    {
      title: 'Create',
      dataIndex: 'create',
      width: '10%',
      render: (value: IPermission | undefined, record: RolePermissionRow) => (
        <div>
          {renderPermissionCheckboxForRole(value, record.role_id, record.rolePermissions)}
        </div>
      )
    },
    {
      title: 'Read',
      dataIndex: 'read',
      width: '10%',
      render: (value: IPermission | undefined, record: RolePermissionRow) => (
        <div>
          {renderPermissionCheckboxForRole(value, record.role_id, record.rolePermissions)}
        </div>
      )
    },
    {
      title: 'Update',
      dataIndex: 'update',
      width: '10%',
      render: (value: IPermission | undefined, record: RolePermissionRow) => (
        <div>
          {renderPermissionCheckboxForRole(value, record.role_id, record.rolePermissions)}
        </div>
      )
    },
    {
      title: 'Delete',
      dataIndex: 'delete',
      width: '10%',
      render: (value: IPermission | undefined, record: RolePermissionRow) => (
        <div>
          {renderPermissionCheckboxForRole(value, record.role_id, record.rolePermissions)}
        </div>
      )
    },
    {
      title: 'Special Actions',
      dataIndex: 'specialActions',
      width: '30%',
      render: (value: IPermission[], record: RolePermissionRow) => {
        if (value.length === 0) {
          return <span className="text-sm text-gray-400">None</span>;
        }
        
        const isExpanded = expandedRows.has(record.role_id);
        
        return (
          <div>
            <button
              onClick={() => toggleRow(record.role_id)}
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
                    {renderPermissionCheckboxForRole(permission, record.role_id, record.rolePermissions)}
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
          {/* Left: Title and Description */}
          <div>
            <CardTitle>Manage Permissions</CardTitle>
            <CardDescription>
              Configure access permissions for different roles and resources
            </CardDescription>
          </div>
          
          {/* Right: MSP/Client Portal Switcher */}
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
              options={[
                { value: 'all', label: 'All Roles' },
                ...filteredRoles.map(role => ({
                  value: role.role_id,
                  label: role.role_name
                }))
              ]}
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
          {viewType === 'empty' ? 'Select a role or resource to view permissions' :
           viewType === 'all-roles-specific-resource' ? `${tableData.length} roles for ${selectedResource}` :
           `${tableData.length} resources • ${stats.assigned}/${stats.total} permissions`}
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-3 rounded-md text-sm">
            {error}
          </div>
        )}

        {/* Permissions Table */}
        {viewType === 'empty' ? (
          <div className="text-center py-12 text-gray-500">
            Please select a role or resource to manage permissions
          </div>
        ) : viewType === 'all-roles-specific-resource' ? (
          <DataTable
            id="permissions-matrix-table"
            data={tableData as RolePermissionRow[]}
            columns={resourceColumns}
            pagination={false}
            pageSize={999}
          />
        ) : (
          <DataTable
            id="permissions-matrix-table"
            data={tableData as PermissionRow[]}
            columns={roleColumns}
            pagination={false}
            pageSize={999}
          />
        )}

        {/* Save/Cancel Buttons */}
        {hasUnsavedChanges && (
          <div className="flex items-center justify-between mt-6 pt-6 border-t">
            <div className="text-sm text-muted-foreground">
              {hasAdminRoleChanges 
                ? "Admin role permissions cannot be modified" 
                : "You have unsaved changes"}
            </div>
            <div className="flex items-center gap-2">
              <Button
                id="cancel-changes-button"
                variant="ghost"
                onClick={handleCancelChanges}
                disabled={isSaving}
              >
                Cancel
              </Button>
              {hasAdminRoleChanges ? (
                <Tooltip content="Admin role permissions are system-defined and cannot be changed">
                  <span>
                    <Button
                      id="save-changes-button"
                      disabled={true}
                      className="flex items-center gap-2"
                    >
                      Save changes
                    </Button>
                  </span>
                </Tooltip>
              ) : (
                <Button
                  id="save-changes-button"
                  onClick={handleSaveChanges}
                  disabled={isSaving}
                  className="flex items-center gap-2"
                >
                  {isSaving ? (
                    <>
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      Saving...
                    </>
                  ) : (
                    <>
                      Save changes
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
      
      {/* Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={showConfirmDialog}
        onClose={() => setShowConfirmDialog(false)}
        title="Confirm Permission Changes"
        message="Are you sure you want to save these permission changes?"
        onConfirm={performSave}
        confirmLabel="Save Changes"
        cancelLabel="Cancel"
        isConfirming={isSaving}
      />
    </Card>
  );
}