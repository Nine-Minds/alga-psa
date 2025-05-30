/**
 * Extension Details Page
 * 
 * Shows detailed information about an extension and allows configuration
 */
'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ReflectionContainer } from '@/lib/ui-reflection/ReflectionContainer';
import { useAutomationIdAndRegister } from '@/lib/ui-reflection/useAutomationIdAndRegister';
import { ContainerComponent } from '@/lib/ui-reflection/types';
import { Extension } from '@/lib/extensions/types';
import { ChevronLeftIcon, InfoIcon, SettingsIcon, PackageIcon, ShieldIcon, AlertCircleIcon, CheckCircleIcon, XCircleIcon } from 'lucide-react';
import { logger } from '@/utils/logger';
import { mockExtensionData } from './mock-data';
import { ExtensionPermissions } from './ExtensionPermissions';

/**
 * Extension Details page
 */
export default function ExtensionDetails() {
  const params = useParams();
  const router = useRouter();
  const extensionId = params.id as string;
  
  const [extension, setExtension] = useState<Extension | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Register with Alga's UI automation system
  const { automationIdProps } = useAutomationIdAndRegister<ContainerComponent>({
    id: `extension-details-${extensionId}`,
    type: 'container',
    label: 'Extension Details',
    variant: 'default'
  });
  
  // Fetch extension details
  useEffect(() => {
    const fetchExtensionDetails = async () => {
      try {
        // In a real implementation, this would fetch from an API endpoint
        // For example: /api/extensions/${extensionId}
        
        // For now, we'll use the mock data
        await new Promise(resolve => setTimeout(resolve, 300));
        const foundExtension = mockExtensionData.find(ext => ext.id === extensionId) || null;
        setExtension(foundExtension);
        setLoading(false);
      } catch (err) {
        logger.error('Failed to fetch extension details', { extensionId, error: err });
        setError('Failed to load extension details');
        setLoading(false);
      }
    };
    
    fetchExtensionDetails();
  }, [extensionId]);
  
  // Handle toggling extension
  const handleToggleExtension = async () => {
    if (!extension) return;
    
    try {
      // In a real implementation, this would call an API endpoint
      // For example: /api/extensions/${extensionId}/toggle
      
      // For now, we'll use a placeholder implementation
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Update local state
      setExtension(prevExtension => 
        prevExtension ? { ...prevExtension, isEnabled: !prevExtension.isEnabled } : null
      );
      
      logger.info(`Extension ${extension.isEnabled ? 'disabled' : 'enabled'}`, { extensionId });
    } catch (err) {
      logger.error('Failed to toggle extension', { extensionId, error: err });
      alert(`Failed to ${extension.isEnabled ? 'disable' : 'enable'} extension`);
    }
  };
  
  // Handle removing extension
  const handleRemoveExtension = async () => {
    if (!confirm('Are you sure you want to remove this extension? This action cannot be undone.')) {
      return;
    }
    
    try {
      // In a real implementation, this would call an API endpoint
      // For example: /api/extensions/${extensionId}
      
      // For now, we'll use a placeholder implementation
      await new Promise(resolve => setTimeout(resolve, 300));
      
      logger.info('Extension removed', { extensionId });
      
      // Navigate back to extensions list
      router.push('/msp/settings/extensions');
    } catch (err) {
      logger.error('Failed to remove extension', { extensionId, error: err });
      alert('Failed to remove extension');
    }
  };
  
  return (
    <ReflectionContainer id={`extension-details-${extensionId}`} label="Extension Details">
      <div className="p-6" {...automationIdProps}>
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center">
            <Link
              href="/msp/settings/extensions"
              className="mr-4 text-gray-500 hover:text-gray-700"
              data-automation-id="back-button"
            >
              <ChevronLeftIcon className="h-5 w-5" />
            </Link>
            <h1 className="text-2xl font-semibold text-gray-900">
              {loading ? 'Extension Details' : extension?.name || 'Extension Not Found'}
            </h1>
            {extension && (
              <span className={`ml-3 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                extension.isEnabled 
                  ? 'bg-green-100 text-green-800' 
                  : 'bg-gray-100 text-gray-800'
              }`}>
                {extension.isEnabled ? 'Enabled' : 'Disabled'}
              </span>
            )}
          </div>
          
          {extension && (
            <div className="flex gap-2">
              <Link
                href={`/msp/settings/extensions/${extensionId}/settings`}
                className="inline-flex items-center px-3 py-1.5 border border-gray-300 shadow-sm text-sm font-medium rounded-md bg-white text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                data-automation-id="extension-settings-link"
              >
                <SettingsIcon className="h-4 w-4 mr-1.5" />
                Settings
              </Link>
              
              <button
                onClick={handleToggleExtension}
                className={`inline-flex items-center px-3 py-1.5 border border-transparent shadow-sm text-sm font-medium rounded-md text-white ${
                  extension.isEnabled
                    ? 'bg-amber-600 hover:bg-amber-700 focus:ring-amber-500'
                    : 'bg-green-600 hover:bg-green-700 focus:ring-green-500'
                } focus:outline-none focus:ring-2 focus:ring-offset-2`}
                data-automation-id="toggle-extension-button"
              >
                {extension.isEnabled ? (
                  <>
                    <XCircleIcon className="h-4 w-4 mr-1.5" />
                    Disable
                  </>
                ) : (
                  <>
                    <CheckCircleIcon className="h-4 w-4 mr-1.5" />
                    Enable
                  </>
                )}
              </button>
              
              <button
                onClick={handleRemoveExtension}
                className="inline-flex items-center px-3 py-1.5 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                data-automation-id="remove-extension-button"
              >
                Remove
              </button>
            </div>
          )}
        </div>
        
        {loading && (
          <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            <span className="ml-3 text-gray-600">Loading extension details...</span>
          </div>
        )}
        
        {error && !loading && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <div className="flex items-start">
              <AlertCircleIcon className="h-5 w-5 text-red-600 mr-3 mt-0.5" />
              <div>
                <h3 className="text-sm font-medium text-red-800">Error</h3>
                <p className="text-sm text-red-700 mt-1">{error}</p>
              </div>
            </div>
          </div>
        )}
        
        {!loading && !error && extension && (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            {/* Left column - Extension details */}
            <div className="lg:col-span-3">
              <div className="bg-white shadow-sm rounded-lg overflow-hidden border border-gray-200">
                {/* Header */}
                <div className="border-b border-gray-200 bg-gray-50 px-6 py-4">
                  <div className="flex items-center">
                    <PackageIcon className="h-5 w-5 text-gray-500 mr-2" />
                    <h2 className="text-lg font-medium text-gray-900">Extension Information</h2>
                  </div>
                </div>
                
                {/* Content */}
                <div className="p-6">
                  <dl className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <dt className="text-sm font-medium text-gray-500">Description</dt>
                      <dd className="mt-1 text-sm text-gray-900">{extension.description}</dd>
                    </div>
                    
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Version</dt>
                      <dd className="mt-1 text-sm text-gray-900">{extension.version}</dd>
                    </div>
                    
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Author</dt>
                      <dd className="mt-1 text-sm text-gray-900">{extension.author || 'Unknown'}</dd>
                    </div>
                    
                    {extension.manifest.homepage && (
                      <div>
                        <dt className="text-sm font-medium text-gray-500">Homepage</dt>
                        <dd className="mt-1 text-sm text-gray-900">
                          <a 
                            href={extension.manifest.homepage} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-primary-600 hover:text-primary-800"
                          >
                            {extension.manifest.homepage}
                          </a>
                        </dd>
                      </div>
                    )}
                    
                    {extension.manifest.license && (
                      <div>
                        <dt className="text-sm font-medium text-gray-500">License</dt>
                        <dd className="mt-1 text-sm text-gray-900">{extension.manifest.license}</dd>
                      </div>
                    )}
                    
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Installed Date</dt>
                      <dd className="mt-1 text-sm text-gray-900">{extension.createdAt.toLocaleDateString()}</dd>
                    </div>
                    
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Last Updated</dt>
                      <dd className="mt-1 text-sm text-gray-900">{extension.updatedAt.toLocaleDateString()}</dd>
                    </div>
                  </dl>
                </div>
              </div>
              
              {/* Permissions section */}
              <div className="bg-white shadow-sm rounded-lg overflow-hidden border border-gray-200 mt-6">
                <div className="border-b border-gray-200 bg-gray-50 px-6 py-4">
                  <div className="flex items-center">
                    <ShieldIcon className="h-5 w-5 text-gray-500 mr-2" />
                    <h2 className="text-lg font-medium text-gray-900">Permissions</h2>
                  </div>
                </div>
                <div className="p-6">
                  {extension.manifest.permissions && extension.manifest.permissions.length > 0 ? (
                    <ExtensionPermissions permissions={extension.manifest.permissions} />
                  ) : (
                    <p className="text-sm text-gray-500">This extension does not require any permissions.</p>
                  )}
                </div>
              </div>
              
              {/* Components section */}
              <div className="bg-white shadow-sm rounded-lg overflow-hidden border border-gray-200 mt-6">
                <div className="border-b border-gray-200 bg-gray-50 px-6 py-4">
                  <div className="flex items-center">
                    <div className="flex items-center">
                      <h2 className="text-lg font-medium text-gray-900">Components</h2>
                    </div>
                  </div>
                </div>
                <div className="p-6">
                  {extension.manifest.components && extension.manifest.components.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Type
                            </th>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              ID
                            </th>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Entry Point
                            </th>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Mount Point
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {extension.manifest.components.map((component, index) => (
                            <tr key={index}>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                {component.type}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                {component.id}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                {component.entryPoint}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                {component.mountPoint || '-'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">This extension does not define any components.</p>
                  )}
                </div>
              </div>
            </div>
            
            {/* Right column - Info panel */}
            <div className="lg:col-span-1">
              <div className="bg-blue-50 rounded-lg border border-blue-200 p-4">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <InfoIcon className="h-5 w-5 text-blue-600" />
                  </div>
                  <div className="ml-3">
                    <h3 className="text-sm font-medium text-blue-800">Extension Information</h3>
                    <div className="mt-2 text-sm text-blue-700">
                      <p>
                        This extension was installed on {extension.createdAt.toLocaleDateString()} and last updated on {extension.updatedAt.toLocaleDateString()}.
                      </p>
                      <p className="mt-2">
                        Enabling or disabling the extension may require a page refresh for changes to take effect.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
              
              {extension.manifest.settings && extension.manifest.settings.length > 0 && (
                <div className="bg-white shadow-sm rounded-lg overflow-hidden border border-gray-200 mt-6">
                  <div className="border-b border-gray-200 bg-gray-50 px-6 py-4">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center">
                        <SettingsIcon className="h-5 w-5 text-gray-500 mr-2" />
                        <h2 className="text-lg font-medium text-gray-900">Settings</h2>
                      </div>
                    </div>
                  </div>
                  <div className="p-6">
                    <p className="text-sm text-gray-500 mb-4">
                      This extension has {extension.manifest.settings.length} configurable {extension.manifest.settings.length === 1 ? 'setting' : 'settings'}.
                    </p>
                    <Link
                      href={`/msp/settings/extensions/${extensionId}/settings`}
                      className="w-full inline-flex justify-center items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md bg-white text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                      data-automation-id="go-to-settings-button"
                    >
                      <SettingsIcon className="h-4 w-4 mr-1.5" />
                      Manage Settings
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </ReflectionContainer>
  );
}