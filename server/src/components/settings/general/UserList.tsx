'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { IUser, DeletionValidationResult } from '@alga-psa/types';
import UserDetails from './UserDetails';
import { useDrawer, DeleteEntityDialog } from "@alga-psa/ui";
import { DataTable } from '@alga-psa/ui/components/DataTable';
import UserAvatar from '@alga-psa/ui/components/UserAvatar';
import { getUserAvatarUrlAction, deleteUser } from '@alga-psa/users/actions';
import { MoreVertical, Pen, Trash2 } from 'lucide-react';

import ClientDetails from '@alga-psa/clients/components/clients/ClientDetails';

import { getUsersClientInfo } from '@alga-psa/users/actions';
import { preCheckDeletion } from '@alga-psa/core';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@alga-psa/ui/components/DropdownMenu';
import { Button } from '@alga-psa/ui/components/Button';

interface UserListProps {
  users: IUser[];
  onDeleteSuccess: () => void;
  onUpdate: () => void;
  selectedClientId?: string | null;
}

const UserList: React.FC<UserListProps> = ({ users, onDeleteSuccess, onUpdate, selectedClientId = null }) => {
  const [userToDelete, setUserToDelete] = useState<IUser | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteValidation, setDeleteValidation] = useState<DeletionValidationResult | null>(null);
  const [isDeleteValidating, setIsDeleteValidating] = useState(false);
  const [isDeleteProcessing, setIsDeleteProcessing] = useState(false);
  const [userAvatars, setUserAvatars] = useState<Record<string, string | null>>({});
  const [userClients, setUserClients] = useState<Record<string, { client_id: string; client_name: string } | null>>({});
  const { openDrawer } = useDrawer();

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Handle page size change - reset to page 1
  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
  };

  const resetDeleteState = useCallback(() => {
    setIsDeleteDialogOpen(false);
    setUserToDelete(null);
    setDeleteValidation(null);
    setIsDeleteValidating(false);
    setIsDeleteProcessing(false);
  }, []);

  useEffect(() => {
    // Fetch avatar URLs for all users
    const fetchAvatarUrls = async () => {
      // Only fetch avatars for users we don't already have
      const usersToFetch = users.filter(
        user => userAvatars[user.user_id] === undefined
      );
      
      if (usersToFetch.length === 0) {
        return;
      }
      
      const avatarPromises = usersToFetch.map(async (user) => {
        try {
          const avatarUrl = await getUserAvatarUrlAction(user.user_id, user.tenant);
          return { userId: user.user_id, avatarUrl };
        } catch (error) {
          console.error(`Error fetching avatar for user ${user.user_id}:`, error);
          return { userId: user.user_id, avatarUrl: null };
        }
      });

      const avatarResults = await Promise.all(avatarPromises);
      const newAvatars = avatarResults.reduce((acc, { userId, avatarUrl }) => {
        acc[userId] = avatarUrl;
        return acc;
      }, {} as Record<string, string | null>);

      // Update state with new avatars only
      setUserAvatars(prev => ({...prev, ...newAvatars}));
    };

    if (users.length > 0) {
      fetchAvatarUrls();
    }
  }, [users.length]); // Only re-run when the number of users changes

  useEffect(() => {
    // Fetch associated client for client users in bulk
    const fetchClientsForUsers = async () => {
      const usersToFetch = users
        .filter((u) => u.user_type === 'client' && userClients[u.user_id] === undefined)
        .map((u) => u.user_id);

      if (usersToFetch.length === 0) return;

      try {
        const result = await getUsersClientInfo(usersToFetch);
        const map: Record<string, { client_id: string; client_name: string } | null> = {};
        result.forEach((row) => {
          map[row.user_id] = row.client_id
            ? { client_id: row.client_id, client_name: row.client_name || 'Unnamed Client' }
            : null;
        });
        setUserClients((prev) => ({ ...prev, ...map }));
      } catch (e) {
        console.error('Error fetching clients for users', e);
      }
    };

    if (users.length > 0) {
      fetchClientsForUsers();
    }
  }, [users, userClients]);

  // Filter by selected client if provided (client users only)
  const visibleUsers = React.useMemo(() => {
    if (!selectedClientId) return users;
    const clientUsers = users.filter((u) => u.user_type === 'client');
    const allResolved = clientUsers.every((u) => userClients[u.user_id] !== undefined);
    if (!allResolved) return users; // avoid flicker while resolving
    return users.filter((u) => userClients[u.user_id]?.client_id === selectedClientId);
  }, [users, userClients, selectedClientId]);

  const runDeleteValidation = useCallback(async (userId: string) => {
    setIsDeleteValidating(true);
    try {
      const result = await preCheckDeletion('user', userId);
      setDeleteValidation(result);
    } catch (error) {
      console.error('Failed to validate user deletion:', error);
      setDeleteValidation({
        canDelete: false,
        code: 'VALIDATION_FAILED',
        message: error instanceof Error ? error.message : 'Failed to validate deletion',
        dependencies: [],
        alternatives: []
      });
    } finally {
      setIsDeleteValidating(false);
    }
  }, []);

  const handleDeleteClick = (user: IUser) => {
    setUserToDelete(user);
    setDeleteValidation(null);
    setIsDeleteDialogOpen(true);
    void runDeleteValidation(user.user_id);
  };

  const handleConfirmDelete = async () => {
    if (!userToDelete) return;
    setIsDeleteProcessing(true);
    try {
      const result = await deleteUser(userToDelete.user_id);
      if (result.success) {
        onDeleteSuccess();
        resetDeleteState();
        return;
      }
      setDeleteValidation(result);
    } catch (error) {
      console.error('Error deleting user:', error);
      setDeleteValidation({
        canDelete: false,
        code: 'VALIDATION_FAILED',
        message: error instanceof Error ? error.message : 'Failed to delete user',
        dependencies: [],
        alternatives: []
      });
    } finally {
      setIsDeleteProcessing(false);
    }
  };



  const handleEditClick = (userId: string) => {
    openDrawer(<UserDetails userId={userId} onUpdate={onUpdate} />);
  };

  const handleClientClick = async (clientId: string) => {
    if (clientId) {
      // Fetch the client data first
      const { getClientById } = await import('@alga-psa/clients/actions');
      const client = await getClientById(clientId);
      if (client) {
        openDrawer(
          <ClientDetails
            client={client}
            isInDrawer={true}
            quickView={true}
          />
        );
      }
    }
  };

  // Check if we should show the Client column (when we have client portal users)
  const hasClientUsers = users.some(u => u.user_type === 'client');

  const columns = [
    {
      title: 'First Name',
      dataIndex: 'first_name',
      width: '15%',
      render: (firstName: string, record: IUser) => (
        <div className="flex items-center space-x-3">
          <UserAvatar
            userId={record.user_id}
            userName={`${record.first_name || ''} ${record.last_name || ''}`}
            avatarUrl={userAvatars[record.user_id] || null}
            size="sm"
          />
          <span>{firstName}</span>
        </div>
      ),
    },
    {
      title: 'Last Name',
      dataIndex: 'last_name',
      width: '15%'
    },
    {
      title: 'Email',
      dataIndex: 'email',
      width: '18%'
    },
    ...(hasClientUsers
      ? [{
          title: 'Client',
          dataIndex: 'client',
          width: '15%',
          render: (_: any, record: IUser) => {
            const client = userClients[record.user_id];
            if (client === undefined) {
              return <span className="text-gray-400">Loading...</span>;
            }
            if (!client) {
              return <span className="text-gray-400">No Client</span>;
            }
            return (
              <button
                id={`open-client-details-${record.user_id}`}
                onClick={(e) => {
                  e.preventDefault();
                  handleClientClick(client.client_id);
                }}
                className="text-blue-500 hover:underline text-left whitespace-normal break-words"
              >
                {client.client_name}
              </button>
            );
          },
        }]
      : []),
    {
      title: 'Role',
      dataIndex: 'roles',
      width: '12%',
      render: (roles: any[], record: IUser) => {
        if (!roles || roles.length === 0) {
          return <span>No Role</span>;
        }

        if (roles.length === 1) {
          return <span>{roles[0].role_name}</span>;
        }

        const roleNames = roles.map(role => role.role_name).join(', ');
        return <span>{roleNames}</span>;
      },
    },
    {
      title: 'Last Login',
      dataIndex: 'last_login_at',
      width: '17%',
      render: (lastLoginAt: string | null, record: IUser) => {
        if (!lastLoginAt) {
          return <span className="text-gray-400 text-sm">Never</span>;
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
              <span className="text-xs text-gray-500">via {record.last_login_method}</span>
            )}
          </div>
        );
      },
    },
    {
      title: 'Actions',
      dataIndex: 'user_id',
      width: '10%',
      render: (_: string, record: IUser) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="h-8 w-8 p-0"
              id={`user-actions-menu-${record.user_id}`}
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
            >
              <span className="sr-only">Open menu</span>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              id={`edit-user-menu-item-${record.user_id}`}
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                handleEditClick(record.user_id);
              }}
              className="px-2 py-1 text-sm cursor-pointer hover:bg-gray-100 flex items-center"
            >
              <Pen size={14} className="mr-2" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              id={`remove-user-menu-item-${record.user_id}`}
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                handleDeleteClick(record);
              }}
              className="px-2 py-1 text-sm cursor-pointer hover:bg-gray-100 flex items-center text-red-600"
            >
              <Trash2 size={14} className="mr-2" />
              Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <div>
      <DataTable
        key={`${currentPage}-${pageSize}`}
        id="users-table"
        data={visibleUsers}
        columns={columns}
        pagination={true}
        currentPage={currentPage}
        onPageChange={setCurrentPage}
        pageSize={pageSize}
        onItemsPerPageChange={handlePageSizeChange}
      />

      <DeleteEntityDialog
        id={userToDelete ? `delete-user-${userToDelete.user_id}` : 'delete-user-dialog'}
        isOpen={isDeleteDialogOpen}
        onClose={resetDeleteState}
        onConfirmDelete={handleConfirmDelete}
        entityName={userToDelete ? `${userToDelete.first_name} ${userToDelete.last_name}` : 'this user'}
        validationResult={deleteValidation}
        isValidating={isDeleteValidating}
        isDeleting={isDeleteProcessing}
      />
    </div>
  );
};

export default UserList;
