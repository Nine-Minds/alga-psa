/**
 * Status Indicator Component
 *
 * Visual indicator for agent and session status.
 * Shows: Offline, Online, Active Session count
 */

import React, { useState, useEffect } from 'react';

/**
 * Agent status types
 */
type AgentStatus = 'offline' | 'online' | 'active' | 'error';

/**
 * Active session information
 */
interface ActiveSession {
  sessionId: string;
  startedAt: Date;
  requesterName: string;
  capabilities: string[];
}

interface StatusIndicatorProps {
  status: AgentStatus;
  sessions?: ActiveSession[];
  onEndSession?: (sessionId: string) => void;
  onEndAllSessions?: () => void;
  compact?: boolean;
}

export function StatusIndicator({
  status,
  sessions = [],
  onEndSession,
  onEndAllSessions,
  compact = false,
}: StatusIndicatorProps) {
  const [showSessions, setShowSessions] = useState(false);

  const statusConfig: Record<
    AgentStatus,
    { color: string; bgColor: string; label: string; icon: string }
  > = {
    offline: {
      color: '#6b7280',
      bgColor: '#f3f4f6',
      label: 'Offline',
      icon: '○',
    },
    online: {
      color: '#10b981',
      bgColor: '#d1fae5',
      label: 'Online',
      icon: '●',
    },
    active: {
      color: '#3b82f6',
      bgColor: '#dbeafe',
      label: `${sessions.length} Active Session${sessions.length !== 1 ? 's' : ''}`,
      icon: '◉',
    },
    error: {
      color: '#ef4444',
      bgColor: '#fee2e2',
      label: 'Error',
      icon: '⚠',
    },
  };

  const config = statusConfig[status];

  const formatDuration = (startedAt: Date) => {
    const now = new Date();
    const start = new Date(startedAt);
    const diffMs = now.getTime() - start.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just started';
    if (diffMins < 60) return `${diffMins} min`;
    const hours = Math.floor(diffMins / 60);
    const mins = diffMins % 60;
    return `${hours}h ${mins}m`;
  };

  if (compact) {
    return (
      <div
        className="status-indicator-compact"
        style={{ backgroundColor: config.bgColor }}
      >
        <span className="status-dot" style={{ color: config.color }}>
          {config.icon}
        </span>
        <span className="status-text" style={{ color: config.color }}>
          {config.label}
        </span>

        <style>{`
          .status-indicator-compact {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 4px 10px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 500;
          }

          .status-dot {
            font-size: 10px;
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="status-indicator">
      <div
        className="status-header"
        style={{ backgroundColor: config.bgColor }}
        onClick={() => status === 'active' && setShowSessions(!showSessions)}
      >
        <span className="status-dot" style={{ color: config.color }}>
          {config.icon}
        </span>
        <span className="status-text" style={{ color: config.color }}>
          {config.label}
        </span>
        {status === 'active' && (
          <span className="status-expand" style={{ color: config.color }}>
            {showSessions ? '▲' : '▼'}
          </span>
        )}
      </div>

      {status === 'active' && showSessions && sessions.length > 0 && (
        <div className="sessions-list">
          {sessions.map((session) => (
            <div key={session.sessionId} className="session-item">
              <div className="session-info">
                <span className="session-user">{session.requesterName}</span>
                <span className="session-duration">
                  {formatDuration(session.startedAt)}
                </span>
              </div>
              <div className="session-capabilities">
                {session.capabilities.map((cap) => (
                  <span key={cap} className="capability-tag">
                    {cap}
                  </span>
                ))}
              </div>
              {onEndSession && (
                <button
                  className="btn-end-session"
                  onClick={() => onEndSession(session.sessionId)}
                >
                  End
                </button>
              )}
            </div>
          ))}

          {sessions.length > 1 && onEndAllSessions && (
            <div className="sessions-actions">
              <button className="btn-end-all" onClick={onEndAllSessions}>
                End All Sessions
              </button>
            </div>
          )}
        </div>
      )}

      <style>{`
        .status-indicator {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
          border-radius: 12px;
          overflow: hidden;
        }

        .status-header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px 16px;
          cursor: ${status === 'active' ? 'pointer' : 'default'};
          transition: opacity 0.15s ease;
        }

        .status-header:hover {
          opacity: ${status === 'active' ? '0.9' : '1'};
        }

        .status-dot {
          font-size: 14px;
        }

        .status-text {
          flex: 1;
          font-size: 14px;
          font-weight: 600;
        }

        .status-expand {
          font-size: 10px;
        }

        .sessions-list {
          background: var(--bg-secondary, #f9fafb);
          border-top: 1px solid var(--border-color, #e5e7eb);
        }

        .session-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 16px;
          border-bottom: 1px solid var(--border-color, #e5e7eb);
        }

        .session-item:last-child {
          border-bottom: none;
        }

        .session-info {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .session-user {
          font-size: 14px;
          font-weight: 500;
          color: var(--text-primary, #1f2937);
        }

        .session-duration {
          font-size: 12px;
          color: var(--text-secondary, #6b7280);
        }

        .session-capabilities {
          display: flex;
          gap: 4px;
          flex-wrap: wrap;
        }

        .capability-tag {
          padding: 2px 6px;
          background: var(--bg-tertiary, #e5e7eb);
          border-radius: 4px;
          font-size: 10px;
          font-weight: 500;
          color: var(--text-secondary, #6b7280);
          text-transform: uppercase;
        }

        .btn-end-session {
          padding: 6px 12px;
          background: transparent;
          border: 1px solid #ef4444;
          border-radius: 6px;
          color: #ef4444;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .btn-end-session:hover {
          background: #ef4444;
          color: white;
        }

        .sessions-actions {
          padding: 12px 16px;
          background: var(--bg-tertiary, #f3f4f6);
          text-align: center;
        }

        .btn-end-all {
          padding: 8px 16px;
          background: #ef4444;
          border: none;
          border-radius: 6px;
          color: white;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: background 0.15s ease;
        }

        .btn-end-all:hover {
          background: #dc2626;
        }

        @media (prefers-color-scheme: dark) {
          .status-indicator {
            --bg-secondary: #1f2937;
            --bg-tertiary: #374151;
            --text-primary: #f9fafb;
            --text-secondary: #9ca3af;
            --border-color: #374151;
          }
        }
      `}</style>
    </div>
  );
}

export default StatusIndicator;
