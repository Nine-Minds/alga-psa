'use client';
import React, { useState, useEffect } from 'react';
import { IUser } from 'server/src/interfaces/auth.interfaces';
import UserDetails from './UserDetails';
import { useDrawer } from "server/src/context/DrawerContext";
import { DataTable } from 'server/src/components/ui/DataTable';
import UserAvatar from '../../ui/UserAvatar';
import { getUserAvatarUrlAction } from 'server/src/lib/actions/avatar-actions';
import { MoreVertical, Pen, Trash2 } from 'lucide-react';

import CompanyDetails from 'server/src/components/companies/CompanyDetails';

import { getUsersCompanyInfo } from 'server/src/lib/actions/user-actions/userCompanyActions';
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
  selectedCompanyId?: string | null;
}

const UserList: React.FC<UserListProps> = ({ users, onDeleteUser, onUpdate, selectedCompanyId = null }) => {
  const [userToDelete, setUserToDelete] = useState<IUser | null>(null);
  const [userAvatars, setUserAvatars] = useState<Record<string, string | null>>({});
  const [userCompanies, setUserCompanies] = useState<Record<string, { company_id: string; company_name: string } | null>>({});
  const { openDrawer } = useDrawer();

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
    // Fetch associated company for client users in bulk
    const fetchCompaniesForUsers = async () => {
      const usersToFetch = users
        .filter((u) => u.user_type === 'client' && userCompanies[u.user_id] === undefined)
        .map((u) => u.user_id);

      if (usersToFetch.length === 0) return;

      try {
        const result = await getUsersCompanyInfo(usersToFetch);
        const map: Record<string, { company_id: string; company_name: string } | null> = {};
        result.forEach((row) => {
          map[row.user_id] = row.company_id
            ? { company_id: row.company_id, company_name: row.company_name || 'Unnamed Company' }
            : null;
        });
        setUserCompanies((prev) => ({ ...prev, ...map }));
      } catch (e) {
        console.error('Error fetching companies for users', e);
      }
    };

    if (users.length > 0) {
      fetchCompaniesForUsers();
    }
  }, [users, userCompanies]);

  // Filter by selected company if provided (client users only)
  const visibleUsers = React.useMemo(() => {
    if (!selectedCompanyId) return users;
    const clientUsers = users.filter((u) => u.user_type === 'client');
    const allResolved = clientUsers.every((u) => userCompanies[u.user_id] !== undefined);
    if (!allResolved) return users; // avoid flicker while resolving
    return users.filter((u) => userCompanies[u.user_id]?.company_id === selectedCompanyId);
  }, [users, userCompanies, selectedCompanyId]);

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

  const handleCompanyClick = async (companyId: string) => {
    if (companyId) {
      // Fetch the company data first
      const { getCompanyById } = await import('server/src/lib/actions/company-actions/companyActions');
      const company = await getCompanyById(companyId);
      if (company) {
        openDrawer(
          <CompanyDetails
            company={company}
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
      width: '20%',
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
      width: '20%'
    },
    {
      title: 'Email',
      dataIndex: 'email',
      width: '20%'
    },
    ...(hasClientUsers
      ? [{
          title: 'Client',
          dataIndex: 'company',
          width: '20%',
          render: (_: any, record: IUser) => {
            const company = userCompanies[record.user_id];
            if (company === undefined) {
              return <span className="text-gray-400">Loading...</span>;
            }
            if (!company) {
              return <span className="text-gray-400">No Company</span>;
            }
            return (
              <button
                id={`open-company-details-${record.user_id}`}
                onClick={(e) => {
                  e.preventDefault();
                  handleCompanyClick(company.company_id);
                }}
                className="text-blue-500 hover:underline text-left whitespace-normal break-words"
              >
                {company.company_name}
              </button>
            );
          },
        }]
      : []),
    {
      title: 'Role',
      dataIndex: 'roles',
      width: '20%',
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
      <DataTable data={visibleUsers} columns={columns} />

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
