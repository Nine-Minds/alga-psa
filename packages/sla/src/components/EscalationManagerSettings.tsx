'use client';

/**
 * Escalation Manager Settings Component
 *
 * Allows administrators to configure escalation managers for each board.
 * Each board can have up to 3 escalation levels, each with a designated manager
 * who will be notified and added as a resource when tickets reach that level.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { ColumnDefinition } from '@alga-psa/types';
import { IUser } from '@alga-psa/types';
import { IBoardEscalationConfig, SlaNotificationChannel } from '../types';
import { getBoardEscalationConfigs, setEscalationManager } from '../actions/escalationManagerActions';
import { getAllUsers } from '@alga-psa/users/actions';
import UserPicker from '@alga-psa/ui/components/UserPicker';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import toast from 'react-hot-toast';
import { Save, RefreshCw, Info } from 'lucide-react';

interface PendingChange {
  boardId: string;
  level: 1 | 2 | 3;
  userId: string | null;
  notifyVia: SlaNotificationChannel[];
}

export const EscalationManagerSettings: React.FC = () => {
  const [configs, setConfigs] = useState<IBoardEscalationConfig[]>([]);
  const [users, setUsers] = useState<IUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingChanges, setPendingChanges] = useState<Map<string, PendingChange>>(new Map());

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [configsData, usersData] = await Promise.all([
        getBoardEscalationConfigs(),
        getAllUsers(false, 'internal')
      ]);
      setConfigs(configsData);
      setUsers(usersData);
      setPendingChanges(new Map());
    } catch (err) {
      console.error('Error fetching escalation data:', err);
      setError('Failed to load escalation configurations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleManagerChange = (boardId: string, level: 1 | 2 | 3, userId: string | null) => {
    const key = `${boardId}-${level}`;
    const currentConfig = configs.find(c => c.board_id === boardId);
    const currentValue = level === 1
      ? currentConfig?.level_1?.manager_user_id
      : level === 2
        ? currentConfig?.level_2?.manager_user_id
        : currentConfig?.level_3?.manager_user_id;

    // Only track if different from current saved value
    if (userId !== currentValue) {
      setPendingChanges(prev => {
        const next = new Map(prev);
        next.set(key, {
          boardId,
          level,
          userId,
          notifyVia: ['in_app', 'email']
        });
        return next;
      });
    } else {
      // Remove from pending if reverted to original
      setPendingChanges(prev => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const handleSaveChanges = async () => {
    if (pendingChanges.size === 0) return;

    try {
      setSaving(true);
      setError(null);

      // Save all pending changes
      for (const change of pendingChanges.values()) {
        await setEscalationManager({
          board_id: change.boardId,
          escalation_level: change.level,
          manager_user_id: change.userId,
          notify_via: change.notifyVia
        });
      }

      toast.success('Escalation managers updated successfully');
      await fetchData();
    } catch (err) {
      console.error('Error saving escalation managers:', err);
      toast.error('Failed to save escalation managers');
      setError('Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  const getCurrentValue = (boardId: string, level: 1 | 2 | 3): string => {
    const key = `${boardId}-${level}`;
    const pending = pendingChanges.get(key);
    if (pending !== undefined) {
      return pending.userId || '';
    }

    const config = configs.find(c => c.board_id === boardId);
    if (!config) return '';

    const levelConfig = level === 1 ? config.level_1 : level === 2 ? config.level_2 : config.level_3;
    return levelConfig?.manager_user_id || '';
  };

  const columns: ColumnDefinition<IBoardEscalationConfig>[] = [
    {
      title: 'Board',
      dataIndex: 'board_name',
      render: (value: string) => (
        <span className="font-medium text-gray-800">{value}</span>
      ),
    },
    {
      title: 'Level 1 Manager',
      dataIndex: 'level_1',
      render: (_, record) => (
        <UserPicker
          id={`escalation-l1-${record.board_id}`}
          value={getCurrentValue(record.board_id, 1)}
          onValueChange={(value) => handleManagerChange(record.board_id, 1, value || null)}
          users={users}
          userTypeFilter="internal"
          placeholder="None"
          buttonWidth="full"
          labelStyle="none"
        />
      ),
    },
    {
      title: 'Level 2 Manager',
      dataIndex: 'level_2',
      render: (_, record) => (
        <UserPicker
          id={`escalation-l2-${record.board_id}`}
          value={getCurrentValue(record.board_id, 2)}
          onValueChange={(value) => handleManagerChange(record.board_id, 2, value || null)}
          users={users}
          userTypeFilter="internal"
          placeholder="None"
          buttonWidth="full"
          labelStyle="none"
        />
      ),
    },
    {
      title: 'Level 3 Manager',
      dataIndex: 'level_3',
      render: (_, record) => (
        <UserPicker
          id={`escalation-l3-${record.board_id}`}
          value={getCurrentValue(record.board_id, 3)}
          onValueChange={(value) => handleManagerChange(record.board_id, 3, value || null)}
          users={users}
          userTypeFilter="internal"
          placeholder="None"
          buttonWidth="full"
          labelStyle="none"
        />
      ),
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-gray-900">Escalation Managers</h3>
        <p className="text-sm text-gray-600 mt-1">
          Configure escalation managers for each board. When a ticket reaches an escalation threshold,
          the assigned manager will be added to the ticket and notified via in-app notification and email.
        </p>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          <strong>Escalation Levels:</strong>
          <ul className="list-disc list-inside mt-2 space-y-1">
            <li><strong>Level 1:</strong> Typically triggered at 70% of SLA time elapsed</li>
            <li><strong>Level 2:</strong> Typically triggered at 90% of SLA time elapsed</li>
            <li><strong>Level 3:</strong> Typically triggered at 110% of SLA time elapsed (breach)</li>
          </ul>
          <p className="mt-2">
            Escalation thresholds can be configured per priority in each SLA policy's targets.
          </p>
        </AlertDescription>
      </Alert>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {configs.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          No boards found. Create a board first to configure escalation managers.
        </div>
      ) : (
        <DataTable
          data={configs}
          columns={columns}
          pagination={false}
        />
      )}

      <div className="flex justify-between items-center pt-4 border-t">
        <Button
          id="refresh-escalation-configs"
          variant="outline"
          onClick={fetchData}
          disabled={loading || saving}
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
        <div className="flex items-center gap-4">
          {pendingChanges.size > 0 && (
            <span className="text-sm text-amber-600">
              {pendingChanges.size} unsaved change{pendingChanges.size > 1 ? 's' : ''}
            </span>
          )}
          <Button
            id="save-escalation-configs"
            onClick={handleSaveChanges}
            disabled={pendingChanges.size === 0 || saving}
          >
            <Save className="h-4 w-4 mr-2" />
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </div>
  );
};
