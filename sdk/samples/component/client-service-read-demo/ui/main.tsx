import '@alga-psa/ui-kit/theme.css';

import React from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';

const el = document.getElementById('root');

if (!el) {
  throw new Error('Missing root element');
}

const root = createRoot(el);
root.render(<App />);
