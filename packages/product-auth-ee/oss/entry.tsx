import React from 'react';

export const parsePolicy = (_policyString: string) => {
  throw new Error('Policy parsing is an Enterprise Edition feature');
};

export const PolicyManagement: React.FC = () => (
  <div className="flex items-center justify-center h-64">
    <div className="text-center">
      <h2 className="text-xl font-semibold mb-2">Enterprise Feature</h2>
      <p className="text-gray-600">
        Policy Management requires Enterprise Edition. Please upgrade to access this feature.
      </p>
    </div>
  </div>
);

export default {
  parsePolicy,
  PolicyManagement,
};

