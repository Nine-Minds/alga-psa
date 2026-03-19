'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Pencil, Check, X } from 'lucide-react';
import {
  getTeamById,
  updateTeam,
  saveTeamChanges,
  uploadTeamAvatar,
  deleteTeamAvatar,
  getTeamAvatarUrlsBatchAction
} from '@alga-psa/teams/actions';
import { getAllUsers, getUserAvatarUrlsBatchAction } from '@alga-psa/user-composition/actions';
import { ITeam, ITeamMember, IUserWithRoles, ColumnDefinition } from '@alga-psa/types';
import UserPicker from '@alga-psa/ui/components/UserPicker';
import UserAvatar from '@alga-psa/ui/components/UserAvatar';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Separator } from '@alga-psa/ui/components/Separator';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Card } from '@alga-psa/ui/components/Card';
import EntityImageUpload from '@alga-psa/ui/components/EntityImageUpload';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface TeamDetailsProps {
  teamId: string;
  onUpdate: (updatedTeam: ITeam | null) => void;
}

function parseAvatarUrlsMap(avatarUrls: Map<string, string | null> | Record<string, string | null>): Record<string, string | null> {
  const result: Record<string, string | null> = {};
  if (avatarUrls instanceof Map) {
    avatarUrls.forEach((url, id) => { result[id] = url; });
  } else {
    Object.assign(result, avatarUrls);
  }
  return result;
}

const TeamDetails: React.FC<TeamDetailsProps> = ({ teamId, onUpdate }): React.JSX.Element => {
  const { t } = useTranslation('msp/settings');
  const [team, setTeam] = useState<ITeam | null>(null);
  const [teamName, setTeamName] = useState('');
  const [allUsers, setAllUsers] = useState<IUserWithRoles[]>([]);
  const [selectedManagerId, setSelectedManagerId] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userAvatars, setUserAvatars] = useState<Record<string, string | null>>({});
  const [teamAvatarUrl, setTeamAvatarUrl] = useState<string | null>(null);
  const [isEditingName, setIsEditingName] = useState(false);

  // Pending changes state
  const [pendingAdditions, setPendingAdditions] = useState<string[]>([]);
  const [pendingRemovals, setPendingRemovals] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);

  // Derived: check for unsaved changes
  const managerChanged = team ? selectedManagerId !== (team.manager_id || undefined) : false;
  const hasUnsavedChanges = managerChanged || pendingAdditions.length > 0 || pendingRemovals.size > 0;

  useEffect(() => {
    fetchTeamDetails();
    fetchAllUsers();
    setPendingAdditions([]);
    setPendingRemovals(new Set());
  }, [teamId]);

  const fetchTeamAvatarUrl = async (fetchedTeam: ITeam): Promise<void> => {
    if (!fetchedTeam.tenant) return;
    try {
      const avatarUrlsMap = await getTeamAvatarUrlsBatchAction([fetchedTeam.team_id], fetchedTeam.tenant);
      const urls = parseAvatarUrlsMap(avatarUrlsMap);
      setTeamAvatarUrl(urls[fetchedTeam.team_id] ?? null);
    } catch (err) {
      console.error('Error fetching team avatar:', err);
      setTeamAvatarUrl(null);
    }
  };

  const fetchTeamDetails = async (): Promise<void> => {
    try {
      setLoading(true);
      const fetchedTeam = await getTeamById(teamId);

      // Batch fetch user avatars alongside team details to prevent flashing
      const userIds = new Set<string>();
      if (fetchedTeam.manager_id) userIds.add(fetchedTeam.manager_id);
      fetchedTeam.members.forEach(m => userIds.add(m.user_id));

      const newUserIds = Array.from(userIds).filter(id => userAvatars[id] === undefined);
      if (newUserIds.length > 0 && fetchedTeam.tenant) {
        try {
          const avatarUrls = await getUserAvatarUrlsBatchAction(newUserIds, fetchedTeam.tenant);
          const urlsRecord = parseAvatarUrlsMap(avatarUrls);
          setUserAvatars(prev => ({ ...prev, ...urlsRecord }));
        } catch (err) {
          console.error('Error batch fetching user avatars:', err);
        }
      }

      setTeam(fetchedTeam);
      setTeamName(fetchedTeam.team_name);
      setSelectedManagerId(fetchedTeam.manager_id || undefined);
      setError(null);
      onUpdate(fetchedTeam);
      void fetchTeamAvatarUrl(fetchedTeam);
    } catch (err) {
      console.error('Error fetching team details:', err);
      setError(t('teams.messages.error.loadFailed'));
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
      setError(t('teams.messages.error.fetchUsers'));
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

  // Pending change handlers
  const handlePendingAddMember = (userId: string): void => {
    if (!userId) return;
    // If this user was pending removal, undo the removal instead
    if (pendingRemovals.has(userId)) {
      setPendingRemovals(prev => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
      return;
    }
    if (!pendingAdditions.includes(userId)) {
      setPendingAdditions(prev => [...prev, userId]);

      // Fetch avatar for the newly selected user if not cached
      if (userAvatars[userId] === undefined && team?.tenant) {
        getUserAvatarUrlsBatchAction([userId], team.tenant)
          .then(avatarUrls => {
            const urlsRecord = parseAvatarUrlsMap(avatarUrls);
            setUserAvatars(prev => ({ ...prev, ...urlsRecord }));
          })
          .catch(() => {});
      }
    }
  };

  const handlePendingRemoveMember = (userId: string): void => {
    if (pendingAdditions.includes(userId)) {
      setPendingAdditions(prev => prev.filter(id => id !== userId));
    } else {
      setPendingRemovals(prev => new Set(prev).add(userId));
    }
  };

  const handleSaveAll = async (): Promise<void> => {
    if (!team) return;
    setIsSaving(true);
    setError(null);
    try {
      await saveTeamChanges(team.team_id, {
        managerId: managerChanged && selectedManagerId ? selectedManagerId : undefined,
        removeUserIds: Array.from(pendingRemovals),
        addUserIds: pendingAdditions,
      });
      setPendingAdditions([]);
      setPendingRemovals(new Set());
      await fetchTeamDetails();
    } catch (err) {
      console.error('Error saving team changes:', err);
      setError('Failed to save changes. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDiscardChanges = (): void => {
    setPendingAdditions([]);
    setPendingRemovals(new Set());
    setSelectedManagerId(team?.manager_id || undefined);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <LoadingIndicator
          layout="stacked"
          text={t('teams.details.loading')}
          spinnerProps={{ size: 'md' }}
        />
      </div>
    );
  }

  if (!team) {
    return <div className="text-text-600">{t('teams.details.notFound')}</div>;
  }

  const managerUser = allUsers.find(u => u.user_id === selectedManagerId);
  const managerName = managerUser
    ? `${managerUser.first_name} ${managerUser.last_name}`
    : null;

  // Build display members: existing (minus removals) + pending additions
  const displayMembers: ITeamMember[] = [
    ...team.members.filter(m => !pendingRemovals.has(m.user_id)),
    ...pendingAdditions.map(userId => {
      const user = allUsers.find(u => u.user_id === userId);
      return {
        user_id: userId,
        first_name: user?.first_name || '',
        last_name: user?.last_name || '',
        email: user?.email || '',
        role: 'member' as const,
        roles: user?.roles || [],
      } as ITeamMember;
    }),
  ];

  // Filter out inactive users for all pickers
  const activeUsers = allUsers.filter(user => !user.is_inactive);

  // Users available for "Add Member": active, not current members (unless pending removal), not pending additions
  const availableUsersForAdd = activeUsers.filter(user =>
    !team.members.some(m => m.user_id === user.user_id && !pendingRemovals.has(m.user_id)) &&
    !pendingAdditions.includes(user.user_id)
  );

  const memberColumns: ColumnDefinition<ITeamMember>[] = [
    {
      title: t('teams.details.table.member'),
      dataIndex: 'user_id',
      render: (_value: unknown, member: ITeamMember) => {
        const isPending = pendingAdditions.includes(member.user_id);
        return (
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
            {isPending && (
              <Badge variant="outline" size="sm">{t('teams.details.badge.new')}</Badge>
            )}
          </div>
        );
      },
    },
    {
      title: t('teams.details.table.role'),
      dataIndex: 'role',
      width: '120px',
      render: (_value: unknown, member: ITeamMember) => {
        // Show Lead badge based on pending manager selection, not just server data
        const isLead = selectedManagerId
          ? member.user_id === selectedManagerId
          : member.role === 'lead';
        return (
          <div className="flex items-center gap-2">
            {isLead && (
              <Badge variant="primary" size="sm">{t('teams.details.badge.lead')}</Badge>
            )}
            <span className="text-sm text-text-600">
              {member.roles.map((role): string => role.role_name).join(', ')}
            </span>
          </div>
        );
      },
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
          onClick={() => handlePendingRemoveMember(member.user_id)}
          className="text-destructive hover:text-destructive"
        >
          {t('teams.details.actions.remove')}
        </Button>
      ),
    },
  ];

  return (
    <Card className="space-y-4 p-4">
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
                  placeholder={t('teams.details.placeholders.teamName')}
                />
                <Button
                  id="save-team-name-btn"
                  variant="default"
                  size="sm"
                  onClick={() => void handleNameSubmit()}
                  className="flex-shrink-0"
                  title={t('teams.details.actions.saveName')}
                >
                  <Check className="w-4 h-4" />
                </Button>
                <Button
                  id="cancel-team-name-btn"
                  variant="outline"
                  size="sm"
                  onClick={handleNameCancel}
                  className="flex-shrink-0"
                  title={t('teams.details.actions.cancel')}
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
                  title={t('teams.details.actions.editName')}
                >
                  <Pencil className="w-4 h-4 text-gray-500" />
                </button>
              </>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {t('teams.details.memberCount', { count: displayMembers.length })}
            {managerName && <> &middot; {t('teams.details.leadName', { name: managerName })}</>}
          </p>
        </div>
      </div>

      <Separator />

      {/* Team Lead + Add Member on one row */}
      <div className="flex gap-4">
        <div>
          <Label className="mb-2 block">{t('teams.details.fields.teamLead')}</Label>
          <UserPicker
            id="team-lead-picker"
            value={selectedManagerId || ''}
            onValueChange={(value) => setSelectedManagerId(value || undefined)}
            users={activeUsers}
            getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
            labelStyle="none"
            buttonWidth="fit"
            size="sm"
            placeholder={t('teams.details.placeholders.selectTeamLead')}
          />
        </div>
        <div>
          <Label className="mb-2 block">{t('teams.details.fields.addMember')}</Label>
          <UserPicker
            id="add-member-picker"
            value=""
            onValueChange={handlePendingAddMember}
            users={availableUsersForAdd}
            getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
            labelStyle="none"
            buttonWidth="fit"
            size="sm"
            placeholder={t('teams.details.placeholders.selectUserToAdd')}
          />
        </div>
      </div>

      {/* Unsaved changes alert */}
      {hasUnsavedChanges && (
        <Alert variant="info" id="unsaved-changes-alert">
          <AlertDescription className="flex items-center justify-between">
            <span>{t('teams.details.alert.unsavedChanges')}</span>
            <div className="flex gap-2">
              <Button
                id="discard-changes-btn"
                variant="outline"
                size="sm"
                onClick={handleDiscardChanges}
                disabled={isSaving}
              >
                {t('teams.details.actions.discard')}
              </Button>
              <Button
                id="save-team-changes-btn"
                size="sm"
                onClick={() => void handleSaveAll()}
                disabled={isSaving}
              >
                {isSaving ? t('experimentalFeatures.actions.saving') : t('teams.details.actions.saveChanges')}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      <Separator />

      {/* Team Members */}
      <div>
        <Label className="mb-2">{t('teams.details.table.teamMembers')}</Label>
        <DataTable
          columns={memberColumns}
          data={displayMembers}
          pagination={true}
          pageSize={10}
        />
      </div>
    </Card>
  );
};

export default TeamDetails;
