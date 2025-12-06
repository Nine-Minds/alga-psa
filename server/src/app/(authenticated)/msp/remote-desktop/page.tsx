'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { RemoteDesktopViewer } from '@/components/remote-desktop/RemoteDesktopViewer';
import { Button } from '@/components/ui/Button';
import { IRemoteAgent, OSType, AgentStatus } from '@/types/remoteDesktop';

interface AgentCardProps {
  agent: IRemoteAgent;
  onConnect: (agentId: string) => void;
  isConnecting: boolean;
}

const AgentCard: React.FC<AgentCardProps> = ({ agent, onConnect, isConnecting }) => {
  const getStatusColor = (status: AgentStatus) => {
    switch (status) {
      case 'online':
        return 'bg-green-500';
      case 'suspended':
        return 'bg-yellow-500';
      default:
        return 'bg-gray-400';
    }
  };

  const getOSIcon = (osType: OSType) => {
    if (osType === 'windows') {
      return (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801" />
        </svg>
      );
    }
    return (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
      </svg>
    );
  };

  const formatLastSeen = (lastSeen?: Date) => {
    if (!lastSeen) return 'Never';
    const date = new Date(lastSeen);
    return date.toLocaleString();
  };

  return (
    <div className="border rounded-lg p-6 shadow-sm hover:shadow-md transition-shadow bg-white dark:bg-gray-800 dark:border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="text-gray-600 dark:text-gray-400">
            {getOSIcon(agent.os_type)}
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {agent.agent_name}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <div
            className={`w-3 h-3 rounded-full ${getStatusColor(agent.status)}`}
            title={agent.status}
          />
          <span className="text-xs text-gray-500 dark:text-gray-400 capitalize">
            {agent.status}
          </span>
        </div>
      </div>

      <div className="space-y-2 text-sm text-gray-600 dark:text-gray-300 mb-4">
        <p>
          <span className="font-medium">Hostname:</span> {agent.hostname}
        </p>
        <p>
          <span className="font-medium">OS:</span>{' '}
          {agent.os_type === 'windows' ? 'Windows' : 'macOS'}{' '}
          {agent.os_version}
        </p>
        <p>
          <span className="font-medium">Version:</span> {agent.agent_version}
        </p>
        {agent.last_seen_at && (
          <p>
            <span className="font-medium">Last seen:</span>{' '}
            {formatLastSeen(agent.last_seen_at)}
          </p>
        )}
      </div>

      <Button
        onClick={() => onConnect(agent.agent_id)}
        disabled={agent.status !== 'online' || isConnecting}
        className="w-full"
      >
        {isConnecting ? (
          <>
            <span className="animate-spin mr-2">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <circle cx="12" cy="12" r="10" strokeWidth="4" strokeOpacity="0.25" />
                <path d="M4 12a8 8 0 018-8" strokeWidth="4" strokeLinecap="round" />
              </svg>
            </span>
            Connecting...
          </>
        ) : agent.status === 'online' ? (
          'Connect'
        ) : (
          'Offline'
        )}
      </Button>
    </div>
  );
};

export default function RemoteDesktopPage() {
  const [agents, setAgents] = useState<IRemoteAgent[]>([]);
  const [activeSession, setActiveSession] = useState<{
    sessionId: string;
    agentId: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectingAgentId, setConnectingAgentId] = useState<string | null>(null);

  const fetchAgents = useCallback(async () => {
    try {
      setError(null);
      const response = await fetch('/api/v1/remote-desktop/agents', {
        headers: {
          'x-api-key': sessionStorage.getItem('api_key') || localStorage.getItem('api_key') || '',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch agents');
      }

      const data = await response.json();
      setAgents(data.data || []);
    } catch (err) {
      console.error('Failed to fetch agents:', err);
      setError(err instanceof Error ? err.message : 'Failed to load agents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAgents();

    // Refresh agent list periodically
    const interval = setInterval(fetchAgents, 30000);
    return () => clearInterval(interval);
  }, [fetchAgents]);

  const startSession = async (agentId: string) => {
    try {
      setConnectingAgentId(agentId);
      setError(null);

      const response = await fetch('/api/v1/remote-desktop/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': sessionStorage.getItem('api_key') || localStorage.getItem('api_key') || '',
        },
        body: JSON.stringify({ agent_id: agentId }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || 'Failed to start session');
      }

      const data = await response.json();

      setActiveSession({
        sessionId: data.data.session_id,
        agentId,
      });
    } catch (err) {
      console.error('Failed to start session:', err);
      setError(err instanceof Error ? err.message : 'Failed to start session');
    } finally {
      setConnectingAgentId(null);
    }
  };

  const endSession = async () => {
    if (!activeSession) return;

    try {
      await fetch(`/api/v1/remote-desktop/sessions/${activeSession.sessionId}`, {
        method: 'DELETE',
        headers: {
          'x-api-key': sessionStorage.getItem('api_key') || localStorage.getItem('api_key') || '',
        },
      });
    } catch (err) {
      console.error('Failed to end session:', err);
    } finally {
      setActiveSession(null);
    }
  };

  const handleConnectionError = (errorMsg: string) => {
    setError(errorMsg);
    setActiveSession(null);
  };

  // Show viewer when session is active
  if (activeSession) {
    return (
      <div className="h-screen">
        <RemoteDesktopViewer
          sessionId={activeSession.sessionId}
          agentId={activeSession.agentId}
          onDisconnect={endSession}
          onError={handleConnectionError}
        />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Remote Desktop
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Connect to client machines for remote support
          </p>
        </div>
        <Button
          onClick={fetchAgents}
          variant="outline"
          disabled={loading}
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </Button>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-red-700 dark:text-red-400">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
        </div>
      ) : agents.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <svg
            className="w-16 h-16 mx-auto text-gray-400 mb-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
            />
          </svg>
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            No agents registered
          </h3>
          <p className="text-gray-500 dark:text-gray-400 max-w-md mx-auto">
            Install the Remote Desktop Agent on client machines to enable remote support.
            Once installed and registered, agents will appear here.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {agents.map((agent) => (
              <AgentCard
                key={agent.agent_id}
                agent={agent}
                onConnect={startSession}
                isConnecting={connectingAgentId === agent.agent_id}
              />
            ))}
          </div>

          <div className="mt-8 text-sm text-gray-500 dark:text-gray-400">
            <p>
              <strong>Note:</strong> Only online agents can accept remote connections.
              Agents automatically go offline when the agent software is closed.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
