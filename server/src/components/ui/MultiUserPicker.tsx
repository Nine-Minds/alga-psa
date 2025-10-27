// server/src/components/ui/MultiUserPicker.tsx
'use client';

import React, { useState, useEffect, useRef } from 'react';
import UserAvatar from 'server/src/components/ui/UserAvatar';
import { IUserWithRoles } from '../../interfaces/auth.interfaces';
import * as RadixSelect from '@radix-ui/react-select';
import { ChevronDown, X } from 'lucide-react';
import { AutomationProps } from '../../types/ui-reflection/types';
import { getUserAvatarUrlsBatchAction } from '@product/actions/avatar-actions';

interface MultiUserPickerProps {
  label?: string;
  values: string[];
  onValuesChange: (values: string[]) => void;
  size?: 'sm' | 'lg';
  users: IUserWithRoles[];
  loading?: boolean;
  error?: string | null;
}

const MultiUserPicker: React.FC<MultiUserPickerProps & AutomationProps> = ({ 
  label, 
  values = [], 
  onValuesChange, 
  size = 'sm',
  users,
  loading = false,
  error = null
}) => {
  const [avatarUrls, setAvatarUrls] = useState<Record<string, string | null>>({});
  const fetchedUserIdsRef = useRef<Set<string>>(new Set());
  
  // Filter for MSP (internal) users only
  const internalUsers = users.filter(user => user.user_type === 'internal');
  
  const selectedUsers = internalUsers.filter(user => values.includes(user.user_id));
  
  useEffect(() => {
    // Skip if no users or no tenant available
    if (!users.length) return;
    
    const tenant = users[0]?.tenant;
    if (!tenant) return;
    
    const fetchAvatarUrls = async () => {
      // Get user IDs that need avatar URLs
      const userIds = new Set<string>();
      
      // Add selected users
      selectedUsers.forEach(user => userIds.add(user.user_id));
      
      // Filter out already fetched user IDs
      const userIdsToFetch = Array.from(userIds).filter(
        userId => !fetchedUserIdsRef.current.has(userId) && avatarUrls[userId] === undefined
      );
      
      if (userIdsToFetch.length === 0) return;
      
      // Fetch avatar URLs for all needed users
      const urlPromises = userIdsToFetch.map(async (userId) => {
        try {
          fetchedUserIdsRef.current.add(userId);
          // Use batch fetching for better performance
          const avatarUrlsMap = await getUserAvatarUrlsBatchAction([userId], tenant);
          const url = avatarUrlsMap.get(userId) || null;
          return { userId, url };
        } catch (error) {
          console.error(`Error fetching avatar URL for user ${userId}:`, error);
          return { userId, url: null };
        }
      });
      
      const results = await Promise.all(urlPromises);
      
      if (results.length > 0) {
        setAvatarUrls(prev => {
          const newUrls = { ...prev };
          results.forEach(result => {
            if (result && result.userId) {
              newUrls[result.userId] = result.url;
            }
          });
          return newUrls;
        });
      }
    };
    
    fetchAvatarUrls();
  }, [selectedUsers, users]);

  const handleValueChange = (userId: string) => {
    if (values.includes(userId)) {
      onValuesChange(values.filter(id => id !== userId));
    } else {
      onValuesChange([...values, userId]);
    }
  };

  const removeUser = (userId: string) => {
    onValuesChange(values.filter(id => id !== userId));
  };

  const CustomTrigger = React.forwardRef<HTMLButtonElement, RadixSelect.SelectTriggerProps>(
    (props, forwardedRef) => (
      <RadixSelect.Trigger
        ref={forwardedRef}
        className="inline-flex items-center justify-between border border-gray-200 rounded-lg p-2 bg-white cursor-pointer min-h-[38px] hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-[rgb(var(--color-primary-500))] focus:border-transparent text-sm w-full"
        {...props}
      >
        <div className="flex items-center gap-2 flex-wrap flex-1">
          {selectedUsers.length === 0 ? (
            <span className="text-gray-500">Select users...</span>
          ) : (
            selectedUsers.map((user): JSX.Element => (
              <div
                key={user.user_id}
                className="flex items-center gap-1 bg-gray-100 rounded-full pl-1 pr-2 py-1"
              >
                <UserAvatar
                  userId={user.user_id}
                  userName={`${user.first_name || ''} ${user.last_name || ''}`.trim()}
                  avatarUrl={avatarUrls[user.user_id] || null}
                  size={size === 'sm' ? 'sm' : 'md'}
                />
                <span>{`${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Unnamed User'}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeUser(user.user_id);
                  }}
                  className="ml-1 p-1 hover:bg-gray-200 rounded-full"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))
          )}
        </div>
        <RadixSelect.Icon>
          <ChevronDown className="w-4 h-4 text-gray-500 ml-2" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
    )
  );

  interface CustomItemProps extends RadixSelect.SelectItemProps {
    user?: IUserWithRoles;
  }

  const CustomItem = React.forwardRef<HTMLDivElement, CustomItemProps>(
    ({ children, className, user, ...props }, forwardedRef) => {
      const isSelected = user ? values.includes(user.user_id) : false;

      return (
        <RadixSelect.Item
          className={`
            relative flex items-center px-3 py-2 text-sm rounded text-gray-900
            cursor-pointer bg-white hover:bg-gray-100
            focus:outline-none select-none whitespace-nowrap
            ${isSelected ? 'bg-gray-100' : ''}
            ${className || ''}
          `}
          ref={forwardedRef}
          {...props}
        >
          <div className="flex items-center gap-2">
            {user && (
              <UserAvatar
                userId={user.user_id}
                userName={`${user.first_name || ''} ${user.last_name || ''}`.trim()}
                avatarUrl={avatarUrls[user.user_id] || null}
                size={size === 'sm' ? 'sm' : 'md'}
              />
            )}
            <RadixSelect.ItemText>{children}</RadixSelect.ItemText>
          </div>
          {isSelected && (
            <div className="absolute right-2">
              <div className="w-2 h-2 bg-purple-500 rounded-full" />
            </div>
          )}
        </RadixSelect.Item>
      );
    }
  );

  return (
    <div className="relative">
      {label && <h5 className="font-bold mb-1">{label}</h5>}
      <RadixSelect.Root value={values[0] || ''} onValueChange={handleValueChange}>
        <CustomTrigger>
          <div className="flex items-center gap-2 flex-wrap flex-1">
            {selectedUsers.length === 0 ? (
              <span className="text-gray-500">
                {loading ? 'Loading users...' : 'Select users...'}
              </span>
            ) : (
              selectedUsers.map((user): JSX.Element => (
                <div
                  key={user.user_id}
                  className="flex items-center gap-1 bg-gray-100 rounded-full pl-1 pr-2 py-1"
                >
                  <UserAvatar
                    userId={user.user_id}
                    userName={`${user.first_name || ''} ${user.last_name || ''}`.trim()}
                    avatarUrl={avatarUrls[user.user_id] || null}
                    size={size === 'sm' ? 'sm' : 'md'}
                  />
                  <span>{`${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Unnamed User'}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeUser(user.user_id);
                    }}
                    className="ml-1 p-1 hover:bg-gray-200 rounded-full"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))
            )}
          </div>
          <RadixSelect.Icon>
            <ChevronDown className="w-4 h-4 text-gray-500 ml-2" />
          </RadixSelect.Icon>
        </CustomTrigger>
        <RadixSelect.Portal>
          <RadixSelect.Content
            className="overflow-hidden bg-white rounded-md shadow-lg border border-gray-200 mt-1 z-[100] min-w-[200px]"
            position="popper"
            sideOffset={4}
            align="start"
          >
            <RadixSelect.Viewport className="p-1">
              {loading ? (
                <div className="px-3 py-2 text-sm text-gray-500">Loading users...</div>
              ) : error ? (
                <div className="px-3 py-2 text-sm text-red-500">Error loading users</div>
              ) : internalUsers.length === 0 ? (
                <div className="px-3 py-2 text-sm text-gray-500">No users available</div>
              ) : (
                internalUsers.map((user): JSX.Element => (
                  <CustomItem key={user.user_id} value={user.user_id} user={user}>
                    {`${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Unnamed User'}
                  </CustomItem>
                ))
              )}
            </RadixSelect.Viewport>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>
    </div>
  );
};

export default MultiUserPicker;
