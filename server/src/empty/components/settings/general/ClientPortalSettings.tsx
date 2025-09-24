'use client';

import React from 'react';

const ClientPortalSettings: React.FC = () => {
  if (process.env.NODE_ENV === 'development') {
    // eslint-disable-next-line no-console
    console.warn('[CE stub ClientPortalSettings] rendered');
  }
  return null;
};

export default ClientPortalSettings;
