'use client';

/* eslint-disable custom-rules/no-feature-to-feature-imports -- Client portal user management intentionally composes user and client feature actions for tenant contact administration. */

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge } from '@alga-psa/ui/components/Badge';
import { DeleteEntityDialog } from '@alga-psa/ui';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
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
  getClientUsersForClient
} from '@alga-psa/user-composition/actions/userQueryActions';
import {
  deactivateUserWithDisposition,
  deleteUser,
  getActiveInternalUsersForDeactivation,
  getOpenWorkCountsForUserDeactivation,
  updateUser,
  type OpenWorkDisposition,
  type UserOpenWorkCounts,
} from "@alga-psa/users/actions/user-actions/userActions";
import { createOrFindContactByEmail } from '@alga-psa/clients/actions/queryActions';
import { createClientUser, getClientPortalRoles, getClientUserRoles } from '../../actions/client-portal-actions/clientUserActions';
import type { DeletionValidationResult, IUser, IPermission } from '@alga-psa/types';
import type { IRole as SharedIRole } from '@shared/interfaces/user.interfaces';
import { useDrawer } from "@alga-psa/ui";
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { ColumnDefinition } from '@alga-psa/types';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { preCheckDeletion } from '@alga-psa/auth/lib/preCheckDeletion';

export function UserManagementSettings() {
  const { t: tProfile } = useTranslation('client-portal');
  const { t: tCommon } = useTranslation('common');
  const router = useRouter();
  const [users, setUsers] = useState<IUser[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNewUserForm, setShowNewUserForm] = useState(false);
  const [newUser, setNewUser] = useState({ firstName: '', lastName: '', email: '', password: '', roleId: '' });
  const [clientId, setClientId] = useState<string | null>(null);
  const [userToDelete, setUserToDelete] = useState<IUser | null>(null);
  const [userToDeactivate, setUserToDeactivate] = useState<IUser | null>(null);
  const [deleteValidation, setDeleteValidation] =
    useState<DeletionValidationResult | null>(null);
  const [isDeleteValidating, setIsDeleteValidating] = useState(false);
  const [isDeleteProcessing, setIsDeleteProcessing] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [availableRoles, setAvailableRoles] = useState<SharedIRole[]>([]);
  const [userRoles, setUserRoles] = useState<{ [key: string]: SharedIRole[] }>(
    {},
  );
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [openWorkCounts, setOpenWorkCounts] =
    useState<UserOpenWorkCounts | null>(null);
  const [activeAssignees, setActiveAssignees] = useState<
    Array<Pick<IUser, "user_id" | "first_name" | "last_name" | "email">>
  >([]);
  const [ticketDisposition, setTicketDisposition] =
    useState<OpenWorkDisposition>({ action: "reassign", assigneeId: "" });
  const [taskDisposition, setTaskDisposition] = useState<OpenWorkDisposition>({
    action: "reassign",
    assigneeId: "",
  });
  const [dispositionConfirmed, setDispositionConfirmed] = useState(false);
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
      setCurrentUserId(user.user_id);

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

  const resetDispositionState = () => {
    setUserToDeactivate(null);
    setOpenWorkCounts(null);
    setActiveAssignees([]);
    setTicketDisposition({ action: "reassign", assigneeId: "" });
    setTaskDisposition({ action: "reassign", assigneeId: "" });
    setDispositionConfirmed(false);
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
    if (action !== "deactivate" || !userToDelete) {
      return;
    }

    try {
      setIsDeleteProcessing(true);
      const counts = await getOpenWorkCountsForUserDeactivation(
        userToDelete.user_id,
      );
      if (counts.openTickets === 0 && counts.openProjectTasks === 0) {
        const result = await updateUser(userToDelete.user_id, {
          is_inactive: true,
        });
        if (!result.success) {
          setError(
            tProfile("clientSettings.users.updateFailed", {
              defaultValue: result.error,
            }),
          );
          return;
        }
        if (result.user) {
          setUsers((prev) =>
            prev.map((user) =>
              user.user_id === result.user!.user_id ? result.user! : user,
            ),
          );
        }
        resetDeleteState();
        return;
      }

      const assignees = await getActiveInternalUsersForDeactivation(
        userToDelete.user_id,
      );
      const defaultAssignee =
        assignees.find((user) => user.user_id === currentUserId) ??
        assignees[0];
      const defaultDisposition: OpenWorkDisposition = defaultAssignee
        ? { action: "reassign", assigneeId: defaultAssignee.user_id }
        : { action: "unassign" };
      setOpenWorkCounts(counts);
      setActiveAssignees(assignees);
      setTicketDisposition(defaultDisposition);
      setTaskDisposition(defaultDisposition);
      setDispositionConfirmed(false);
      setUserToDeactivate(userToDelete);
      resetDeleteState();
    } catch (error) {
      console.error("Error preparing user deactivation:", error);
      setError(
        tProfile(
          "clientSettings.users.deleteError",
          "Failed to prepare user deactivation",
        ),
      );
    } finally {
      setIsDeleteProcessing(false);
    }
  };

  const changeDisposition = (
    bucket: "tickets" | "tasks",
    action: OpenWorkDisposition["action"],
  ) => {
    const next =
      action === "reassign"
        ? ({
            action,
            assigneeId: activeAssignees[0]?.user_id ?? "",
          } as OpenWorkDisposition)
        : ({ action } as OpenWorkDisposition);
    if (bucket === "tickets") {
      setTicketDisposition(next);
    } else {
      setTaskDisposition(next);
    }
    setDispositionConfirmed(false);
  };

  const handleDispositionAssigneeChange = (assigneeId: string) => {
    if (ticketDisposition.action === "reassign") {
      setTicketDisposition({ action: "reassign", assigneeId });
    }
    if (taskDisposition.action === "reassign") {
      setTaskDisposition({ action: "reassign", assigneeId });
    }
    setDispositionConfirmed(false);
  };

  const handleConfirmDeactivationDisposition = async () => {
    if (!userToDeactivate || !openWorkCounts) return;
    setIsDeleteProcessing(true);
    try {
      const result = await deactivateUserWithDisposition(
        userToDeactivate.user_id,
        {
          tickets: ticketDisposition,
          projectTasks: taskDisposition,
        },
      );
      if (!result.success) {
        setError(result.error);
        return;
      }
      if (result.user) {
        setUsers((prev) =>
          prev.map((user) =>
            user.user_id === result.user!.user_id ? result.user! : user,
          ),
        );
      }
      resetDispositionState();
    } catch (error) {
      console.error("Error applying user deactivation disposition:", error);
      setError(
        tProfile(
          "clientSettings.users.deleteError",
          "Failed to deactivate user",
        ),
      );
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
        <Badge variant={record.is_inactive ? 'error' : 'success'}>
          {record.is_inactive ? tProfile('clientSettings.users.inactive') : tProfile('clientSettings.users.active')}
        </Badge>
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
                {tCommon('common.edit')}
              </DropdownMenuItem>
              <DropdownMenuItem
                id={`delete-user-menu-item-${record.user_id}`}
                onClick={() => handleDeleteClick(record)}
                className="flex items-center gap-2 text-red-600"
              >
                <Trash2 className="h-4 w-4" />
                {tCommon('common.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];

  if (error) {
    return (
      <div className="bg-destructive/10 border border-destructive/30 rounded-md p-4">
        <p className="text-destructive">{error}</p>
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
              className="border-2 border-gray-200 focus:border-[rgb(var(--color-primary-500))] rounded-md pl-10 pr-4 py-2 w-64 outline-none bg-white"
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
                <Label htmlFor="password">{tProfile('auth.password')}</Label>
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
      <Dialog
        id="client-portal-deactivate-user-disposition"
        isOpen={Boolean(userToDeactivate && openWorkCounts)}
        onClose={resetDispositionState}
        title="Deactivate user and dispose of open work"
        className="max-w-lg"
        allowOverflow
        footer={
          <div className="flex justify-end gap-2">
            <Button
              id="cancel-user-deactivation-disposition"
              variant="ghost"
              onClick={resetDispositionState}
              disabled={isDeleteProcessing}
            >
              {tCommon("common.cancel", "Cancel")}
            </Button>
            <Button
              id="confirm-user-deactivation-disposition"
              onClick={handleConfirmDeactivationDisposition}
              disabled={
                !dispositionConfirmed ||
                isDeleteProcessing ||
                (ticketDisposition.action === "reassign" &&
                  !ticketDisposition.assigneeId) ||
                (taskDisposition.action === "reassign" &&
                  !taskDisposition.assigneeId)
              }
            >
              {isDeleteProcessing ? "Deactivating…" : "Deactivate user"}
            </Button>
          </div>
        }
      >
        <DialogContent>
          <p className="text-sm text-[rgb(var(--color-text-700))]">
            {userToDeactivate
              ? `${userToDeactivate.first_name ?? ""} ${userToDeactivate.last_name ?? ""}`.trim() ||
                "This user"
              : "This user"}{" "}
            has open work. Choose what should happen before they are
            deactivated.
          </p>

          <div className="mt-4 space-y-4">
            {openWorkCounts && openWorkCounts.openTickets > 0 && (
              <DispositionBucket
                bucket="tickets"
                count={openWorkCounts.openTickets}
                disposition={ticketDisposition}
                onChange={changeDisposition}
                disableReassign={activeAssignees.length === 0}
              />
            )}
            {openWorkCounts && openWorkCounts.openProjectTasks > 0 && (
              <DispositionBucket
                bucket="tasks"
                count={openWorkCounts.openProjectTasks}
                disposition={taskDisposition}
                onChange={changeDisposition}
                disableReassign={activeAssignees.length === 0}
              />
            )}

            {(ticketDisposition.action === "reassign" ||
              taskDisposition.action === "reassign") && (
              <div>
                <Label htmlFor="deactivation-reassignment-user">
                  Reassign open work to
                </Label>
                <CustomSelect
                  id="deactivation-reassignment-user"
                  value={
                    ticketDisposition.action === "reassign"
                      ? ticketDisposition.assigneeId
                      : taskDisposition.action === "reassign"
                        ? taskDisposition.assigneeId
                        : null
                  }
                  onValueChange={handleDispositionAssigneeChange}
                  options={activeAssignees.map((user) => ({
                    value: user.user_id,
                    label:
                      `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() ||
                      user.email,
                  }))}
                  placeholder="Select an active internal user"
                  disabled={activeAssignees.length === 0}
                  className="mt-1"
                />
                {activeAssignees.length === 0 && (
                  <p className="mt-1 text-sm text-destructive">
                    No active internal user is available for reassignment.
                  </p>
                )}
              </div>
            )}

            <label
              className="flex items-start gap-2 text-sm text-[rgb(var(--color-text-700))]"
              htmlFor="confirm-user-deactivation-disposition-checkbox"
            >
              <input
                id="confirm-user-deactivation-disposition-checkbox"
                type="checkbox"
                checked={dispositionConfirmed}
                onChange={(event) =>
                  setDispositionConfirmed(event.target.checked)
                }
                className="mt-0.5"
              />
              <span>
                {buildDispositionSummary(
                  openWorkCounts ?? { openTickets: 0, openProjectTasks: 0 },
                  ticketDisposition,
                  taskDisposition,
                  activeAssignees,
                )}
              </span>
            </label>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function DispositionBucket({
  bucket,
  count,
  disposition,
  onChange,
  disableReassign,
}: {
  bucket: "tickets" | "tasks";
  count: number;
  disposition: OpenWorkDisposition;
  onChange: (
    bucket: "tickets" | "tasks",
    action: OpenWorkDisposition["action"],
  ) => void;
  disableReassign: boolean;
}) {
  const label = bucket === "tickets" ? "Tickets" : "Project tasks";
  return (
    <fieldset className="rounded-md border border-[rgb(var(--color-border-200))] p-3">
      <legend className="px-1 text-sm font-medium text-[rgb(var(--color-text-900))]">
        {count} open {label.toLowerCase()}
      </legend>
      <div className="mt-2 flex flex-wrap gap-4">
        {(["reassign", "unassign", "archive"] as const).map((action) => (
          <label
            key={action}
            className="flex items-center gap-1.5 text-sm text-[rgb(var(--color-text-700))]"
            htmlFor={`deactivation-${bucket}-${action}`}
          >
            <input
              id={`deactivation-${bucket}-${action}`}
              type="radio"
              name={`deactivation-${bucket}`}
              value={action}
              checked={disposition.action === action}
              disabled={action === "reassign" && disableReassign}
              onChange={() => onChange(bucket, action)}
            />
            {action === "reassign"
              ? "Reassign"
              : action === "unassign"
                ? "Unassign"
                : "Archive"}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function buildDispositionSummary(
  counts: UserOpenWorkCounts,
  tickets: OpenWorkDisposition,
  tasks: OpenWorkDisposition,
  assignees: Array<
    Pick<IUser, "user_id" | "first_name" | "last_name" | "email">
  >,
): string {
  const describe = (
    count: number,
    label: string,
    disposition: OpenWorkDisposition,
  ) => {
    if (count === 0) return null;
    if (disposition.action === "archive")
      return `${count} ${label} will be archived`;
    if (disposition.action === "unassign")
      return `${count} ${label} will be unassigned`;
    const assignee = assignees.find(
      (user) => user.user_id === disposition.assigneeId,
    );
    const name = assignee
      ? `${assignee.first_name ?? ""} ${assignee.last_name ?? ""}`.trim() ||
        assignee.email
      : "the selected user";
    return `${count} ${label} will be reassigned to ${name}`;
  };
  return (
    [
      describe(
        counts.openTickets,
        counts.openTickets === 1 ? "ticket" : "tickets",
        tickets,
      ),
      describe(
        counts.openProjectTasks,
        counts.openProjectTasks === 1 ? "project task" : "project tasks",
        tasks,
      ),
    ]
      .filter(Boolean)
      .join("; ") + "."
  );
}
