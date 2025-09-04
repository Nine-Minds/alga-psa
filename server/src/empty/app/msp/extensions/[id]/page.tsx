import React from 'react';

export const metadata = {
  title: 'Extensions (EE only)'
};

export default function Page({ params }: { params: { id: string } }) {
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold">Extension Not Available</h1>
      <p className="mt-2 text-sm text-gray-600">
        The extensions system is available in the Enterprise Edition and is not
        included in this Community Edition build.
      </p>
      <p className="mt-4 text-xs text-gray-500">Requested ID: {params.id}</p>
    </div>
  );
}
