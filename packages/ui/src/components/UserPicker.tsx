'use client';

// server/src/components/ui/UserPicker.tsx
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import UserAvatar from './UserAvatar';
import { IUser } from '@alga-psa/types';
import { ChevronDown, Search } from 'lucide-react';
import { AutomationProps, ButtonComponent, ContainerComponent } from '../ui-reflection/types';
import { Input } from './Input';
import { Button } from './Button';
import { useAutomationIdAndRegister } from '../ui-reflection/useAutomationIdAndRegister';
import { useRegisterUIComponent } from '../ui-reflection/useRegisterUIComponent';
import { CommonActions } from '../ui-reflection/actionBuilders';

export type GetUserAvatarUrlsBatch = (
  userIds: string[],
  tenant: string
) => Promise<Map<string, string | null> | Record<string, string | null>>;

interface UserPickerProps {
  id?: string;
  label?: string;
  value: string;
  onValueChange: (value: string) => void;
  size?: 'xs' | 'sm' | 'lg';
  users: IUser[];
  getUserAvatarUrlsBatch?: GetUserAvatarUrlsBatch;
  disabled?: boolean;
  className?: string;
  labelStyle?: 'bold' | 'medium' | 'normal' | 'none';
  buttonWidth?: 'fit' | 'full';
  placeholder?: string;
  userTypeFilter?: string | string[] | null; // null means no filtering, string/array for specific types
  modal?: boolean;
}

// Component for individual option buttons that registers with UI reflection
interface OptionButtonProps {
  id: string;
  label: string;
  onClick: (e: React.MouseEvent) => void;
  className?: string;
  children: React.ReactNode;
  parentId: string;
}

const OptionButton = ({ id, label, onClick, className, children, parentId }: OptionButtonProps) => {
  useRegisterUIComponent<ButtonComponent>({
    type: 'button',
    id,
    label: `${parentId} - ${label}`,
    actions: [CommonActions.click()]
  }, parentId);

  return (
    <div
      data-automation-id={id}
      data-automation-type="button"
      className={className}
      onClick={onClick}
    >
      {children}
    </div>
  );
};

const UserPicker = ({
  id,
  label,
  value,
  onValueChange,
  size = 'sm',
  users,
  getUserAvatarUrlsBatch,
  disabled,
  className,
  labelStyle = 'bold',
  buttonWidth = 'fit',
  placeholder = 'Not assigned',
  userTypeFilter = 'internal',
  modal = true,
  'data-automation-id': dataAutomationId,
  'data-automation-type': dataAutomationType = 'user-picker'
}: UserPickerProps & AutomationProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [dropdownPosition, setDropdownPosition] = useState<'bottom' | 'top'>('bottom');
  const [dropdownCoords, setDropdownCoords] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 220 });
  const [avatarUrls, setAvatarUrls] = useState<Record<string, string | null>>({});
  const fetchedUserIdsRef = useRef<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Create stable automation ID for the picker
  const pickerId = dataAutomationId || 'account-manager-picker';

  // Apply user type filter
  const applyUserTypeFilter = (user: IUser) => {
    if (userTypeFilter === null) {
      return true; // No filtering
    }
    if (Array.isArray(userTypeFilter)) {
      return userTypeFilter.includes(user.user_type);
    }
    return user.user_type === userTypeFilter;
  };

  // Find the current user first (even if inactive)
  const currentUser = users.find(user => user.user_id === value && applyUserTypeFilter(user));

  // Filter users based on type and exclude inactive users for the dropdown
  const filteredByType = users.filter(user =>
    applyUserTypeFilter(user) && !user.is_inactive
  );

  const filteredUsers = filteredByType
    .filter(user => {
      const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim().toLowerCase();
      return fullName.includes(searchQuery.toLowerCase());
    })
    .sort((a, b) => {
      const nameA = `${a.first_name || ''} ${a.last_name || ''}`.trim().toLowerCase();
      const nameB = `${b.first_name || ''} ${b.last_name || ''}`.trim().toLowerCase();
      return nameA.localeCompare(nameB);
    });

  // Calculate selected user name for display
  const selectedUserName = currentUser
    ? `${currentUser.first_name || ''} ${currentUser.last_name || ''}`.trim() || 'Unnamed User'
    : placeholder;

  // Register the main container first, then the trigger button
  // Try to register as a child of client-details if we're in that context
  useRegisterUIComponent<ContainerComponent>({
    type: 'container',
    id: pickerId,
    label: label || 'User Picker'
  }, 'client-details');

  // Register the trigger button as a child component
  const { automationIdProps: pickerProps, updateMetadata } = useAutomationIdAndRegister<ButtonComponent>({
    type: 'button',
    id: `${pickerId}-trigger`,
    label: `${label} - ${selectedUserName}`,
    disabled
  }, [CommonActions.click()]);

  // Update metadata when picker state changes
  useEffect(() => {
    if (updateMetadata) {
      updateMetadata({
        label,
        disabled
      });
    }
  }, [value, label, disabled, updateMetadata]);

  // Fetch avatar URLs for visible users
  useEffect(() => {
    // Skip if no users or no tenant available
    if (!users.length) return;
    if (!getUserAvatarUrlsBatch) return;

    const tenant = currentUser?.tenant || users[0]?.tenant;
    if (!tenant) return;

    const fetchAvatarUrls = async () => {
      const userIds = new Set<string>();

      // Add current user if selected
      if (currentUser?.user_id) {
        userIds.add(currentUser.user_id);
      }

      // Add filtered users when dropdown is open
      if (isOpen) {
        // Limit to first 20 users to prevent performance issues with large lists
        const limitedUsers = filteredUsers.slice(0, 20);
        limitedUsers.forEach(user => userIds.add(user.user_id));
      }

      const userIdsToFetch = Array.from(userIds).filter(
        userId => !fetchedUserIdsRef.current.has(userId) && avatarUrls[userId] === undefined
      );

      if (userIdsToFetch.length === 0) return;

      // Mark all user IDs as being fetched to prevent duplicate requests
      userIdsToFetch.forEach(userId => fetchedUserIdsRef.current.add(userId));

      // Fetch avatar URLs for all needed users using batch action
      try {
        const avatarUrlsResponse = await getUserAvatarUrlsBatch(userIdsToFetch, tenant);
        const resolveUrl = (userId: string): string | null => {
          if (avatarUrlsResponse && typeof (avatarUrlsResponse as Map<string, string | null>).get === 'function') {
            return (avatarUrlsResponse as Map<string, string | null>).get(userId) ?? null;
          }
          return (avatarUrlsResponse as Record<string, string | null>)[userId] ?? null;
        };
        const results = userIdsToFetch.map(userId => ({
          userId,
          url: resolveUrl(userId)
        }));

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
      } catch (error) {
        console.error('Error fetching avatar URLs:', error);
      }
    };

    void fetchAvatarUrls();
  }, [currentUser, isOpen, filteredUsers, users, getUserAvatarUrlsBatch]);


  // Handle click outside to close dropdown
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;

      // Check if click is inside the dropdown portal or the trigger button
      const isInsideDropdown = dropdownRef.current?.contains(target);
      const isInsideButton = buttonRef.current?.contains(target);

      if (!isInsideDropdown && !isInsideButton) {
        setIsOpen(false);
      }
    };

    // Use capture phase to handle events before they reach other handlers
    document.addEventListener('mousedown', handleClickOutside, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true);
    };
  }, [isOpen]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 10);
    }
  }, [isOpen]);

  // Function to update dropdown position
  const updateDropdownPosition = useCallback(() => {
    if (!buttonRef.current) return;

    const buttonRect = buttonRef.current.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const spaceBelow = viewportHeight - buttonRect.bottom;
    const spaceAbove = buttonRect.top;

    // Estimate dropdown height based on number of items
    // Base height: search input (40px) + padding (20px) + "Not assigned" option (36px)
    const baseHeight = 40 + 20 + 36;
    // Add height for each user (up to 5 visible at once)
    const itemsHeight = Math.min(filteredUsers.length, 5) * 36;
    // Total estimated height with some buffer
    const estimatedDropdownHeight = baseHeight + itemsHeight + 10;

    const dropdownWidth = Math.max(buttonRect.width, 220);

    // More aggressive check for limited space below
    // If there's less than 250px below or the dropdown would be cut off, position it above
    if (spaceBelow < 250 || spaceBelow < estimatedDropdownHeight) {
      // Only position above if there's enough space above
      if (spaceAbove > 150) {
        setDropdownPosition('top');
        setDropdownCoords({
          top: buttonRect.top - 2,
          left: buttonRect.left,
          width: dropdownWidth
        });
      } else {
        setDropdownPosition('bottom');
        setDropdownCoords({
          top: buttonRect.bottom + 2,
          left: buttonRect.left,
          width: dropdownWidth
        });
      }
    } else {
      setDropdownPosition('bottom');
      setDropdownCoords({
        top: buttonRect.bottom + 2,
        left: buttonRect.left,
        width: dropdownWidth
      });
    }
  }, [filteredUsers.length]);

  // Calculate dropdown position when it opens
  useEffect(() => {
    if (isOpen) {
      updateDropdownPosition();

      // Update position on scroll and resize
      window.addEventListener('scroll', updateDropdownPosition, true);
      window.addEventListener('resize', updateDropdownPosition);

      return () => {
        window.removeEventListener('scroll', updateDropdownPosition, true);
        window.removeEventListener('resize', updateDropdownPosition);
      };
    }
  }, [isOpen, updateDropdownPosition]);

  const toggleDropdown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!disabled) {
      setIsOpen(!isOpen);
      if (!isOpen) {
        setSearchQuery('');
      }
    }
  };

  const handleSelectUser = (userId: string) => {
    onValueChange(userId === 'unassigned' ? '' : userId);
    setIsOpen(false);
  };

  // Render the dropdown content
  const dropdownContent = (
    <div
      ref={dropdownRef}
      className="fixed z-[10000] pointer-events-auto"
      style={{
        top: dropdownPosition === 'top' ? 'auto' : `${dropdownCoords.top}px`,
        bottom: dropdownPosition === 'top' ? `${window.innerHeight - dropdownCoords.top}px` : 'auto',
        left: `${dropdownCoords.left}px`,
        width: `${dropdownCoords.width}px`,
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="bg-white rounded-md shadow-lg border border-gray-200 overflow-hidden w-full">
        {/* Search Input */}
        <div className="p-2 border-b border-gray-200">
          <div className="relative">
            <Input
              ref={searchInputRef}
              data-automation-id={dataAutomationId ? `${dataAutomationId}-search` : undefined}
              type="text"
              placeholder="Search users..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-3 py-2 pl-9 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[rgb(var(--color-primary-500))] focus:border-transparent"
              autoComplete="off"
            />
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-gray-400" />
          </div>
        </div>

        {/* User List */}
        <div
          className="overflow-y-auto p-1"
          style={{
            maxHeight: dropdownPosition === 'bottom' ? '200px' : '250px',
            overscrollBehavior: 'contain'
          }}
          onWheel={(e) => {
            // Prevent scroll from propagating to parent elements
            e.stopPropagation();
          }}
        >
          {/* Not assigned option */}
          <OptionButton
            id={`${pickerId}-option-unassigned`}
            label="Not assigned"
            onClick={() => handleSelectUser('unassigned')}
            className="relative flex items-center px-3 py-2 text-sm rounded text-gray-900 cursor-pointer hover:bg-gray-100 focus:bg-gray-100"
            parentId={pickerId}
          >
            Not assigned
          </OptionButton>

          {/* User options */}
          {filteredUsers.map((user): React.JSX.Element => {
            const userName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Unnamed User';
            return (
              <OptionButton
                key={user.user_id}
                id={`${pickerId}-option-${user.user_id}`}
                label={userName}
                onClick={() => handleSelectUser(user.user_id)}
                className="relative flex items-center px-3 py-2 text-sm rounded cursor-pointer hover:bg-gray-100 focus:bg-gray-100 text-gray-900"
                parentId={pickerId}
              >
                <div className="flex items-center gap-2">
                  <UserAvatar
                    userId={user.user_id}
                    userName={userName}
                    avatarUrl={avatarUrls[user.user_id] || null}
                    size={size === 'xs' ? 'xs' : size === 'sm' ? 'sm' : 'md'}
                  />
                  <span>{userName}</span>
                </div>
              </OptionButton>
            );
          })}

          {filteredUsers.length === 0 && searchQuery && (
            <div className="px-3 py-2 text-sm text-gray-500">No users found</div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div
      className={`relative inline-block ${buttonWidth === 'full' ? 'w-full' : ''} ${className || ''}`}
      ref={containerRef}
    >
      {label && labelStyle !== 'none' && (
        <h5 className={`mb-1 ${
          labelStyle === 'bold' ? 'font-bold' :
          labelStyle === 'medium' ? 'font-medium' :
          'font-normal'
        }`}>{label}</h5>
      )}

      {/* Trigger Button */}
      <Button
        {...pickerProps}
        ref={buttonRef}
        id={id || pickerProps['data-automation-id'] || 'user-picker-button'}
        type="button"
        onClick={toggleDropdown}
        disabled={disabled}
        variant="outline"
        data-automation-type={dataAutomationType}
        className={`inline-flex items-center justify-between rounded-lg font-medium ${
          size === 'xs'
            ? 'p-1 h-7 text-xs min-w-0 gap-1'
            : 'p-2 h-10 text-sm'
        } ${
          buttonWidth === 'full' ? 'w-full' : size === 'xs' ? 'w-fit' : 'w-fit min-w-[150px]'
        }`}
      >
        <div className={`flex items-center flex-1 ${size === 'xs' ? 'gap-1' : 'gap-2'}`}>
          {currentUser && (
            <UserAvatar
              userId={currentUser.user_id}
              userName={`${currentUser.first_name || ''} ${currentUser.last_name || ''}`.trim()}
              avatarUrl={avatarUrls[currentUser.user_id] || null}
              size={size === 'xs' ? 'xs' : size === 'sm' ? 'sm' : 'md'}
            />
          )}
          {size !== 'xs' && (
            <span className={!currentUser ? 'text-gray-400' : ''}>{selectedUserName}</span>
          )}
        </div>
        <ChevronDown className={size === 'xs' ? 'w-3 h-3 text-gray-500' : 'w-4 h-4 text-gray-500'} />
      </Button>

      {/* Dropdown - Using portal to escape overflow:hidden containers */}
      {isOpen && typeof document !== 'undefined' && createPortal(
        dropdownContent,
        document.body
      )}
    </div>
  );
};

export default UserPicker;
