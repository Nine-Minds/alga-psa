// server/src/components/ui/UserPicker.tsx
import React, { useState, useRef, useEffect } from 'react';
import UserAvatar from 'server/src/components/ui/UserAvatar';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { ChevronDown, Search } from 'lucide-react';
import { AutomationProps } from '../../types/ui-reflection/types';
import { getUserAvatarUrl } from 'server/src/lib/utils/avatarUtils';

interface UserPickerProps {
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
}

const UserPicker: React.FC<UserPickerProps & AutomationProps> = ({ 
  label, 
  value, 
  onValueChange, 
  size = 'sm', 
  users, 
  disabled, 
  className,
  labelStyle = 'bold',
  buttonWidth = 'fit',
  placeholder = 'Not assigned'
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [dropdownPosition, setDropdownPosition] = useState<'bottom' | 'top'>('bottom');
  const [avatarUrls, setAvatarUrls] = useState<Record<string, string | null>>({});
  const fetchedUserIdsRef = useRef<Set<string>>(new Set());
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  
  // Filter for internal users only
  const internalUsers = users.filter(user => user.user_type === 'internal');
  
  const currentUser = internalUsers.find(user => user.user_id === value);
  
  const filteredUsers = internalUsers.filter(user => {
    const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim().toLowerCase();
    return fullName.includes(searchQuery.toLowerCase());
  });
  
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
      
      // Fetch avatar URLs for all needed users
      const urlPromises = userIdsToFetch.map(async (userId) => {
        try {
          fetchedUserIdsRef.current.add(userId);
          const url = await getUserAvatarUrl(userId, tenant);
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

  const selectedUserName = currentUser 
    ? `${currentUser.first_name || ''} ${currentUser.last_name || ''}`.trim() || 'Unnamed User'
    : placeholder;

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
        type="button"
        onClick={toggleDropdown}
        disabled={disabled}
        className={`inline-flex items-center justify-between border border-gray-200 rounded-lg p-2 bg-white cursor-pointer min-h-[38px] hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm ${
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
          <span>{selectedUserName}</span>
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
              <input
                ref={searchInputRef}
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
              <div
                className="relative flex items-center px-3 py-2 text-sm rounded text-gray-900 cursor-pointer hover:bg-gray-100 focus:bg-gray-100"
                onClick={(e) => handleSelectUser('unassigned', e)}
              >
                Not assigned
              </div>
              
              {/* User options */}
              {filteredUsers.map((user) => (
                <div
                  key={user.user_id}
                  className={`relative flex items-center px-3 py-2 text-sm rounded cursor-pointer hover:bg-gray-100 focus:bg-gray-100 ${
                    user.is_inactive ? 'text-gray-400 bg-gray-50' : 'text-gray-900'
                  }`}
                  onClick={(e) => handleSelectUser(user.user_id, e)}
                >
                  <div className="flex items-center gap-2">
                    <UserAvatar
                      userId={user.user_id}
                      userName={`${user.first_name || ''} ${user.last_name || ''}`.trim()}
                      avatarUrl={avatarUrls[user.user_id] || null}
                      size={size === 'sm' ? 'sm' : 'md'}
                    />
                    <span>{`${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Unnamed User'}</span>
                    {user.is_inactive && (
                      <span className="ml-1 text-xs text-gray-400">(Inactive)</span>
                    )}
                  </div>
                </div>
              ))}
              
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
