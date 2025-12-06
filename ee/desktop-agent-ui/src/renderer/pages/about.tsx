/**
 * About Page Entry Point
 */

import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

declare global {
  interface Window {
    electronAPI: {
      app: {
        getVersion: () => Promise<string>;
      };
      agent: {
        getVersion: () => Promise<string>;
      };
    };
  }
}

function AboutPage() {
  const [appVersion, setAppVersion] = useState('');
  const [agentVersion, setAgentVersion] = useState('');

  useEffect(() => {
    const loadVersions = async () => {
      const [app, agent] = await Promise.all([
        window.electronAPI.app.getVersion(),
        window.electronAPI.agent.getVersion(),
      ]);
      setAppVersion(app);
      setAgentVersion(agent);
    };

    loadVersions();
  }, []);

  return (
    <div className="about-page">
      <div className="about-content">
        <div className="app-icon">🖥️</div>
        <h1>Alga Remote Agent</h1>
        <div className="version-info">
          <p>App Version: {appVersion}</p>
          <p>Agent Version: {agentVersion}</p>
        </div>
        <div className="copyright">
          <p>&copy; {new Date().getFullYear()} Alga PSA</p>
          <p>All rights reserved.</p>
        </div>
        <div className="links">
          <a href="https://alga.io/docs/remote-desktop" target="_blank" rel="noreferrer">
            Documentation
          </a>
          <span className="separator">|</span>
          <a href="https://alga.io/privacy" target="_blank" rel="noreferrer">
            Privacy Policy
          </a>
          <span className="separator">|</span>
          <a href="https://alga.io/terms" target="_blank" rel="noreferrer">
            Terms of Service
          </a>
        </div>
      </div>

      <style>{`
        .about-page {
          height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: var(--bg-primary, #ffffff);
          color: var(--text-primary, #1a1a1a);
          -webkit-app-region: drag;
        }

        @media (prefers-color-scheme: dark) {
          .about-page {
            --bg-primary: #1e1e1e;
            --text-primary: #ffffff;
            --text-secondary: #a0a0a0;
          }
        }

        .about-content {
          text-align: center;
          padding: 40px;
        }

        .app-icon {
          font-size: 64px;
          margin-bottom: 16px;
        }

        h1 {
          margin: 0 0 24px 0;
          font-size: 20px;
          font-weight: 600;
        }

        .version-info {
          margin-bottom: 24px;
        }

        .version-info p {
          margin: 4px 0;
          font-size: 13px;
          color: var(--text-secondary, #666);
        }

        .copyright {
          margin-bottom: 24px;
        }

        .copyright p {
          margin: 2px 0;
          font-size: 12px;
          color: var(--text-secondary, #666);
        }

        .links {
          font-size: 12px;
          -webkit-app-region: no-drag;
        }

        .links a {
          color: #3b82f6;
          text-decoration: none;
        }

        .links a:hover {
          text-decoration: underline;
        }

        .separator {
          margin: 0 8px;
          color: var(--text-secondary, #666);
        }
      `}</style>
    </div>
  );
}

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<AboutPage />);
}
