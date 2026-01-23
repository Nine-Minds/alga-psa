import React from 'react';

export default function DnsRecordInstructions(): React.JSX.Element {
  return (
    <div className="p-6">
      <h2 className="text-xl font-semibold mb-2">Enterprise Feature</h2>
      <p className="text-gray-600">DNS record instructions require Enterprise Edition.</p>
    </div>
  );
}

