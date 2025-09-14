import React from 'react';

// OSS stub implementation for Extensions feature
export const metadata = {
  title: 'Extensions - Enterprise Feature'
};

export default function Page({ params }: { params: { id: string } }) {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-2">Enterprise Feature</h2>
        <p className="text-gray-600">
          Extensions require Enterprise Edition. Please upgrade to access this feature.
        </p>
        <p className="text-sm text-gray-500 mt-2">Extension ID: {params.id}</p>
      </div>
    </div>
  );
}

// Named exports for compatibility
export const ExtensionPage = Page;
export const ExtensionPageMetadata = metadata;
