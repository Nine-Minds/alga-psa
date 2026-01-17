import React from 'react';

export default function ManagedDomainList(): React.JSX.Element {
  return (
    <div className="p-6">
      <h2 className="text-xl font-semibold mb-2">Enterprise Feature</h2>
      <p className="text-gray-600">Managed domains require Enterprise Edition.</p>
    </div>
  );
}

