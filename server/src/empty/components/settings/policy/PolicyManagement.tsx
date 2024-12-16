import React from 'react';

const PolicyManagement: React.FC = () => {
  return (
    <div className="p-4 border rounded-lg bg-gray-50">
      <h3 className="text-lg font-semibold text-gray-900">Policy Management</h3>
      <p className="mt-2 text-gray-600">
        Policy Management is only available in Enterprise Edition. Please upgrade to access advanced policy management features.
      </p>
      <a
        href="https://example.com/upgrade"
        className="mt-4 inline-block px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
      >
        Learn More About Enterprise Edition
      </a>
    </div>
  );
};

export default PolicyManagement;
