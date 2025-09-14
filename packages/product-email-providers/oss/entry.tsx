import React from 'react';

// OSS stub implementation for Email Providers
export const GmailProviderForm = () => {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-2">Enterprise Feature</h2>
        <p className="text-gray-600">
          Gmail provider configuration requires Enterprise Edition. Please upgrade to access this feature.
        </p>
      </div>
    </div>
  );
};

export const MicrosoftProviderForm = () => {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-2">Enterprise Feature</h2>
        <p className="text-gray-600">
          Microsoft provider configuration requires Enterprise Edition. Please upgrade to access this feature.
        </p>
      </div>
    </div>
  );
};

export const EmailProviderSettings = () => {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-2">Enterprise Feature</h2>
        <p className="text-gray-600">
          Email provider settings require Enterprise Edition. Please upgrade to access this feature.
        </p>
      </div>
    </div>
  );
};

// Default export
export default {
  GmailProviderForm,
  MicrosoftProviderForm,
  EmailProviderSettings,
};
