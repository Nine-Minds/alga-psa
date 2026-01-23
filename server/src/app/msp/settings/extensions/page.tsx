'use client';

import dynamic from 'next/dynamic';
import React from 'react';

const DynamicExtensions = dynamic(
  () => import('@product/settings-extensions/entry').then((mod) => mod.Extensions),
  {
    ssr: false,
    loading: () => <div className="flex items-center justify-center h-64 text-gray-500">Loading extensions...</div>,
  }
);

export default function ExtensionsPage() {
  return <DynamicExtensions />;
}
