'use client';
import React, { useState, useEffect } from 'react';
import { IUser } from 'server/src/interfaces/auth.interfaces';
import UserDetails from './UserDetails';
import { useDrawer } from "server/src/context/DrawerContext";
import { DataTable } from 'server/src/components/ui/DataTable';
import UserAvatar from '../../ui/UserAvatar';
import { getUserAvatarUrlAction } from 'server/src/lib/actions/avatar-actions';
import { MoreVertical, Pen, Trash2 } from 'lucide-react';

import ClientDetails from 'server/src/components/clients/ClientDetails';

import { getUsersClientInfo } from 'server/src/lib/actions/user-actions/userClientActions';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from 'server/src/components/ui/DropdownMenu';
import { Button } from 'server/src/components/ui/Button';

interface UserListProps {
  users: IUser[];
  onDeleteUser: (userId: string) => Promise<void>;
  onUpdate: () => void;
  selectedClientId?: string | null;
}

const UserList: React.FC<UserListProps> = ({ users, onDeleteUser, onUpdate, selectedClientId = null }) => {
  const [userToDelete, setUserToDelete] = useState<IUser | null>(null);
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

  const handleDeleteClick = async (user: IUser): Promise<void> => {
    setUserToDelete(user);
  };

  const confirmDelete = async (): Promise<void> => {
    if (userToDelete) {
      await onDeleteUser(userToDelete.user_id);
      setUserToDelete(null);
    }
  };

  

  const handleEditClick = (userId: string) => {
    openDrawer(<UserDetails userId={userId} onUpdate={onUpdate} />);
  };

  const handleClientClick = async (clientId: string) => {
    if (clientId) {
      // Fetch the client data first
      const { getClientById } = await import('server/src/lib/actions/client-actions/clientActions');
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
        id="users-table"
        data={visibleUsers}
        columns={columns}
        pagination={true}
        currentPage={currentPage}
        onPageChange={setCurrentPage}
        pageSize={pageSize}
        onItemsPerPageChange={handlePageSizeChange}
      />

      {userToDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg p-6 max-w-sm w-full">
            <h3 className="text-lg font-semibold mb-4 text-text-900">Confirm Removal</h3>
            <p className="text-text-700 mb-6">
              Are you sure you want to remove {userToDelete.first_name} {userToDelete.last_name}?
            </p>
            <div className="flex justify-end space-x-4">
              <button
                onClick={() => setUserToDelete(null)}
                className="px-4 py-2 text-text-600 hover:text-text-900 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="px-4 py-2 bg-accent-500 text-white rounded hover:bg-accent-600 transition-colors"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserList;
