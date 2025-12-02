import React from 'react';
import { createRoot } from 'react-dom/client';
import { TicketsPanel } from './tickets-panel';
import { IframeBridge } from '@alga/extension-iframe-sdk';

// Initialize the SDK bridge
// The bridge handles the postMessage handshake and proxy communication
const bridge = new IframeBridge({
    // In a real scenario, you might want to restrict this. 
    // For the demo, we assume standard embedding.
    devAllowWildcard: true 
});

// Signal ready
bridge.ready();

const rootEl = document.getElementById('root');
if (rootEl) {
  const root = createRoot(rootEl);
  // Pass the bridge's uiProxy adapter to the component
  root.render(<TicketsPanel uiProxy={bridge.uiProxy} />);
}
