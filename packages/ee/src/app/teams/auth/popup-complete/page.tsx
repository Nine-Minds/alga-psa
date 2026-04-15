import React from 'react';

export default function TeamsTabPopupCompletePage(): React.ReactElement {
  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="space-y-2 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-gray-900">Teams sign-in unavailable</h1>
        <p className="text-sm text-gray-600">Microsoft Teams integration is only available in Enterprise Edition.</p>
      </div>
    </div>
  );
}
