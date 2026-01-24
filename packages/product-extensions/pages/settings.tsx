import React from 'react';

// Stub page for extension settings - implement in EE
export default function ExtensionSettingsPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold text-gray-900">Extension Settings</h1>
      <p className="text-gray-600 mt-2">Extension settings are available in Enterprise Edition.</p>
    </div>
  );
}

export const metadata = {
  title: 'Extension Settings',
  description: 'Configure extension settings',
};
