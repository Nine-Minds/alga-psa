/**
 * Settings Page Entry Point
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsPanel } from '../components';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<SettingsPanel />);
}
