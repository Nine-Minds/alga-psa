'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Pencil, Check, X } from 'lucide-react';
import {
  getTeamById,
  updateTeam,
  removeUserFromTeam,
  assignManagerToTeam,
  addUserToTeam,
  uploadTeamAvatar,
  deleteTeamAvatar,
  getTeamAvatarUrlsBatchAction
} from '@alga-psa/teams/actions';
import { getAllUsers } from '@alga-psa/users/actions';
import { ITeam, ITeamMember, IUserWithRoles, ColumnDefinition } from '@alga-psa/types';
import UserPicker from '@alga-psa/ui/components/UserPicker';
import UserAvatar from '@alga-psa/ui/components/UserAvatar';
import { getUserAvatarUrlAction, getUserAvatarUrlsBatchAction } from '@alga-psa/users/actions';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Separator } from '@alga-psa/ui/components/Separator';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import EntityImageUpload from '@alga-psa/ui/components/EntityImageUpload';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';

interface TeamDetailsProps {
  teamId: string;
  onUpdate: (updatedTeam: ITeam | null) => void;
}

const TeamDetails: React.FC<TeamDetailsProps> = ({ teamId, onUpdate }): React.JSX.Element => {
  const [team, setTeam] = useState<ITeam | null>(null);
  const [teamName, setTeamName] = useState('');
  const [allUsers, setAllUsers] = useState<IUserWithRoles[]>([]);
  const [selectedManagerId, setSelectedManagerId] = useState<string | undefined>(undefined);
  const [selectedUserId, setSelectedUserId] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userAvatars, setUserAvatars] = useState<Record<string, string | null>>({});
  const [teamAvatarUrl, setTeamAvatarUrl] = useState<string | null>(null);
  const [isEditingName, setIsEditingName] = useState(false);

  useEffect(() => {
    fetchTeamDetails();
    fetchAllUsers();
  }, [teamId]);

  // Fetch avatar URLs for users
  useEffect(() => {
    // Skip if we don't have the necessary data yet
    if (loading || !team || allUsers.length === 0) {
      return;
    }

    const fetchAvatarUrls = async () => {
      // Collect all user IDs (manager + members)
      const userIds = new Set<string>();

      if (team.manager_id) {
        userIds.add(team.manager_id);
      }

      team.members.forEach(member => {
        userIds.add(member.user_id);
      });

      const usersToFetch = Array.from(userIds).filter(
        userId => userAvatars[userId] === undefined
      );

      if (usersToFetch.length === 0) {
        return;
      }

      const avatarPromises = usersToFetch.map(async (userId) => {
        try {
          const user = allUsers.find(u => u.user_id === userId) ||
                      team.members.find(m => m.user_id === userId);
          if (!user) return { userId, avatarUrl: null };

          if (!user.tenant) {
            return { userId, avatarUrl: null };
          }

          const avatarUrl = await getUserAvatarUrlAction(userId, user.tenant);
          return { userId, avatarUrl };
        } catch (error) {
          console.error(`Error fetching avatar for user ${userId}:`, error);
          return { userId, avatarUrl: null };
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

    fetchAvatarUrls();
  }, [team?.team_id, loading]); // Only re-run when team ID changes or loading state changes

  const fetchTeamAvatarUrl = async (fetchedTeam: ITeam): Promise<void> => {
    if (!fetchedTeam.tenant) return;
    try {
      const avatarUrlsMap = await getTeamAvatarUrlsBatchAction([fetchedTeam.team_id], fetchedTeam.tenant);
      let url: string | null = null;
      if (avatarUrlsMap instanceof Map) {
        url = avatarUrlsMap.get(fetchedTeam.team_id) ?? null;
      } else {
        url = (avatarUrlsMap as Record<string, string | null>)[fetchedTeam.team_id] ?? null;
      }
      setTeamAvatarUrl(url);
    } catch (err) {
      console.error('Error fetching team avatar:', err);
      setTeamAvatarUrl(null);
    }
  };

  const fetchTeamDetails = async (): Promise<void> => {
    try {
      setLoading(true);
      const fetchedTeam = await getTeamById(teamId);
      setTeam(fetchedTeam);
      setTeamName(fetchedTeam.team_name);
      setSelectedManagerId(fetchedTeam.manager_id || undefined);
      setError(null);
      onUpdate(fetchedTeam);
      void fetchTeamAvatarUrl(fetchedTeam);
    } catch (err) {
      console.error('Error fetching team details:', err);
      setError('Failed to fetch team details');
      onUpdate(null);
    } finally {
      setLoading(false);
    }
  };

  const fetchAllUsers = async (): Promise<void> => {
    try {
      const users = await getAllUsers();
      setAllUsers(users);
    } catch (err) {
      console.error('Error fetching users:', err);
      setError('Failed to fetch users');
    }
  };

  const handleNameSubmit = useCallback(async () => {
    if (team && teamName.trim() !== '' && teamName.trim() !== team.team_name) {
      try {
        const updatedTeam = await updateTeam(team.team_id, { team_name: teamName.trim() });
        setTeam(updatedTeam);
        onUpdate(updatedTeam);
        setError(null);
      } catch (err) {
        console.error('Error updating team name:', err);
        setError('Failed to update team name');
      }
    }
    setIsEditingName(false);
  }, [team, teamName, onUpdate]);

  const handleNameCancel = useCallback(() => {
    setTeamName(team?.team_name || '');
    setIsEditingName(false);
  }, [team?.team_name]);

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleNameCancel();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      void handleNameSubmit();
    }
  };

  const handleRemoveMember = async (userId: string): Promise<void> => {
    if (team) {
      try {
        const updatedTeam = await removeUserFromTeam(team.team_id, userId);
        setTeam(updatedTeam);
        onUpdate(updatedTeam);
        setError(null);
      } catch (err) {
        console.error('Error removing team member:', err);
        setError('Failed to remove team member');
      }
    }
  };

  const handleAssignManager = async (): Promise<void> => {
    if (team && selectedManagerId) {
      try {
        const updatedTeam = await assignManagerToTeam(team.team_id, selectedManagerId);
        setTeam(updatedTeam);
        onUpdate(updatedTeam);
        setError(null);
      } catch (err) {
        console.error('Error assigning manager:', err);
        setError('Failed to assign manager');
      }
    }
  };

  const handleAddMember = async (): Promise<void> => {
    if (team && selectedUserId) {
      try {
        const updatedTeam = await addUserToTeam(team.team_id, selectedUserId);
        setTeam(updatedTeam);
        onUpdate(updatedTeam);
        setSelectedUserId(undefined);
        setError(null);
      } catch (err) {
        console.error('Error adding team member:', err);
        setError('Failed to add team member');
      }
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <LoadingIndicator
          layout="stacked"
          text="Loading team details..."
          spinnerProps={{ size: 'md' }}
        />
      </div>
    );
  }

  if (!team) {
    return <div className="text-text-600">No team found</div>;
  }

  const managerUser = allUsers.find(u => u.user_id === team.manager_id);
  const managerName = managerUser
    ? `${managerUser.first_name} ${managerUser.last_name}`
    : null;

  const memberColumns: ColumnDefinition<ITeamMember>[] = [
    {
      title: 'Member',
      dataIndex: 'user_id',
      render: (_value: unknown, member: ITeamMember) => (
        <div className="flex items-center gap-3">
          <UserAvatar
            userId={member.user_id}
            userName={`${member.first_name || ''} ${member.last_name || ''}`}
            avatarUrl={userAvatars[member.user_id] || null}
            size="sm"
          />
          <span className="font-medium text-text-800">
            {member.first_name} {member.last_name}
          </span>
        </div>
      ),
    },
    {
      title: 'Role',
      dataIndex: 'role',
      width: '120px',
      render: (_value: unknown, member: ITeamMember) => (
        <div className="flex items-center gap-2">
          {member.role === 'lead' && (
            <Badge variant="primary" size="sm">Lead</Badge>
          )}
          <span className="text-sm text-text-600">
            {member.roles.map((role): string => role.role_name).join(', ')}
          </span>
        </div>
      ),
    },
    {
      title: '',
      dataIndex: 'user_id',
      width: '80px',
      sortable: false,
      render: (_value: unknown, member: ITeamMember) => (
        <Button
          id={`remove-member-${member.user_id}-btn`}
          variant="ghost"
          size="sm"
          onClick={() => handleRemoveMember(member.user_id)}
          className="text-destructive hover:text-destructive"
        >
          Remove
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4 p-4 rounded-lg border border-border-200 bg-white">
      {error && <p className="text-accent-500">{error}</p>}

      {/* Header: Avatar + Name + Metadata */}
      <div className="flex items-start gap-4">
        <EntityImageUpload
          entityType="team"
          entityId={team.team_id}
          entityName={team.team_name}
          imageUrl={teamAvatarUrl}
          uploadAction={uploadTeamAvatar}
          deleteAction={deleteTeamAvatar}
          onImageChange={() => {
            if (team) void fetchTeamAvatarUrl(team);
          }}
          size="lg"
        />
        <div className="flex-1 min-w-0 pt-1">
          <div className="flex items-center gap-2 min-w-0">
            {isEditingName ? (
              <>
                <Input
                  id="team-name-input"
                  type="text"
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  onKeyDown={handleNameKeyDown}
                  autoFocus
                  className="text-xl font-bold flex-1"
                  containerClassName="mb-0 flex-1"
                  placeholder="Enter team name"
                />
                <Button
                  id="save-team-name-btn"
                  variant="default"
                  size="sm"
                  onClick={() => void handleNameSubmit()}
                  className="flex-shrink-0"
                  title="Save name"
                >
                  <Check className="w-4 h-4" />
                </Button>
                <Button
                  id="cancel-team-name-btn"
                  variant="outline"
                  size="sm"
                  onClick={handleNameCancel}
                  className="flex-shrink-0"
                  title="Cancel"
                >
                  <X className="w-4 h-4" />
                </Button>
              </>
            ) : (
              <>
                <h2 className="text-xl font-bold text-text-800 truncate flex-1">
                  {team.team_name}
                </h2>
                <button
                  onClick={() => setIsEditingName(true)}
                  className="p-1 hover:bg-gray-100 rounded-full transition-colors duration-200 flex-shrink-0"
                  title="Edit name"
                >
                  <Pencil className="w-4 h-4 text-gray-500" />
                </button>
              </>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {team.members.length} member{team.members.length !== 1 ? 's' : ''}
            {managerName && <> · Lead: {managerName}</>}
          </p>
        </div>
      </div>

      <Separator />

      {/* Team Lead */}
      <div>
        <Label className="mb-1">Team Lead</Label>
        <div className="flex gap-2">
          <UserPicker
            value={selectedManagerId || ''}
            onValueChange={setSelectedManagerId}
            users={allUsers}
            getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
            labelStyle="none"
            buttonWidth="fit"
            size="sm"
            placeholder="Select a manager"
            className="flex-1"
          />
          <Button
            id="assign-manager-btn"
            variant="outline"
            onClick={handleAssignManager}
            disabled={!selectedManagerId}
          >
            Assign
          </Button>
        </div>
      </div>

      <Separator />

      {/* Add Team Member */}
      <div>
        <Label className="mb-1">Add Team Member</Label>
        <div className="flex gap-2">
          <UserPicker
            value={selectedUserId || ''}
            onValueChange={setSelectedUserId}
            users={allUsers.filter(user => !team.members.some(member => member.user_id === user.user_id))}
            getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
            labelStyle="none"
            buttonWidth="fit"
            size="sm"
            placeholder="Select a user"
            className="flex-1"
          />
          <Button
            id="add-member-btn"
            variant="outline"
            onClick={handleAddMember}
            disabled={!selectedUserId}
          >
            Add
          </Button>
        </div>
      </div>

      <Separator />

      {/* Team Members */}
      <div>
        <Label className="mb-2">Team Members</Label>
        <DataTable
          columns={memberColumns}
          data={team.members}
          pagination={true}
          pageSize={10}
        />
      </div>
    </div>
  );
};

export default TeamDetails;
