'use client';

import dynamic from 'next/dynamic';
import React from 'react';

const DynamicExtensionDetails = dynamic(
  () => import('@product/settings-extensions/entry').then((mod) => mod.ExtensionDetails),
  {
    ssr: false,
    loading: () => <div className="flex items-center justify-center h-64 text-gray-500">Loading extension...</div>,
  }
);

export default function ExtensionDetailsPage() {
  return <DynamicExtensionDetails />;
}
