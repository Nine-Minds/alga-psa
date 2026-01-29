'use client';

import React from 'react';

export const DnDFlow = () => {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-2">Enterprise Feature</h2>
        <p className="text-gray-600">
          Workflow designer requires Enterprise Edition. Please upgrade to access this feature.
        </p>
      </div>
    </div>
  );
};

export default DnDFlow;

