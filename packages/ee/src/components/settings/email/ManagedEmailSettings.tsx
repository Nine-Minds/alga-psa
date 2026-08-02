import React from 'react';

export function ManagedEmailSettings(): React.JSX.Element {
  return (
    <div className="p-6">
      <h2 className="text-xl font-semibold mb-2">Pro Feature</h2>
      <p className="text-gray-600">Managed email settings require Pro.</p>
    </div>
  );
}

export default ManagedEmailSettings;
