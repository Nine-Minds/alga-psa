'use client';
import React, { useState, useEffect } from 'react';
import { IUser } from 'server/src/interfaces/auth.interfaces';
import UserDetails from './UserDetails';
import { useDrawer } from "server/src/context/DrawerContext";
import { DataTable } from 'server/src/components/ui/DataTable';
import UserAvatar from './UserAvatar';
import { getUserAvatarUrl } from 'server/src/lib/utils/avatarUtils';

interface UserListProps {
  users: IUser[];
  onDeleteUser: (userId: string) => Promise<void>;
  onUpdate: () => void;
}

const UserList: React.FC<UserListProps> = ({ users, onDeleteUser, onUpdate }) => {
  const [userToDelete, setUserToDelete] = useState<IUser | null>(null);
  const [userAvatars, setUserAvatars] = useState<Record<string, string | null>>({});
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
          const avatarUrl = await getUserAvatarUrl(user.user_id, user.tenant);
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

  const columns = [
    {
      title: 'First Name',
      dataIndex: 'first_name',
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
    },
    {
      title: 'Actions',
      dataIndex: 'user_id',
      width: '10%',
      render: (_: string, record: IUser) => (
        <div className="flex items-center space-x-2">
          <button
            onClick={() => handleEditClick(record.user_id)}
            className="text-primary-500 hover:text-primary-600 transition-colors"
          >
            Edit
          </button>
          <button
            onClick={() => handleDeleteClick(record)}
            className="text-accent-500 hover:text-accent-600 transition-colors"
          >
            Remove
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <DataTable
        data={users}
        columns={columns}
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
