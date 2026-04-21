'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { IUser, ITeam } from '@alga-psa/types';
import { ChevronDown, Search } from 'lucide-react';
import UserAvatar from './UserAvatar';
import TeamAvatar from './TeamAvatar';
import { AutomationProps, ButtonComponent, ContainerComponent } from '../ui-reflection/types';
import { Input } from './Input';
import { Button } from './Button';
import { useAutomationIdAndRegister } from '../ui-reflection/useAutomationIdAndRegister';
import { useRegisterUIComponent } from '../ui-reflection/useRegisterUIComponent';
import { CommonActions } from '../ui-reflection/actionBuilders';
import type { GetUserAvatarUrlsBatch } from './UserPicker';

export type GetTeamAvatarUrlsBatch = (teamIds: string[], tenant: string) => Promise<Map<string, string | null>>;

interface UserAndTeamPickerProps {
  id?: string;
  label?: string;
  value: string;
  onValueChange: (value: string) => void;
  onTeamSelect?: (teamId: string) => void | Promise<void>;
  size?: 'xs' | 'sm' | 'lg';
  users: IUser[];
  teams: ITeam[];
  getUserAvatarUrlsBatch?: GetUserAvatarUrlsBatch;
  getTeamAvatarUrlsBatch?: GetTeamAvatarUrlsBatch;
  disabled?: boolean;
  className?: string;
  labelStyle?: 'bold' | 'medium' | 'normal' | 'none';
  buttonWidth?: 'fit' | 'full';
  placeholder?: string;
  userTypeFilter?: string | string[] | null;
  modal?: boolean;
}

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

const UserAndTeamPicker = ({
  id,
  label,
  value,
  onValueChange,
  onTeamSelect,
  size = 'sm',
  users,
  teams,
  getUserAvatarUrlsBatch,
  getTeamAvatarUrlsBatch,
  disabled,
  className,
  labelStyle = 'bold',
  buttonWidth = 'fit',
  placeholder = 'Not assigned',
  userTypeFilter = 'internal',
  modal = true,
  'data-automation-id': dataAutomationId,
  'data-automation-type': dataAutomationType = 'user-and-team-picker'
}: UserAndTeamPickerProps & AutomationProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [dropdownPosition, setDropdownPosition] = useState<'bottom' | 'top'>('bottom');
  const [dropdownCoords, setDropdownCoords] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 220 });
  const [avatarUrls, setAvatarUrls] = useState<Record<string, string | null>>({});
  const [teamAvatarUrls, setTeamAvatarUrls] = useState<Record<string, string | null>>({});
  const fetchedUserIdsRef = useRef<Set<string>>(new Set());
  const fetchedTeamIdsRef = useRef<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const pickerId = dataAutomationId || 'user-and-team-picker';

  const applyUserTypeFilter = (user: IUser) => {
    if (userTypeFilter === null) return true;
    if (Array.isArray(userTypeFilter)) return userTypeFilter.includes(user.user_type);
    return user.user_type === userTypeFilter;
  };

  const currentUser = users.find(user => user.user_id === value && applyUserTypeFilter(user));
  const currentTeam = teams.find(team => team.team_id === value);

  const filteredUsers = users
    .filter(user => applyUserTypeFilter(user) && !user.is_inactive)
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

  const teamEntries = teams || [];
  const filteredTeams = teamEntries
    .filter(team => {
      if (!searchQuery) return true;
      const leadName = getTeamLeadName(team).toLowerCase();
      return `${team.team_name || ''}`.toLowerCase().includes(searchQuery.toLowerCase()) || leadName.includes(searchQuery.toLowerCase());
    })
    .sort((a, b) => (a.team_name || '').localeCompare(b.team_name || ''));

  const selectedLabel = currentUser
    ? `${currentUser.first_name || ''} ${currentUser.last_name || ''}`.trim() || 'Unnamed User'
    : currentTeam
      ? currentTeam.team_name || 'Unnamed Team'
      : placeholder;
  const hasSelection = Boolean(currentUser || currentTeam);

  useEffect(() => {
    if (!getTeamAvatarUrlsBatch || teamEntries.length === 0) {
      return;
    }

    const tenant = currentTeam?.tenant || teamEntries[0]?.tenant;
    if (!tenant) {
      return;
    }

    const teamIds = new Set<string>();

    if (currentTeam?.team_id) {
      teamIds.add(currentTeam.team_id);
    }

    if (isOpen) {
      teamEntries.forEach((team) => teamIds.add(team.team_id));
    }

    const teamIdsToFetch = Array.from(teamIds).filter(
      (teamId) => !fetchedTeamIdsRef.current.has(teamId) && teamAvatarUrls[teamId] === undefined
    );

    if (teamIdsToFetch.length === 0) {
      return;
    }

    const fetchTeamAvatars = async () => {
      try {
        const map = await getTeamAvatarUrlsBatch(teamIdsToFetch, tenant);
        const record: Record<string, string | null> = {};
        map.forEach((value, key) => {
          record[key] = value;
        });
        teamIdsToFetch.forEach((teamId) => fetchedTeamIdsRef.current.add(teamId));
        setTeamAvatarUrls((prev) => ({ ...prev, ...record }));
      } catch (error) {
        console.error('Error fetching team avatar URLs:', error);
      }
    };

    void fetchTeamAvatars();
  }, [currentTeam, isOpen, teamEntries, getTeamAvatarUrlsBatch, teamAvatarUrls]);

  useRegisterUIComponent<ContainerComponent>({
    type: 'container',
    id: pickerId,
    label: label || 'User and Team Picker'
  }, 'client-details');

  const { automationIdProps: pickerProps, updateMetadata } = useAutomationIdAndRegister<ButtonComponent>({
    type: 'button',
    id: `${pickerId}-trigger`,
    label: `${label} - ${selectedLabel}`,
    disabled
  }, [CommonActions.click()]);

  useEffect(() => {
    if (updateMetadata) {
      updateMetadata({
        label,
        disabled
      });
    }
  }, [value, label, disabled, updateMetadata]);

  useEffect(() => {
    if (!users.length) return;
    if (!getUserAvatarUrlsBatch) return;

    const tenant = currentUser?.tenant || users[0]?.tenant;
    if (!tenant) return;

    const fetchAvatarUrls = async () => {
      const userIds = new Set<string>();

      if (currentUser?.user_id) {
        userIds.add(currentUser.user_id);
      }

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
      } catch (error) {
        console.error('Error fetching avatar URLs:', error);
      }
    };

    void fetchAvatarUrls();
  }, [currentUser, isOpen, filteredUsers, users, getUserAvatarUrlsBatch, avatarUrls]);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const isInsideDropdown = dropdownRef.current?.contains(target);
      const isInsideButton = buttonRef.current?.contains(target);

      if (!isInsideDropdown && !isInsideButton) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 10);
    }
  }, [isOpen]);

  const updateDropdownPosition = useCallback(() => {
    if (!buttonRef.current) return;

    const buttonRect = buttonRef.current.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const spaceBelow = viewportHeight - buttonRect.bottom;
    const spaceAbove = buttonRect.top;

    const baseHeight = 40 + 20 + 36;
    const itemsHeight = Math.min(filteredUsers.length + filteredTeams.length, 6) * 36;
    const estimatedDropdownHeight = baseHeight + itemsHeight + 10;

    const dropdownWidth = Math.max(buttonRect.width, 240);

    if (spaceBelow < 250 || spaceBelow < estimatedDropdownHeight) {
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
  }, [filteredUsers.length, filteredTeams.length]);

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

  const handleSelectTeam = async (teamId: string) => {
    if (onTeamSelect) {
      await onTeamSelect(teamId);
    }
    setIsOpen(false);
  };

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
      <div className="bg-white dark:bg-[rgb(var(--color-card))] rounded-md shadow-lg border border-gray-200 dark:border-[rgb(var(--color-border-200))] overflow-hidden w-full">
        <div className="p-2 border-b border-gray-200 dark:border-[rgb(var(--color-border-200))]">
          <div className="relative">
            <Input
              ref={searchInputRef}
              data-automation-id={dataAutomationId ? `${dataAutomationId}-search` : undefined}
              type="text"
              placeholder="Search users or teams..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-3 py-2 pl-9 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[rgb(var(--color-primary-500))] focus:border-transparent"
              autoComplete="off"
            />
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-gray-400" />
          </div>
        </div>

        <div
          className="overflow-y-auto p-1"
          style={{
            maxHeight: dropdownPosition === 'bottom' ? '240px' : '280px',
            overscrollBehavior: 'contain'
          }}
          onWheel={(e) => {
            e.stopPropagation();
          }}
        >
          <OptionButton
            id={`${pickerId}-option-unassigned`}
            label="Not assigned"
            onClick={() => handleSelectUser('unassigned')}
            className="relative flex items-center px-3 py-2 text-sm rounded text-gray-900 cursor-pointer hover:bg-gray-100 focus:bg-gray-100"
            parentId={pickerId}
          >
            Not assigned
          </OptionButton>

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

          {filteredTeams.length > 0 && (
            <div className="px-3 pt-2 pb-1 text-xs uppercase text-gray-500 tracking-wide">Teams</div>
          )}

          {filteredTeams.map((team): React.JSX.Element => {
            const leadName = getTeamLeadName(team);
            const memberCount = team.members?.length ?? 0;
            return (
              <OptionButton
                key={team.team_id}
                id={`${pickerId}-team-option-${team.team_id}`}
                label={team.team_name || 'Unnamed Team'}
                onClick={() => void handleSelectTeam(team.team_id)}
                className="relative flex items-center px-3 py-2 text-sm rounded cursor-pointer hover:bg-gray-100 focus:bg-gray-100 text-gray-900"
                parentId={pickerId}
              >
                <div className="flex items-center gap-2">
                  <TeamAvatar
                    teamId={team.team_id}
                    teamName={team.team_name || 'Unnamed Team'}
                    avatarUrl={teamAvatarUrls[team.team_id] ?? null}
                    size="sm"
                  />
                  <div className="flex flex-col">
                    <span>{team.team_name || 'Unnamed Team'}</span>
                    <span className="text-xs text-gray-500">{memberCount} members · Lead: {leadName}</span>
                  </div>
                </div>
              </OptionButton>
            );
          })}

          {filteredUsers.length === 0 && filteredTeams.length === 0 && searchQuery && (
            <div className="px-3 py-2 text-sm text-gray-500">No results found</div>
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

      <Button
        {...pickerProps}
        ref={buttonRef}
        id={id || pickerProps['data-automation-id'] || 'user-and-team-picker-button'}
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
          {currentTeam && (
            <TeamAvatar
              teamId={currentTeam.team_id}
              teamName={currentTeam.team_name || 'Unnamed Team'}
              avatarUrl={teamAvatarUrls[currentTeam.team_id] ?? null}
              size={size === 'xs' ? 'xs' : 'sm'}
            />
          )}
          {size !== 'xs' && (
            <span className={!hasSelection ? 'text-gray-400' : ''}>{selectedLabel}</span>
          )}
        </div>
        <ChevronDown className={size === 'xs' ? 'w-3 h-3 text-gray-500' : 'w-4 h-4 text-gray-500'} />
      </Button>

      {isOpen && typeof document !== 'undefined' && createPortal(
        dropdownContent,
        document.body
      )}
    </div>
  );
};

function getTeamLeadName(team: ITeam): string {
  if (team.members && team.members.length > 0) {
    const lead = team.members.find(member => member.role === 'lead' || member.user_id === team.manager_id);
    if (lead) {
      return `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Unknown Lead';
    }
  }

  if (team.manager_id) {
    const manager = team.members?.find(member => member.user_id === team.manager_id);
    if (manager) {
      return `${manager.first_name || ''} ${manager.last_name || ''}`.trim() || 'Unknown Lead';
    }
  }

  return 'Unknown Lead';
}

export default UserAndTeamPicker;
