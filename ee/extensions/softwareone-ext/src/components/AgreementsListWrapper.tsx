import React from 'react';

interface AgreementsListWrapperProps {
  extensionId: string;
  [key: string]: any;
}

export const AgreementsListWrapper: React.FC<AgreementsListWrapperProps> = () => {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">SoftwareOne Agreements</h1>
      
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
        <p className="text-sm text-yellow-800">
          <strong>Note:</strong> This is a placeholder for the agreements list. 
          Please configure your SoftwareOne API credentials in the Settings page first.
        </p>
      </div>

      <div className="grid gap-4">
        {/* Placeholder for agreement cards */}
        <div className="border rounded-lg p-4 bg-gray-50">
          <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
          <div className="h-3 bg-gray-200 rounded w-1/2"></div>
        </div>
        <div className="border rounded-lg p-4 bg-gray-50">
          <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
          <div className="h-3 bg-gray-200 rounded w-1/2"></div>
        </div>
        <div className="border rounded-lg p-4 bg-gray-50">
          <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
          <div className="h-3 bg-gray-200 rounded w-1/2"></div>
        </div>
      </div>
    </div>
  );
};

export default AgreementsListWrapper;