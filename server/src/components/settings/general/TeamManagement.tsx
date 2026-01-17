'use client';
import React, { useState, useEffect } from 'react';
import TeamList from './TeamList';
import TeamDetails from './TeamDetails';
import { getTeams } from 'server/src/lib/actions/team-actions/teamActions';
import { ITeam } from 'server/src/interfaces/auth.interfaces';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';

const TeamManagement: React.FC = () => {
  const [teams, setTeams] = useState<ITeam[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<ITeam | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTeams();
  }, []);

  const fetchTeams = async (): Promise<void> => {
    try {
      setLoading(true);
      setError(null);
      const fetchedTeams = await getTeams();
      setTeams(fetchedTeams);
    } catch (err) {
      console.error('Failed to fetch teams:', err);
      setError('Failed to load teams. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleTeamUpdate = (updatedTeam: ITeam | null, deleted?: boolean) => {
    if (deleted) {
      setTeams((prevTeams) => prevTeams.filter(team => team.team_id !== updatedTeam?.team_id));
      setSelectedTeam(null);
    } else if (updatedTeam) {
      setTeams((prevTeams) => {
        const existingTeam = prevTeams.find(team => team.team_id === updatedTeam.team_id);
        if (existingTeam) {
          return prevTeams.map((team):ITeam => 
            team.team_id === updatedTeam.team_id ? updatedTeam : team
          );
        } else {
          return [...prevTeams, updatedTeam];
        }
      });
      setSelectedTeam(updatedTeam);
    } else {
      setSelectedTeam(null);
    }
    setError(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <LoadingIndicator 
          layout="stacked" 
          text="Loading teams..."
          spinnerProps={{ size: 'md' }}
        />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <p className="text-accent-500 mb-4">{error}</p>
        <button 
          onClick={fetchTeams} 
          className="bg-primary-500 text-white px-4 py-2 rounded hover:bg-primary-600 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex gap-4 min-h-0">
      <div className="flex-shrink-0 w-1/3 min-w-0">
        <TeamList teams={teams} onSelectTeam={handleTeamUpdate} />
      </div>
      <div className="flex-1 min-w-0">
        {selectedTeam ? (
          <TeamDetails teamId={selectedTeam.team_id} onUpdate={handleTeamUpdate} />
        ) : (
          <div className="flex items-center justify-center h-full min-h-[400px] p-8 rounded-lg border border-border-200">
            <p className="text-lg text-text-500 text-center">Please select a team to manage members</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default TeamManagement;
