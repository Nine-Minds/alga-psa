'use client';
import React, { useState, useEffect } from 'react';
import { createTeam, deleteTeam } from '@/lib/actions/team-actions/teamActions';
import { getAllUsers } from '@/lib/actions/user-actions/userActions';
import { ITeam, IUser } from '@/interfaces/auth.interfaces';
import CustomSelect from '@/components/ui/CustomSelect';
import { ConfirmationDialog } from '@/components/ui/ConfirmationDialog';

interface TeamListProps {
  teams: ITeam[];
  onSelectTeam: (team: ITeam | null, deleted?: boolean) => void;
}

const TeamList: React.FC<TeamListProps> = ({ teams, onSelectTeam }) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [selectedManagerId, setSelectedManagerId] = useState<string>('');
  const [allUsers, setAllUsers] = useState<IUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [teamToDelete, setTeamToDelete] = useState<ITeam | null>(null);

  useEffect(() => {
    fetchAllUsers();
  }, []);

  const fetchAllUsers = async (): Promise<void> => {
    try {
      const users = await getAllUsers();
      setAllUsers(users);
    } catch (err) {
      console.error('Error fetching users:', err);
      setError('Failed to fetch users');
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
        setError(`Failed to create team: ${err instanceof Error ? err.message : String(err)}`);
        console.error('Error creating team:', err);
      }
    }
  };

  const handleDeleteTeam = async (team: ITeam): Promise<void> => {
    setTeamToDelete(team);
  };

  const confirmDelete = async (): Promise<void> => {
    if (teamToDelete) {
      try {
        await deleteTeam(teamToDelete.team_id);
        onSelectTeam(teamToDelete, true);
        setError(null);
      } catch (err: unknown) {
        setError('Failed to delete team');
        console.error('Error deleting team:', err);
      } finally {
        setTeamToDelete(null);
      }
    }
  };

  return (
    <div className="p-4 rounded-lg border border-border-200">
      <h2 className="text-xl font-bold mb-4 text-text-900">Team Management</h2>
      {error && <p className="text-accent-500 mb-4">{error}</p>}
      {!showAddForm ? (
        <button
          onClick={() => setShowAddForm(true)}
          className="w-full mb-4 bg-primary-500 text-white p-2 rounded hover:bg-primary-600 transition-colors"
        >
          Add New Team
        </button>
      ) : (
        <div className="mb-4">
          <input
            type="text"
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
            className="w-full p-2 border border-border-200 rounded focus:outline-none focus:border-primary-500"
            placeholder="Enter new team name"
          />
          <CustomSelect
            value={selectedManagerId}
            onValueChange={setSelectedManagerId}
            options={allUsers.map((user): { value: string; label: string } => ({
              value: user.user_id,
              label: `${user.first_name} ${user.last_name}`
            }))}
            placeholder="Select a manager"
            className="mt-2"
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={handleCreateTeam}
              disabled={!newTeamName.trim() || !selectedManagerId}
              className="flex-1 bg-primary-500 text-white p-2 rounded hover:bg-primary-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Create Team
            </button>
            <button
              onClick={() => {
                setShowAddForm(false);
                setNewTeamName('');
                setSelectedManagerId('');
              }}
              className="bg-border-200 text-text-700 p-2 rounded hover:bg-border-300 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      <h3 className="text-lg font-semibold mb-2 text-text-800">Teams</h3>
      <ul className="space-y-2">
        {teams.map((team: ITeam): React.ReactNode => (
          <li key={team.team_id} className="flex items-center justify-between p-2 rounded hover:bg-border-50">
            <button
              onClick={() => onSelectTeam(team)}
              className="text-left font-medium text-text-700 hover:text-primary-500 transition-colors"
            >
              {team.team_name}
            </button>
            <button
              onClick={() => handleDeleteTeam(team)}
              className="bg-accent-500 text-white px-3 py-1 rounded hover:bg-accent-600 transition-colors"
            >
              Delete
            </button>
          </li>
        ))}
      </ul>

      <ConfirmationDialog
        isOpen={!!teamToDelete}
        onClose={() => setTeamToDelete(null)}
        onConfirm={confirmDelete}
        title="Delete Team"
        message={`Are you sure you want to delete the team "${teamToDelete?.team_name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />
    </div>
  );
};

export default TeamList;
