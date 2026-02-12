'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { DeleteEntityDialog } from '@alga-psa/ui';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { 
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem
} from '@alga-psa/ui/components/DropdownMenu';
import { Search, MoreVertical, Pencil, Trash2, Eye, EyeOff } from 'lucide-react';
import ClientUserDetails from './ClientUserDetails';
import { 
  getCurrentUser, 
  getUserRolesWithPermissions, 
  getUserClientId, 
  deleteUser,
  updateUser,
  getClientUsersForClient
} from '@alga-psa/users/actions';
import { createOrFindContactByEmail } from '@alga-psa/clients/actions';
import { createClientUser, getClientPortalRoles, getClientUserRoles } from '@alga-psa/client-portal/actions';
import type { DeletionValidationResult, IUser, IPermission } from '@alga-psa/types';
import type { IRole as SharedIRole } from '@shared/interfaces/user.interfaces';
import { useDrawer } from "@alga-psa/ui";
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { ColumnDefinition } from '@alga-psa/types';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { preCheckDeletion } from '@alga-psa/auth/lib/preCheckDeletion';

export function UserManagementSettings() {
  const { t: tProfile } = useTranslation('client-portal/profile');
  const { t: tCore } = useTranslation('client-portal/core');
  const { t: tAuth } = useTranslation('client-portal/auth');
  const router = useRouter();
  const [users, setUsers] = useState<IUser[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNewUserForm, setShowNewUserForm] = useState(false);
  const [newUser, setNewUser] = useState({ firstName: '', lastName: '', email: '', password: '', roleId: '' });
  const [clientId, setClientId] = useState<string | null>(null);
  const [userToDelete, setUserToDelete] = useState<IUser | null>(null);
  const [deleteValidation, setDeleteValidation] = useState<DeletionValidationResult | null>(null);
  const [isDeleteValidating, setIsDeleteValidating] = useState(false);
  const [isDeleteProcessing, setIsDeleteProcessing] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [availableRoles, setAvailableRoles] = useState<SharedIRole[]>([]);
  const [userRoles, setUserRoles] = useState<{ [key: string]: SharedIRole[] }>({});
  const { openDrawer } = useDrawer();

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Handle page size change - reset to page 1
  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
  };

  useEffect(() => {
    loadData();
  }, [router]);

  async function loadData() {
    try {
      // Get current user and their roles with permissions
      const user = await getCurrentUser();
      if (!user) {
        router.push('/auth/signin');
        return;
      }

      const rolesWithPermissions = await getUserRolesWithPermissions(user.user_id);
      
      // Check if user has required permissions
      const hasRequiredPermissions = rolesWithPermissions.some(role => 
        role.permissions.some((permission: IPermission) => 
          `${permission.resource}.${permission.action}` === 'user.read' ||
          `${permission.resource}.${permission.action}` === 'user.update' ||
          `${permission.resource}.${permission.action}` === 'user.delete'
        )
      );

      if (!hasRequiredPermissions) {
        setError(tProfile('clientSettings.users.permissionError', 'You do not have permission to manage users'));
        return;
      }

      // Get client ID
      const userClientId = await getUserClientId(user.user_id);
      if (!userClientId) {
        setError(tProfile('clientSettings.users.clientNotFound', 'Client not found'));
        return;
      }

      setClientId(userClientId);

      // Get all users for this client - use a server action instead
      const clientUsers = await getClientUsersForClient(userClientId);
      setUsers(clientUsers);
      
      // Fetch available roles for client portal
      const roles = await getClientPortalRoles();
      setAvailableRoles(roles);
      
      // Fetch roles for each user
      const rolesMap: { [key: string]: SharedIRole[] } = {};
      for (const user of clientUsers) {
        const userRolesList = await getClientUserRoles(user.user_id);
        rolesMap[user.user_id] = userRolesList;
      }
      setUserRoles(rolesMap);
      
      setLoading(false);
    } catch (error) {
      console.error('Error loading users:', error);
      setError(tProfile('clientSettings.users.loadError', 'Failed to load users'));
      setLoading(false);
    }
  }

  const handleCreateUser = async () => {
    if (!clientId) return;

    try {
      // 1. Create or find contact using the improved function
      const { contact, isNew } = await createOrFindContactByEmail({
        email: newUser.email,
        name: `${newUser.firstName} ${newUser.lastName}`,
        clientId,
        phone: '', // Add phone if available in newUser
        title: '' // Add title/role if available in newUser
      });

      // 2. Create user account
      const result = await createClientUser({
        email: newUser.email,
        password: newUser.password,
        contactId: contact.contact_name_id,
        clientId,
        firstName: newUser.firstName,
        lastName: newUser.lastName,
        roleId: newUser.roleId || undefined
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to create user');
      }

      // Refresh the user list
      const updatedUsers = await getClientUsersForClient(clientId);
      setUsers(updatedUsers);
      
      // Refresh user roles
      const rolesMap: { [key: string]: SharedIRole[] } = {};
      for (const user of updatedUsers) {
        const userRolesList = await getClientUserRoles(user.user_id);
        rolesMap[user.user_id] = userRolesList;
      }
      setUserRoles(rolesMap);
      
      setShowNewUserForm(false);
      setNewUser({ firstName: '', lastName: '', email: '', password: '', roleId: '' });
    } catch (error) {
      console.error('Error creating user:', error);
      if (error instanceof Error && error.message.includes('EMAIL_EXISTS')) {
        setError(tProfile('clientSettings.users.emailExists', 'A contact with this email address already exists'));
      } else {
        setError(tProfile('clientSettings.users.createError', 'Failed to create user'));
      }
    }
  };

  const handleEditClick = (userId: string) => {
    openDrawer(
      <ClientUserDetails 
        userId={userId} 
        onUpdate={loadData} 
      />
    );
  };

  const resetDeleteState = () => {
    setUserToDelete(null);
    setDeleteValidation(null);
  };

  const runDeleteValidation = useCallback(async (userId: string) => {
    setIsDeleteValidating(true);
    try {
      const result = await preCheckDeletion('user', userId);
      setDeleteValidation(result);
    } catch (error) {
      console.error('Error validating user deletion:', error);
      setDeleteValidation({
        canDelete: false,
        code: 'VALIDATION_FAILED',
        message: tProfile('clientSettings.users.deleteError', 'Failed to validate user deletion'),
        dependencies: [],
        alternatives: []
      });
    } finally {
      setIsDeleteValidating(false);
    }
  }, [tProfile]);

  const handleDeleteClick = (user: IUser) => {
    setUserToDelete(user);
    void runDeleteValidation(user.user_id);
  };

  const confirmDelete = async () => {
    if (!userToDelete) return;

    setIsDeleteProcessing(true);
    try {
      const result = await deleteUser(userToDelete.user_id);
      if (!result.success) {
        setDeleteValidation(result);
        return;
      }
      setUsers(users.filter(user => user.user_id !== userToDelete.user_id));
      resetDeleteState();
    } catch (error) {
      console.error('Error deleting user:', error);
      setError(tProfile('clientSettings.users.deleteError', 'Failed to delete user'));
    } finally {
      setIsDeleteProcessing(false);
    }
  };

  const handleDeleteAlternativeAction = async (action: string) => {
    if (action !== 'deactivate' || !userToDelete) {
      return;
    }

    setIsDeleteProcessing(true);
    try {
      const updatedUser = await updateUser(userToDelete.user_id, { is_inactive: true });
      if (updatedUser) {
        setUsers(prev => prev.map(user => user.user_id === updatedUser.user_id ? updatedUser : user));
      }
      resetDeleteState();
    } catch (error) {
      console.error('Error deactivating user:', error);
      setError(tProfile('clientSettings.users.deleteError', 'Failed to deactivate user'));
    } finally {
      setIsDeleteProcessing(false);
    }
  };

  const filteredUsers = users.filter(user => {
    const fullName = `${user.first_name || ''} ${user.last_name || ''}`.toLowerCase();
    return fullName.includes(searchTerm.toLowerCase()) ||
      user.email.toLowerCase().includes(searchTerm.toLowerCase());
  });

  // Define columns for DataTable
  const columns: ColumnDefinition<IUser>[] = [
    {
      title: tProfile('clientSettings.users.firstName'),
      dataIndex: 'first_name',
      width: '15%',
    },
    {
      title: tProfile('clientSettings.users.lastName'),
      dataIndex: 'last_name',
      width: '15%',
    },
    {
      title: tProfile('clientSettings.users.email'),
      dataIndex: 'email',
      width: '20%',
    },
    {
      title: tProfile('clientSettings.users.phone'),
      dataIndex: 'phone',
      width: '12%',
      render: (value, record) => (
        <span>{record.phone || 'N/A'}</span>
      ),
    },
    {
      title: tProfile('clientSettings.users.roles'),
      dataIndex: 'user_id',
      width: '13%',
      render: (userId) => {
        const roles = userRoles[userId] || [];
        return (
          <span className="text-sm">
            {roles.length > 0
              ? roles.map(role => role.role_name).join(', ')
              : 'No roles assigned'}
          </span>
        );
      },
    },
    {
      title: tProfile('clientSettings.users.lastLogin', 'Last Login'),
      dataIndex: 'last_login_at',
      width: '15%',
      render: (lastLoginAt: string | null, record: IUser) => {
        if (!lastLoginAt) {
          return <span className="text-gray-400 text-sm">{tProfile('clientSettings.users.never', 'Never')}</span>;
        }
        const date = new Date(lastLoginAt);
        const formattedDate = date.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        });
        return (
          <div className="flex flex-col">
            <span className="text-sm">{formattedDate}</span>
            {record.last_login_method && (
              <span className="text-xs text-gray-500">{tProfile('clientSettings.users.via', 'via')} {record.last_login_method}</span>
            )}
          </div>
        );
      },
    },
    {
      title: tProfile('clientSettings.users.status'),
      dataIndex: 'is_inactive',
      width: '10%',
      render: (value, record) => (
        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${record.is_inactive ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
          {record.is_inactive ? tProfile('clientSettings.users.inactive') : tProfile('clientSettings.users.active')}
        </span>
      ),
    },
    {
      title: tProfile('clientSettings.users.actions'),
      dataIndex: 'user_id',
      width: '5%',
      render: (_, record) => (
        <div className="flex justify-center">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                id={`user-actions-menu-${record.user_id}`}
                variant="ghost"
                className="h-8 w-8 p-0"
              >
                <span className="sr-only">Open menu</span>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                id={`edit-user-menu-item-${record.user_id}`}
                onClick={() => handleEditClick(record.user_id)}
                className="flex items-center gap-2"
              >
                <Pencil className="h-4 w-4" />
                {tCore('common.edit')}
              </DropdownMenuItem>
              <DropdownMenuItem
                id={`delete-user-menu-item-${record.user_id}`}
                onClick={() => handleDeleteClick(record)}
                className="flex items-center gap-2 text-red-600"
              >
                <Trash2 className="h-4 w-4" />
                {tCore('common.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-md p-4">
        <p className="text-red-800">{error}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="h-8 bg-gray-200 rounded w-1/4 mb-4"></div>
        <div className="h-32 bg-gray-200 rounded"></div>
      </div>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex justify-between mb-4">
          <div className="relative">
            <Input
              type="text"
              placeholder={tProfile('clientSettings.users.searchUsers')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="border-2 border-gray-200 focus:border-purple-500 rounded-md pl-10 pr-4 py-2 w-64 outline-none bg-white"
            />
            <Search size={20} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
          </div>
          <Button id="create-new-user-btn" onClick={() => setShowNewUserForm(true)}>{tProfile('clientSettings.users.addNewUser')}</Button>
        </div>

        {showNewUserForm && (
          <div className="mb-4 p-4 border rounded-md">
            <h3 className="text-lg font-semibold mb-2">{tProfile('clientSettings.users.addNewUser')}</h3>
            <div className="space-y-2">
              <div>
                <Label htmlFor="firstName">{tProfile('clientSettings.users.firstName')}</Label>
                <Input
                  id="firstName"
                  value={newUser.firstName}
                  onChange={(e) => setNewUser({ ...newUser, firstName: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="lastName">{tProfile('clientSettings.users.lastName')}</Label>
                <Input
                  id="lastName"
                  value={newUser.lastName}
                  onChange={(e) => setNewUser({ ...newUser, lastName: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="email">{tProfile('clientSettings.users.email')}</Label>
                <Input
                  id="email"
                  type="email"
                  value={newUser.email}
                  onChange={(e) => {
                    setNewUser({ ...newUser, email: e.target.value });
                    // Clear error when user starts typing
                    if (error) {
                      setError(null);
                    }
                  }}
                />
              </div>
              <div>
                <Label htmlFor="password">{tAuth('auth.password')}</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={newUser.password}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center"
                  >
                    {showPassword ? (
                      <Eye className="h-5 w-5 text-gray-400" />
                    ) : (
                      <EyeOff className="h-5 w-5 text-gray-400" />
                    )}
                  </button>
                </div>
              </div>
              <div>
                <Label htmlFor="role">{tProfile('clientSettings.users.roles')}</Label>
                <CustomSelect
                  value={newUser.roleId}
                  onValueChange={(value) => setNewUser({ ...newUser, roleId: value })}
                  options={availableRoles.map((role): SelectOption => ({
                    value: role.role_id,
                    label: role.role_name
                  }))}
                  placeholder={tProfile('clientSettings.users.selectRole', 'Select a role (optional)')}
                />
              </div>
              <Button id="submit-new-user-btn" onClick={handleCreateUser}>{tProfile('clientSettings.users.createUser', 'Create User')}</Button>
            </div>
          </div>
        )}

        <div className="mt-4">
          <DataTable
            id="client-portal-user-management-table"
            data={filteredUsers}
            columns={columns}
            pagination={true}
            currentPage={currentPage}
            onPageChange={setCurrentPage}
            pageSize={pageSize}
            onItemsPerPageChange={handlePageSizeChange}
          />
        </div>
      </CardContent>

      {/* Delete Confirmation Modal */}
      <DeleteEntityDialog
        id="client-portal-delete-user"
        isOpen={Boolean(userToDelete)}
        onClose={resetDeleteState}
        onConfirmDelete={confirmDelete}
        onAlternativeAction={handleDeleteAlternativeAction}
        entityName={userToDelete ? `${userToDelete.first_name ?? ''} ${userToDelete.last_name ?? ''}`.trim() || 'this user' : 'this user'}
        validationResult={deleteValidation}
        isValidating={isDeleteValidating}
        isDeleting={isDeleteProcessing}
      />
    </Card>
  );
}
