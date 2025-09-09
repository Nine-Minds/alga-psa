import React from 'react';

export const metadata = {
  title: 'Extension Details'
};

export default function Page({ params }: { params: { id: string } }) {
  // TODO: Implement full EE logic: fetch install info, render details, actions, etc.
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold">Extension Details (EE)</h1>
      <p className="mt-2 text-sm text-gray-600">Extension ID: {params.id}</p>
    </div>
  );
}
