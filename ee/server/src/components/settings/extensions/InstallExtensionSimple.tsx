'use client';

import React from 'react';
import Link from 'next/link';

/**
 * EE Install Extension Component
 *
 * Simple extension installation UI for Enterprise Edition.
 */
export default function InstallExtensionSimple(props: any) {
  return (
    <div className="p-6">
      <div className="flex items-center mb-6">
        <Link
          href="/msp/settings?tab=extensions"
          className="mr-4 text-gray-500 hover:text-gray-700"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h1 className="text-2xl font-semibold text-gray-900">Install Extension</h1>
      </div>

      <div className="text-center py-8">
        <h3 className="text-lg font-medium text-gray-900 mb-2">Extension Installation</h3>
        <p className="text-gray-600">
          Use the full extension installer for advanced options.
        </p>
      </div>
    </div>
  );
}
