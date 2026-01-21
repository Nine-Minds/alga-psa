import React from 'react';

// Stub page for extensions list - implement in EE
export default function ExtensionsListPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold text-gray-900">Extensions</h1>
      <p className="text-gray-600 mt-2">Extensions management is available in Enterprise Edition.</p>
    </div>
  );
}

export const metadata = {
  title: 'Extensions',
  description: 'Manage extensions',
};
