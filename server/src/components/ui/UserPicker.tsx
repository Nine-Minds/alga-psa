// server/src/components/ui/UserPicker.tsx
import React, { useState, useRef, useEffect } from 'react';
import UserAvatar from 'server/src/components/ui/UserAvatar';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { ChevronDown, Search } from 'lucide-react';
import { AutomationProps, ButtonComponent, ContainerComponent } from '../../types/ui-reflection/types';
import { getUserAvatarUrlsBatchAction } from 'server/src/lib/actions/avatar-actions';
import { Input } from './Input';
import { useAutomationIdAndRegister } from '../../types/ui-reflection/useAutomationIdAndRegister';
import { useRegisterUIComponent } from '../../types/ui-reflection/useRegisterUIComponent';
import { CommonActions } from '../../types/ui-reflection/actionBuilders';

interface UserPickerProps {
  id?: string;
  label?: string;
  value: string;
  onValueChange: (value: string) => void;
  size?: 'sm' | 'lg';
  users: IUserWithRoles[];
  disabled?: boolean;
  className?: string; 
  labelStyle?: 'bold' | 'medium' | 'normal' | 'none'; 
  buttonWidth?: 'fit' | 'full'; 
  placeholder?: string;
  userTypeFilter?: string | string[] | null; // null means no filtering, string/array for specific types
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

const OptionButton: React.FC<OptionButtonProps> = ({ id, label, onClick, className, children, parentId }) => {
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

const UserPicker: React.FC<UserPickerProps & AutomationProps> = ({ 
  id,
  label, 
  value, 
  onValueChange, 
  size = 'sm', 
  users, 
  disabled, 
  className,
  labelStyle = 'bold',
  buttonWidth = 'fit',
  placeholder = 'Not assigned',
  userTypeFilter = 'internal',
  'data-automation-id': dataAutomationId,
  'data-automation-type': dataAutomationType = 'user-picker'
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [dropdownPosition, setDropdownPosition] = useState<'bottom' | 'top'>('bottom');
  const [avatarUrls, setAvatarUrls] = useState<Record<string, string | null>>({});
  const fetchedUserIdsRef = useRef<Set<string>>(new Set());
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  
  // Create stable automation ID for the picker
  const pickerId = dataAutomationId || 'account-manager-picker';
  
  // Apply user type filter
  const applyUserTypeFilter = (user: IUserWithRoles) => {
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
  // Try to register as a child of company-details if we're in that context
  useRegisterUIComponent<ContainerComponent>({
    type: 'container',
    id: pickerId,
    label: label || 'User Picker'
  }, 'company-details');

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
        const avatarUrlsMap = await getUserAvatarUrlsBatchAction(userIdsToFetch, tenant);
        const results = userIdsToFetch.map(userId => ({
          userId,
          url: avatarUrlsMap.get(userId) || null
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
  }, [currentUser, isOpen, filteredUsers, users]);


  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 10);
    }
  }, [isOpen]);

  // Function to update dropdown position
  const updateDropdownPosition = () => {
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
    
    // More aggressive check for limited space below
    // If there's less than 250px below or the dropdown would be cut off, position it above
    if (spaceBelow < 250 || spaceBelow < estimatedDropdownHeight) {
      // Only position above if there's enough space above
      if (spaceAbove > 150) {
        setDropdownPosition('top');
      } else {
        // If there's not enough space above either, use bottom but with reduced height
        setDropdownPosition('bottom');
      }
    } else {
      setDropdownPosition('bottom');
    }
  };

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
  }, [isOpen, filteredUsers.length]);

  const toggleDropdown = (e: React.MouseEvent) => {
    // Stop event propagation to prevent parent handlers from being triggered
    e.stopPropagation();
    
    if (!disabled) {
      setIsOpen(!isOpen);
      if (!isOpen) {
        setSearchQuery('');
      }
    }
  };

  const handleSelectUser = (userId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onValueChange(userId === 'unassigned' ? '' : userId);
    setIsOpen(false);
  };

  return (
    <div className={`relative inline-block ${buttonWidth === 'full' ? 'w-full' : ''} ${className || ''}`} ref={dropdownRef} onClick={(e) => e.stopPropagation()}>
      {label && labelStyle !== 'none' && (
        <h5 className={`mb-1 ${
          labelStyle === 'bold' ? 'font-bold' : 
          labelStyle === 'medium' ? 'font-medium' : 
          'font-normal'
        }`}>{label}</h5>
      )}
      
      {/* Trigger Button */}
      <button
        ref={buttonRef}
        id={id}
        type="button"
        onClick={toggleDropdown}
        disabled={disabled}
        {...pickerProps}
        data-automation-type={dataAutomationType}
        className={`inline-flex items-center justify-between rounded-lg p-2 h-10 text-sm font-medium transition-colors bg-white cursor-pointer border border-[rgb(var(--color-border-400))] text-[rgb(var(--color-text-700))] hover:bg-[rgb(var(--color-primary-50))] hover:text-[rgb(var(--color-primary-700))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none ${
          buttonWidth === 'full' ? 'w-full' : 'w-fit min-w-[150px]'
        }`}
      >
        <div className="flex items-center gap-2 flex-1">
          {currentUser && (
            <UserAvatar
              userId={currentUser.user_id}
              userName={`${currentUser.first_name || ''} ${currentUser.last_name || ''}`.trim()}
              avatarUrl={avatarUrls[currentUser.user_id] || null}
              size={size === 'sm' ? 'sm' : 'md'}
            />
          )}
          <span className={!currentUser ? 'text-gray-400' : ''}>{selectedUserName}</span>
        </div>
        <ChevronDown className="w-4 h-4 text-gray-500" />
      </button>
      
      {/* Dropdown - Using absolute positioning relative to the parent container */}
      {isOpen && (
        <div 
          className="absolute z-[9999]"
          style={{
            width: buttonRef.current ? Math.max(buttonRef.current.offsetWidth, 220) + 'px' : '220px',
            ...(dropdownPosition === 'top' 
              ? { bottom: '100%', marginBottom: '2px' } // Position directly above with a small gap
              : { top: '100%', marginTop: '2px' }) // Position directly below with a small gap
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div 
            className="bg-white rounded-md shadow-lg border border-gray-200 overflow-hidden w-full"
          >
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
                onClick={(e) => e.stopPropagation()}
                className="w-full px-3 py-2 pl-9 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                autoComplete="off"
              />
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-gray-400" />
            </div>
          </div>
          
            {/* User List - Adjust max height to prevent overflow */}
            <div className="overflow-y-auto p-1" style={{ 
              maxHeight: dropdownPosition === 'bottom' ? '200px' : '250px' 
            }}>
              {/* Not assigned option */}
              <OptionButton
                id={`${pickerId}-option-unassigned`}
                label="Not assigned"
                onClick={(e) => handleSelectUser('unassigned', e)}
                className="relative flex items-center px-3 py-2 text-sm rounded text-gray-900 cursor-pointer hover:bg-gray-100 focus:bg-gray-100"
                parentId={pickerId}
              >
                Not assigned
              </OptionButton>
              
              {/* User options */}
              {filteredUsers.map((user): JSX.Element => {
                const userName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Unnamed User';
                return (
                  <OptionButton
                    key={user.user_id}
                    id={`${pickerId}-option-${user.user_id}`}
                    label={userName}
                    onClick={(e) => handleSelectUser(user.user_id, e)}
                    className="relative flex items-center px-3 py-2 text-sm rounded cursor-pointer hover:bg-gray-100 focus:bg-gray-100 text-gray-900"
                    parentId={pickerId}
                  >
                    <div className="flex items-center gap-2">
                      <UserAvatar
                        userId={user.user_id}
                        userName={userName}
                        avatarUrl={avatarUrls[user.user_id] || null}
                        size={size === 'sm' ? 'sm' : 'md'}
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
      )}
    </div>
  );
};

export default UserPicker;
