'use client';

import dynamic from 'next/dynamic';

// Dynamically load the extension install component using the stable package path
const DynamicInstallExtensionComponent = dynamic(
  () => import('@product/settings-extensions/entry').then(mod => mod.InstallExtensionSimple),
  {
    ssr: false,
    loading: () => (
      <div className="flex justify-center items-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-3 text-gray-600">Loading...</span>
      </div>
    ),
  }
);

export default function InstallExtensionPage() {
  return <DynamicInstallExtensionComponent />;
}
