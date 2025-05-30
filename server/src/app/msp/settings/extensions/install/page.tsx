import dynamic from 'next/dynamic';

// Dynamically load the extension install component from EE
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
  // Check if EE is available
  const isEE = process.env.NEXT_PUBLIC_EDITION === 'enterprise';
  
  if (!isEE) {
    return (
      <div className="p-6">
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
          <h3 className="text-lg font-medium text-gray-900 mb-2">Extensions Not Available</h3>
          <p className="text-gray-600">
            Extensions are only available in the Enterprise Edition of Alga PSA.
          </p>
        </div>
      </div>
    );
  }
  
  return <DynamicInstallExtensionComponent />;
}