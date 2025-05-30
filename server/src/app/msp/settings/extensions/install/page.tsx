import dynamic from 'next/dynamic';

// Dynamically load the extension install component from EE with fallback
const DynamicInstallExtensionComponent = dynamic(
  () => import('@ee/components/settings/extensions/InstallExtensionSimple').catch(() => 
    import('../../../../../empty/components/settings/extensions/InstallExtensionSimple')
  ),
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