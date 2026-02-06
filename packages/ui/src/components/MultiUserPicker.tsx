// server/src/components/ui/MultiUserPicker.tsx
'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import UserAvatar from './UserAvatar';
import type { IUser } from '@alga-psa/types';
import { ChevronDown, X, Search, UserMinus } from 'lucide-react';
import { AutomationProps } from '../ui-reflection/types';
import type { GetUserAvatarUrlsBatch } from './UserPicker';
import { Input } from './Input';
import { Checkbox } from './Checkbox';
import { Button } from './Button';

interface MultiUserPickerProps {
  id?: string;
  label?: string;
  values: string[];
  onValuesChange: (values: string[]) => void;
  size?: 'sm' | 'lg';
  users: IUser[];
  getUserAvatarUrlsBatch?: GetUserAvatarUrlsBatch;
  loading?: boolean;
  error?: string | null;
  disabled?: boolean;
  placeholder?: string;
  // Filter mode props
  filterMode?: boolean;
  includeUnassigned?: boolean;
  onUnassignedChange?: (value: boolean) => void;
  showSearch?: boolean;
  compactDisplay?: boolean;
  // Click handler for viewing user details (e.g., opening schedule drawer)
  onUserClick?: (userId: string) => void;
}

const MultiUserPicker = ({
  id,
  label,
  values = [],
  onValuesChange,
  size = 'sm',
  users,
  getUserAvatarUrlsBatch,
  loading = false,
  error = null,
  disabled = false,
  placeholder = 'Select users...',
  filterMode = false,
  includeUnassigned = false,
  onUnassignedChange,
  showSearch = false,
  compactDisplay = false,
  onUserClick,
  'data-automation-id': dataAutomationId
}: MultiUserPickerProps & AutomationProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [avatarUrls, setAvatarUrls] = useState<Record<string, string | null>>({});
  const [dropdownPosition, setDropdownPosition] = useState<'bottom' | 'top'>('bottom');
  const [dropdownCoords, setDropdownCoords] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 250 });
  const fetchedUserIdsRef = useRef<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Ref to track which values we've already cleaned to prevent infinite loops
  const lastCleanedValuesRef = useRef<string | null>(null);

  // Filter for internal users only and exclude inactive users
  const internalUsers = users.filter(user => user.user_type === 'internal' && !user.is_inactive);

  // Get valid internal user IDs for filtering stale values
  const internalUserIds = new Set(internalUsers.map(u => u.user_id));

  // Filter out stale/invalid values that don't match any internal user
  // This handles cases where values contain IDs of inactive/external users from URL or saved state
  const validValues = values.filter(id => internalUserIds.has(id));

  // If values contained stale IDs, notify parent to clean them up
  // Use a ref to prevent infinite loops - only clean once per unique values array
  useEffect(() => {
    // Only run in filter mode
    if (!filterMode) return;

    // Skip if no values or no users loaded yet
    if (values.length === 0 || internalUsers.length === 0) return;

    // Skip if all values are already valid
    if (validValues.length === values.length) return;

    // Create a stable key for current values to detect if we've already cleaned this set
    const valuesKey = values.slice().sort().join(',');

    // Skip if we've already processed this exact set of values
    if (lastCleanedValuesRef.current === valuesKey) return;

    // Mark these values as cleaned and notify parent
    lastCleanedValuesRef.current = valuesKey;
    onValuesChange(validValues);
  }, [filterMode, values, validValues, internalUsers.length, onValuesChange]);

  // Apply search filter
  const filteredUsers = internalUsers
    .filter(user => {
      if (!searchQuery) return true;
      const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim().toLowerCase();
      return fullName.includes(searchQuery.toLowerCase());
    })
    .sort((a, b) => {
      const nameA = `${a.first_name || ''} ${a.last_name || ''}`.trim().toLowerCase();
      const nameB = `${b.first_name || ''} ${b.last_name || ''}`.trim().toLowerCase();
      return nameA.localeCompare(nameB);
    });

  const selectedUsers = internalUsers.filter(user => validValues.includes(user.user_id));

  // Fetch avatar URLs
  useEffect(() => {
    if (!users.length) return;
    if (!getUserAvatarUrlsBatch) return;

    const tenant = users[0]?.tenant;
    if (!tenant) return;

    const fetchAvatarUrls = async () => {
      const userIds = new Set<string>();
      selectedUsers.forEach(user => userIds.add(user.user_id));

      if (isOpen) {
        filteredUsers.slice(0, 20).forEach(user => userIds.add(user.user_id));
      }

      const userIdsToFetch = Array.from(userIds).filter(
        userId => !fetchedUserIdsRef.current.has(userId) && avatarUrls[userId] === undefined
      );

      if (userIdsToFetch.length === 0) return;

      userIdsToFetch.forEach(userId => fetchedUserIdsRef.current.add(userId));

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
      } catch (err) {
        console.error('Error fetching avatar URLs:', err);
      }
    };

    void fetchAvatarUrls();
  }, [selectedUsers, isOpen, filteredUsers, users, getUserAvatarUrlsBatch]);

  // Handle click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const isInsideDropdown = dropdownRef.current?.contains(target);
      const isInsideButton = buttonRef.current?.contains(target);

      if (!isInsideDropdown && !isInsideButton) {
        setIsOpen(false);
        setSearchQuery(''); // Clear search when clicking outside
      }
    };

    document.addEventListener('mousedown', handleClickOutside, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true);
    };
  }, [isOpen]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && showSearch && searchInputRef.current) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 10);
    }
  }, [isOpen, showSearch]);

  // Update dropdown position
  const updateDropdownPosition = useCallback(() => {
    if (!buttonRef.current) return;

    const buttonRect = buttonRef.current.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const spaceBelow = viewportHeight - buttonRect.bottom;
    const spaceAbove = buttonRect.top;
    const estimatedDropdownHeight = 350;
    const dropdownWidth = Math.max(buttonRect.width, 250);

    if (spaceBelow < estimatedDropdownHeight && spaceAbove > spaceBelow) {
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
  }, []);

  useEffect(() => {
    if (isOpen) {
      updateDropdownPosition();
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
      const willOpen = !isOpen;
      setIsOpen(willOpen);
      // Clear search when opening or closing
      setSearchQuery('');
    }
  };

  const handleUserToggle = (userId: string) => {
    if (values.includes(userId)) {
      onValuesChange(values.filter(id => id !== userId));
    } else {
      onValuesChange([...values, userId]);
    }
  };

  const removeUser = (userId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    onValuesChange(values.filter(id => id !== userId));
  };

  const handleUnassignedToggle = () => {
    onUnassignedChange?.(!includeUnassigned);
  };

  const handleClearAll = () => {
    onValuesChange([]);
    onUnassignedChange?.(false);
  };

  // Render trigger content
  const renderTriggerContent = () => {
    const hasSelection = selectedUsers.length > 0 || includeUnassigned;

    if (!hasSelection) {
      return <span className="text-gray-500">{loading ? 'Loading users...' : placeholder}</span>;
    }

    // Compact display mode (for filters)
    if (compactDisplay) {
      if (selectedUsers.length === 0 && includeUnassigned) {
        return (
          <div className="flex items-center gap-2">
            <UserMinus className="w-4 h-4 text-gray-500" />
            <span>Unassigned</span>
          </div>
        );
      }

      if (selectedUsers.length === 1 && !includeUnassigned) {
        const user = selectedUsers[0];
        return (
          <div className="flex items-center gap-2">
            <UserAvatar
              userId={user.user_id}
              userName={`${user.first_name || ''} ${user.last_name || ''}`.trim()}
              avatarUrl={avatarUrls[user.user_id] || null}
              size="xs"
            />
            <span className="truncate max-w-[120px]">
              {`${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Unnamed User'}
            </span>
          </div>
        );
      }

      // Multiple selections - compact
      const firstUser = selectedUsers[0];
      const additionalCount = selectedUsers.length - 1 + (includeUnassigned ? 1 : 0);

      return (
        <div className="flex items-center gap-2">
          {firstUser ? (
            <UserAvatar
              userId={firstUser.user_id}
              userName={`${firstUser.first_name || ''} ${firstUser.last_name || ''}`.trim()}
              avatarUrl={avatarUrls[firstUser.user_id] || null}
              size="xs"
            />
          ) : (
            <UserMinus className="w-4 h-4 text-gray-500" />
          )}
          <span className="text-sm">
            {firstUser
              ? `${firstUser.first_name || ''} ${firstUser.last_name || ''}`.trim().split(' ')[0]
              : 'Unassigned'}
            {additionalCount > 0 && ` +${additionalCount}`}
          </span>
        </div>
      );
    }

    // Standard pills display - allow wrapping, button expands to fit
    return (
      <div className="flex items-center gap-2 flex-wrap flex-1">
        {includeUnassigned && (
          <div className="flex items-center gap-1 bg-gray-100 rounded-full pl-2 pr-2 py-1">
            <UserMinus className="w-3 h-3 text-gray-500" />
            <span className="text-sm">Unassigned</span>
            <div
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onUnassignedChange?.(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  e.preventDefault();
                  onUnassignedChange?.(false);
                }
              }}
              className="ml-1 p-0.5 hover:bg-gray-200 rounded-full cursor-pointer"
            >
              <X className="w-3 h-3" />
            </div>
          </div>
        )}
        {selectedUsers.map((user): React.JSX.Element => (
          <div
            key={user.user_id}
            className="flex items-center gap-1 bg-gray-100 rounded-full pl-1 pr-2 py-1"
          >
            <div
              className={`flex items-center gap-1 ${onUserClick ? 'cursor-pointer hover:opacity-80' : ''}`}
              onClick={(e) => {
                if (onUserClick) {
                  e.stopPropagation();
                  onUserClick(user.user_id);
                }
              }}
            >
              <UserAvatar
                userId={user.user_id}
                userName={`${user.first_name || ''} ${user.last_name || ''}`.trim()}
                avatarUrl={avatarUrls[user.user_id] || null}
                size={size === 'sm' ? 'sm' : 'md'}
              />
              <span>{`${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Unnamed User'}</span>
            </div>
            <div
              role="button"
              tabIndex={0}
              onClick={(e) => removeUser(user.user_id, e)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  e.preventDefault();
                  removeUser(user.user_id);
                }
              }}
              className="ml-1 p-1 hover:bg-gray-200 rounded-full cursor-pointer"
            >
              <X className="w-3 h-3" />
            </div>
          </div>
        ))}
      </div>
    );
  };

  const dropdownContent = (
    <div
      ref={dropdownRef}
      className="fixed z-50 pointer-events-auto"
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
        {showSearch && (
          <div className="p-2 border-b border-gray-200">
            <div className="relative">
              <Input
                ref={searchInputRef}
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
        )}

        {/* Unassigned option (filter mode only) */}
        {filterMode && (
          <div
            className="px-3 py-2 border-b border-gray-200 flex items-center gap-3 cursor-pointer hover:bg-gray-50"
            onClick={handleUnassignedToggle}
          >
            <Checkbox
              id="unassigned-checkbox"
              checked={includeUnassigned}
              onChange={handleUnassignedToggle}
            />
            <UserMinus className="w-4 h-4 text-gray-400" />
            <span className="text-sm">Unassigned</span>
          </div>
        )}

        {/* User List */}
        <div
          className="overflow-y-auto p-1 pointer-events-auto"
          style={{
            maxHeight: '320px',
            overscrollBehavior: 'contain',
            scrollbarWidth: 'thin',
            scrollbarColor: '#d1d5db #f3f4f6'
          }}
          onWheel={(e) => {
            // Ensure scroll works in modal dialogs by stopping propagation
            const target = e.currentTarget;
            const { scrollTop, scrollHeight, clientHeight } = target;
            const isScrollingUp = e.deltaY < 0;
            const isScrollingDown = e.deltaY > 0;
            const isAtTop = scrollTop === 0;
            const isAtBottom = scrollTop + clientHeight >= scrollHeight - 1;

            // Only stop propagation if we can scroll in that direction
            if ((isScrollingUp && !isAtTop) || (isScrollingDown && !isAtBottom)) {
              e.stopPropagation();
            } else if (isAtTop && isScrollingUp) {
              e.preventDefault();
              e.stopPropagation();
            } else if (isAtBottom && isScrollingDown) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
        >
          {loading ? (
            <div className="px-3 py-2 text-sm text-gray-500">Loading users...</div>
          ) : error ? (
            <div className="px-3 py-2 text-sm text-red-500">Error loading users</div>
          ) : filteredUsers.length === 0 ? (
            <div className="px-3 py-2 text-sm text-gray-500">
              {searchQuery ? 'No users found' : 'No users available'}
            </div>
          ) : (
            filteredUsers.map((user): React.JSX.Element => {
              const isSelected = values.includes(user.user_id);
              const userName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Unnamed User';

              return (
                <div
                  key={user.user_id}
                  className={`
                    relative flex items-center px-3 py-2 text-sm rounded cursor-pointer
                    hover:bg-gray-100 ${isSelected ? 'bg-gray-50' : ''}
                  `}
                  onClick={() => handleUserToggle(user.user_id)}
                >
                  <div onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      id={`user-${user.user_id}`}
                      checked={isSelected}
                      onChange={() => handleUserToggle(user.user_id)}
                      className="mr-3"
                    />
                  </div>
                  <UserAvatar
                    userId={user.user_id}
                    userName={userName}
                    avatarUrl={avatarUrls[user.user_id] || null}
                    size="sm"
                  />
                  <span className="ml-2">{userName}</span>
                </div>
              );
            })
          )}
        </div>

        {/* Clear all button */}
        {(values.length > 0 || includeUnassigned) && (
          <div className="border-t border-gray-200 p-2">
            <Button
              id={`${id || 'multi-user-picker'}-clear-all`}
              variant="ghost"
              onClick={handleClearAll}
              className="w-full text-sm text-gray-600 hover:text-gray-900 py-1"
            >
              Clear all
            </Button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="relative" ref={containerRef}>
      {label && <h5 className="font-bold mb-1">{label}</h5>}

      <Button
        ref={buttonRef}
        id={id || 'multi-user-picker'}
        data-automation-id={dataAutomationId}
        type="button"
        variant="outline"
        onClick={toggleDropdown}
        disabled={disabled}
        className={`inline-flex items-start justify-between min-h-[38px] h-auto w-full py-2 ${compactDisplay ? 'min-w-[150px]' : ''}`}
      >
        {renderTriggerContent()}
        <ChevronDown className="w-4 h-4 text-gray-500 ml-2 flex-shrink-0" />
      </Button>

      {isOpen && typeof document !== 'undefined' && createPortal(
        dropdownContent,
        document.body
      )}
    </div>
  );
};

export default MultiUserPicker;
