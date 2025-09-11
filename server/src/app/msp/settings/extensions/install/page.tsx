'use client';

import dynamic from 'next/dynamic';

// Dynamically load the extension install component via @ee alias.
// In CE builds, @ee maps to src/empty; in EE builds, it maps to ee/server/src.
const DynamicInstallExtensionComponent = dynamic(
  () => import('@ee/components/settings/extensions/InstallExtensionSimple'),
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
