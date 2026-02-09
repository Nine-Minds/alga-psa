import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

// Theme Bridge - Receives theme from host app and applies CSS variables
// ============================================================================

/**
 * Apply theme variables to the document root
 */
function applyTheme(vars: Record<string, string>) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  Object.entries(vars).forEach(([key, value]) => {
    root.style.setProperty(key, value);
  });
}

/**
 * Get the parent origin for postMessage
 */
function getParentOrigin(): string {
  const params = new URLSearchParams(window.location.search);
  const parentOrigin = params.get('parentOrigin');
  if (parentOrigin) return parentOrigin;

  if (document.referrer) {
    try {
      return new URL(document.referrer).origin;
    } catch {
      // Invalid referrer
    }
  }
  return '*';
}

/**
 * Send ready message to parent and set up theme listener
 */
function initializeThemeBridge() {
  const parentOrigin = getParentOrigin();

  // Listen for theme messages from parent
  const handleMessage = (ev: MessageEvent) => {
    const data = ev.data;
    if (!data || typeof data !== 'object') return;

    // Check for Alga envelope format with theme message
    if (data.alga === true && data.version === '1' && data.type === 'theme') {
      applyTheme(data.payload || {});
    }
  };

  window.addEventListener('message', handleMessage);

  // Send ready message to parent so it knows to send theme
  window.parent.postMessage(
    { alga: true, version: '1', type: 'ready' },
    parentOrigin
  );
}

// Initialize theme bridge on load
if (typeof window !== 'undefined') {
  initializeThemeBridge();
}

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<App />);
}
