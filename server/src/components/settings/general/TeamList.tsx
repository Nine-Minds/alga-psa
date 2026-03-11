'use client';

import React, { useState, useEffect } from 'react';
import { createTeam, deleteTeam } from '@alga-psa/teams/actions';
import { getTeamAvatarUrlsBatchAction } from '@alga-psa/teams/actions';
import { getAllUsers, getUserAvatarUrlsBatchAction } from '@alga-psa/user-composition/actions';
import { DeletionValidationResult, ITeam, IUser, IUserWithRoles } from '@alga-psa/types';
import UserPicker from '@alga-psa/ui/components/UserPicker';
import TeamAvatar from '@alga-psa/ui/components/TeamAvatar';
import { DeleteEntityDialog } from '@alga-psa/ui';
import { Input } from '@alga-psa/ui/components/Input';
import { Button } from '@alga-psa/ui/components/Button';
import { Card } from '@alga-psa/ui/components/Card';
import { preCheckDeletion } from '@alga-psa/auth/lib/preCheckDeletion';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface TeamListProps {
  teams: ITeam[];
  onSelectTeam: (team: ITeam | null, deleted?: boolean) => void;
}

const TeamList: React.FC<TeamListProps> = ({ teams, onSelectTeam }) => {
  const { t } = useTranslation('msp/settings');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [selectedManagerId, setSelectedManagerId] = useState<string>('');
  const [allUsers, setAllUsers] = useState<IUserWithRoles[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [teamToDelete, setTeamToDelete] = useState<ITeam | null>(null);
  const [deleteValidation, setDeleteValidation] = useState<DeletionValidationResult | null>(null);
  const [isDeleteValidating, setIsDeleteValidating] = useState(false);
  const [isDeleteProcessing, setIsDeleteProcessing] = useState(false);
  const [teamAvatars, setTeamAvatars] = useState<Record<string, string | null>>({});

  useEffect(() => {
    fetchAllUsers();
  }, []);

  useEffect(() => {
    if (teams.length === 0) return;
    const teamIds = teams.map(t => t.team_id);
    const tenant = teams[0]?.tenant;
    if (!tenant) return;

    getTeamAvatarUrlsBatchAction(teamIds, tenant)
      .then((avatarUrlsMap) => {
        const urlsRecord: Record<string, string | null> = {};
        if (avatarUrlsMap instanceof Map) {
          avatarUrlsMap.forEach((url, id) => { urlsRecord[id] = url; });
        } else {
          Object.entries(avatarUrlsMap as Record<string, string | null>).forEach(([id, url]) => { urlsRecord[id] = url; });
        }
        setTeamAvatars(urlsRecord);
      })
      .catch((err) => console.error('Error fetching team avatars:', err));
  }, [teams]);

  const fetchAllUsers = async (): Promise<void> => {
    try {
      const users = await getAllUsers();
      setAllUsers(users);
    } catch (err) {
      console.error('Error fetching users:', err);
      setError(t('teams.messages.error.fetchUsers'));
    }
  };

  const handleCreateTeam = async (): Promise<void> => {
    if (newTeamName.trim() && selectedManagerId) {
      try {
        const newTeam: ITeam = {
          team_name: newTeamName,
          members: [],
          manager_id: selectedManagerId,
          team_id: '',
        };
        const createdTeam = await createTeam(newTeam);
        onSelectTeam(createdTeam, false);
        setNewTeamName('');
        setSelectedManagerId('');
        setShowAddForm(false);
        setError(null);
      } catch (err: unknown) {
        setError(t('teams.messages.error.createFailed', { error: err instanceof Error ? err.message : String(err) }));
        console.error('Error creating team:', err);
      }
    }
  };

  const resetDeleteState = () => {
    setTeamToDelete(null);
    setDeleteValidation(null);
  };

  const runDeleteValidation = async (teamId: string) => {
    setIsDeleteValidating(true);
    try {
      const result = await preCheckDeletion('team', teamId);
      setDeleteValidation(result);
    } catch (err) {
      console.error('Error validating team deletion:', err);
      setDeleteValidation({
        canDelete: false,
        code: 'VALIDATION_FAILED',
        message: 'Failed to validate team deletion.',
        dependencies: [],
        alternatives: []
      });
    } finally {
      setIsDeleteValidating(false);
    }
  };

  const handleDeleteTeam = async (team: ITeam): Promise<void> => {
    setTeamToDelete(team);
    void runDeleteValidation(team.team_id);
  };

  const confirmDelete = async (): Promise<void> => {
    if (!teamToDelete) {
      return;
    }

    setIsDeleteProcessing(true);
    try {
      const result = await deleteTeam(teamToDelete.team_id);
      if (!result.success) {
        setDeleteValidation(result);
        return;
      }
      onSelectTeam(teamToDelete, true);
      setError(null);
      resetDeleteState();
    } catch (err: unknown) {
      setError(t('teams.messages.error.deleteFailed'));
      console.error('Error deleting team:', err);
    } finally {
      setIsDeleteProcessing(false);
    }
  };

  return (
    <Card className="p-4 min-w-0">
      {error && <p className="text-accent-500 mb-4 break-words">{error}</p>}
      {!showAddForm ? (
        <Button
          id="add-new-team-btn"
          onClick={() => setShowAddForm(true)}
          className="w-auto mb-4"
        >
          {t('teams.list.addNewTeam')}
        </Button>
      ) : (
        <div className="mb-4 space-y-2">
          <Input
            type="text"
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
            placeholder={t('teams.list.placeholder')}
          />
          <UserPicker
            value={selectedManagerId}
            onValueChange={setSelectedManagerId}
            users={allUsers}
            getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
            buttonWidth="full"
            size="sm"
            placeholder={t('teams.list.selectManager')}
          />
          <div className="flex gap-2">
            <Button
              id="create-team-btn"
              onClick={handleCreateTeam}
              disabled={!newTeamName.trim() || !selectedManagerId}
              className="flex-1"
            >
              {t('teams.list.createTeam')}
            </Button>
            <Button
              id="cancel-create-team-btn"
              variant="outline"
              onClick={() => {
                setShowAddForm(false);
                setNewTeamName('');
                setSelectedManagerId('');
              }}
            >
              {t('teams.list.cancel')}
            </Button>
          </div>
        </div>
      )}
      <h3 className="text-lg font-semibold mb-2 text-text-800">{t('teams.list.title')}</h3>
      <ul className="space-y-1">
        {teams.map((team: ITeam): React.ReactNode => (
          <li key={team.team_id} className="flex items-center justify-between gap-2 p-2 rounded hover:bg-border-50 min-w-0">
            <button
              onClick={() => onSelectTeam(team)}
              className="flex items-center gap-2 text-left font-medium text-text-700 hover:text-primary-500 transition-colors flex-1 min-w-0"
              title={team.team_name}
            >
              <TeamAvatar
                teamId={team.team_id}
                teamName={team.team_name}
                avatarUrl={teamAvatars[team.team_id] ?? null}
                size="sm"
              />
              <span className="truncate">{team.team_name}</span>
            </button>
            <Button
              id={`delete-team-${team.team_id}-btn`}
              variant="ghost"
              size="sm"
              onClick={() => handleDeleteTeam(team)}
              className="text-destructive hover:text-destructive flex-shrink-0"
            >
              {t('teams.list.delete')}
            </Button>
          </li>
        ))}
      </ul>

      <DeleteEntityDialog
        id="delete-team-dialog"
        isOpen={!!teamToDelete}
        onClose={resetDeleteState}
        onConfirmDelete={confirmDelete}
        entityName={teamToDelete?.team_name || 'this team'}
        validationResult={deleteValidation}
        isValidating={isDeleteValidating}
        isDeleting={isDeleteProcessing}
      />
    </Card>
  );
};

export default TeamList;
