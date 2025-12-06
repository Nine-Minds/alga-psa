/**
 * Consent Dialog Component
 *
 * Displays a prompt for the user to accept or deny a remote session request.
 * Shows requester information and requested capabilities.
 */

import React, { useState, useEffect } from 'react';

/**
 * Session request information
 */
interface SessionRequest {
  sessionId: string;
  requesterName: string;
  requesterEmail?: string;
  tenant: string;
  requestedCapabilities: string[];
  timestamp: Date;
}

/**
 * Capability labels for display
 */
const CAPABILITY_LABELS: Record<string, { label: string; description: string; icon: string }> = {
  view: {
    label: 'View Screen',
    description: 'See your screen in real-time',
    icon: '👁',
  },
  control: {
    label: 'Control Input',
    description: 'Use mouse and keyboard on your computer',
    icon: '🖱',
  },
  terminal: {
    label: 'Terminal Access',
    description: 'Run commands on your computer',
    icon: '⌨',
  },
  files: {
    label: 'File Transfer',
    description: 'Upload and download files',
    icon: '📁',
  },
  elevate: {
    label: 'Admin Access',
    description: 'Run commands with administrator privileges',
    icon: '🔐',
  },
};

/**
 * Duration options for temporary access
 */
const DURATION_OPTIONS = [
  { value: undefined, label: 'Until I disconnect' },
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
];

interface ConsentDialogProps {
  request: SessionRequest | null;
  onAccept: (sessionId: string, duration?: number) => void;
  onDeny: (sessionId: string) => void;
}

export function ConsentDialog({ request, onAccept, onDeny }: ConsentDialogProps) {
  const [selectedDuration, setSelectedDuration] = useState<number | undefined>(undefined);
  const [timeRemaining, setTimeRemaining] = useState(60); // 60 second timeout

  // Auto-deny after timeout
  useEffect(() => {
    if (!request) return;

    const interval = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev <= 1) {
          onDeny(request.sessionId);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [request, onDeny]);

  // Reset state when new request comes in
  useEffect(() => {
    setSelectedDuration(undefined);
    setTimeRemaining(60);
  }, [request?.sessionId]);

  if (!request) {
    return null;
  }

  const handleAccept = () => {
    onAccept(request.sessionId, selectedDuration);
  };

  const handleDeny = () => {
    onDeny(request.sessionId);
  };

  const formatTime = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(date));
  };

  return (
    <div className="consent-dialog">
      <div className="consent-header">
        <div className="consent-icon">🖥</div>
        <h2>Remote Access Request</h2>
      </div>

      <div className="consent-body">
        <div className="requester-info">
          <div className="requester-avatar">
            {request.requesterName.charAt(0).toUpperCase()}
          </div>
          <div className="requester-details">
            <span className="requester-name">{request.requesterName}</span>
            {request.requesterEmail && (
              <span className="requester-email">{request.requesterEmail}</span>
            )}
            <span className="request-time">Requested at {formatTime(request.timestamp)}</span>
          </div>
        </div>

        <div className="capabilities-section">
          <h3>Requested Access</h3>
          <ul className="capabilities-list">
            {request.requestedCapabilities.map((cap) => {
              const capInfo = CAPABILITY_LABELS[cap] || {
                label: cap,
                description: '',
                icon: '❓',
              };
              return (
                <li key={cap} className="capability-item">
                  <span className="capability-icon">{capInfo.icon}</span>
                  <div className="capability-info">
                    <span className="capability-label">{capInfo.label}</span>
                    <span className="capability-desc">{capInfo.description}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="duration-section">
          <label htmlFor="duration">Allow access for:</label>
          <select
            id="duration"
            value={selectedDuration ?? ''}
            onChange={(e) => setSelectedDuration(e.target.value ? Number(e.target.value) : undefined)}
          >
            {DURATION_OPTIONS.map((option) => (
              <option key={option.label} value={option.value ?? ''}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="consent-footer">
        <div className="timeout-indicator">
          Auto-deny in {timeRemaining}s
        </div>
        <div className="consent-actions">
          <button className="btn btn-deny" onClick={handleDeny}>
            Deny
          </button>
          <button className="btn btn-accept" onClick={handleAccept}>
            Allow
          </button>
        </div>
      </div>

      <style>{`
        .consent-dialog {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
          background: var(--bg-primary, #ffffff);
          border-radius: 12px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
          overflow: hidden;
          color: var(--text-primary, #1a1a1a);
        }

        @media (prefers-color-scheme: dark) {
          .consent-dialog {
            --bg-primary: #1e1e1e;
            --bg-secondary: #2d2d2d;
            --text-primary: #ffffff;
            --text-secondary: #a0a0a0;
            --border-color: #404040;
          }
        }

        .consent-header {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 16px 20px;
          background: var(--bg-secondary, #f5f5f5);
          border-bottom: 1px solid var(--border-color, #e0e0e0);
        }

        .consent-icon {
          font-size: 24px;
        }

        .consent-header h2 {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
        }

        .consent-body {
          padding: 20px;
        }

        .requester-info {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 20px;
        }

        .requester-avatar {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          background: linear-gradient(135deg, #6366f1, #8b5cf6);
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
          font-weight: 600;
        }

        .requester-details {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .requester-name {
          font-weight: 600;
          font-size: 15px;
        }

        .requester-email {
          font-size: 13px;
          color: var(--text-secondary, #666);
        }

        .request-time {
          font-size: 12px;
          color: var(--text-secondary, #666);
        }

        .capabilities-section h3 {
          margin: 0 0 12px 0;
          font-size: 13px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--text-secondary, #666);
        }

        .capabilities-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .capability-item {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 8px 12px;
          background: var(--bg-secondary, #f5f5f5);
          border-radius: 8px;
        }

        .capability-icon {
          font-size: 18px;
        }

        .capability-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .capability-label {
          font-weight: 500;
          font-size: 14px;
        }

        .capability-desc {
          font-size: 12px;
          color: var(--text-secondary, #666);
        }

        .duration-section {
          margin-top: 16px;
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .duration-section label {
          font-size: 14px;
          font-weight: 500;
        }

        .duration-section select {
          flex: 1;
          padding: 8px 12px;
          border: 1px solid var(--border-color, #e0e0e0);
          border-radius: 6px;
          background: var(--bg-primary, #ffffff);
          color: var(--text-primary, #1a1a1a);
          font-size: 14px;
        }

        .consent-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 20px;
          background: var(--bg-secondary, #f5f5f5);
          border-top: 1px solid var(--border-color, #e0e0e0);
        }

        .timeout-indicator {
          font-size: 12px;
          color: var(--text-secondary, #666);
        }

        .consent-actions {
          display: flex;
          gap: 8px;
        }

        .btn {
          padding: 10px 20px;
          border: none;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .btn-deny {
          background: transparent;
          color: var(--text-primary, #1a1a1a);
          border: 1px solid var(--border-color, #e0e0e0);
        }

        .btn-deny:hover {
          background: var(--bg-secondary, #f5f5f5);
        }

        .btn-accept {
          background: #10b981;
          color: white;
        }

        .btn-accept:hover {
          background: #059669;
        }
      `}</style>
    </div>
  );
}

export default ConsentDialog;
