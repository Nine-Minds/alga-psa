/**
 * Consent Dialog Page Entry Point
 */

import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { ConsentDialog } from '../components';

interface SessionRequest {
  sessionId: string;
  requesterName: string;
  requesterEmail?: string;
  tenant: string;
  requestedCapabilities: string[];
  timestamp: Date;
}

declare global {
  interface Window {
    electronAPI: {
      session: {
        respond: (sessionId: string, accept: boolean, duration?: number) => Promise<boolean>;
      };
      on: (channel: string, callback: (...args: unknown[]) => void) => () => void;
    };
  }
}

function ConsentPage() {
  const [request, setRequest] = useState<SessionRequest | null>(null);

  useEffect(() => {
    const unsubscribe = window.electronAPI.on('session-request', (data: unknown) => {
      setRequest(data as SessionRequest);
    });

    return unsubscribe;
  }, []);

  const handleAccept = (sessionId: string, duration?: number) => {
    window.electronAPI.session.respond(sessionId, true, duration);
    setRequest(null);
  };

  const handleDeny = (sessionId: string) => {
    window.electronAPI.session.respond(sessionId, false);
    setRequest(null);
  };

  return (
    <ConsentDialog
      request={request}
      onAccept={handleAccept}
      onDeny={handleDeny}
    />
  );
}

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<ConsentPage />);
}
