import React from 'react';

const DnDFlow: React.FC = () => {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center p-8 max-w-2xl">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">
          Enterprise Feature
        </h2>
        <p className="text-gray-600">
          The workflow system is only available in the Enterprise Edition.
          Please upgrade your installation to access this feature.
        </p>
      </div>
    </div>
  );
};

// Named export for @alga-psa/workflows/entry compatibility
export { DnDFlow };
export default DnDFlow;
