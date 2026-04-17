'use client';

import React from 'react';

interface EntraIntegrationSettingsProps {
  canUseCipp?: boolean;
}

const EntraIntegrationSettings: React.FC<EntraIntegrationSettingsProps> = () => {
  return (
    <div className="text-center py-8 text-muted-foreground">
      <p className="text-lg font-medium">Enterprise Feature</p>
      <p className="mt-2 text-sm">
        Microsoft Entra integration is available in the Enterprise edition of Alga PSA.
      </p>
    </div>
  );
};

export default EntraIntegrationSettings;
