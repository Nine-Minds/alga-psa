/**
 * Extensions Management Page
 * 
 * Allows administrators to view, enable, disable, and remove extensions
 */
'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { ReflectionContainer } from '@/lib/ui-reflection/ReflectionContainer';
import { useAutomationIdAndRegister } from '@/lib/ui-reflection/useAutomationIdAndRegister';
import { ContainerComponent } from '@/lib/ui-reflection/types';
import { Extension } from '@/lib/extensions/types';
import { PlusIcon, AlertCircleIcon, CheckCircleIcon, XCircleIcon, Settings, EyeIcon } from 'lucide-react';
import { logger } from '@/utils/logger';
import { mockExtensionData } from './mock-data';

/**
 * Extensions management page
 */
export default function Extensions() {
  const [extensions, setExtensions] = useState<Extension[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Register with Alga's UI automation system
  const { automationIdProps } = useAutomationIdAndRegister<ContainerComponent>({
    id: 'extensions-page',
    type: 'container',
    label: 'Extensions Management',
    variant: 'default'
  });
  
  // Fetch extensions
  useEffect(() => {
    const fetchExtensions = async () => {
      try {
        // In a real implementation, this would fetch from an API endpoint
        // For example: /api/extensions
        
        // For now, we'll use the mock data
        await new Promise(resolve => setTimeout(resolve, 300));
        setExtensions(mockExtensionData);
        setLoading(false);
      } catch (err) {
        logger.error('Failed to fetch extensions', { error: err });
        setError('Failed to load extensions');
        setLoading(false);
      }
    };
    
    fetchExtensions();
  }, []);
  
  // Handle enabling/disabling extensions
  const handleToggleExtension = async (id: string, currentStatus: boolean) => {
    try {
      // In a real implementation, this would call an API endpoint
      // For example: /api/extensions/${id}/toggle
      
      // For now, we'll use a placeholder implementation
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Update local state
      setExtensions(prevExtensions => 
        prevExtensions.map(ext => 
          ext.id === id ? { ...ext, isEnabled: !currentStatus } : ext
        )
      );
      
      logger.info(`Extension ${currentStatus ? 'disabled' : 'enabled'}`, { id });
    } catch (err) {
      logger.error('Failed to toggle extension', { id, error: err });
      alert(`Failed to ${currentStatus ? 'disable' : 'enable'} extension`);
    }
  };
  
  // Handle removing extensions
  const handleRemoveExtension = async (id: string) => {
    if (!confirm('Are you sure you want to remove this extension? This action cannot be undone.')) {
      return;
    }
    
    try {
      // In a real implementation, this would call an API endpoint
      // For example: /api/extensions/${id}
      
      // For now, we'll use a placeholder implementation
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Update local state
      setExtensions(prevExtensions => 
        prevExtensions.filter(ext => ext.id !== id)
      );
      
      logger.info('Extension removed', { id });
    } catch (err) {
      logger.error('Failed to remove extension', { id, error: err });
      alert('Failed to remove extension');
    }
  };
  
  return (
    <ReflectionContainer id="extensions-page" label="Extensions Management">
      <div className="p-6" {...automationIdProps}>
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-semibold text-gray-900">Extensions</h1>
          <Link
            href="/msp/settings/extensions/install"
            className="px-4 py-2 bg-primary-600 text-white rounded-md flex items-center gap-2 hover:bg-primary-700 transition-colors"
            data-automation-id="add-extension-button"
          >
            <PlusIcon className="h-4 w-4" />
            <span>Add Extension</span>
          </Link>
        </div>
        
        {loading && (
          <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            <span className="ml-3 text-gray-600">Loading extensions...</span>
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
        
        {!loading && !error && extensions.length === 0 && (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
            <h3 className="text-lg font-medium text-gray-900 mb-2">No extensions installed</h3>
            <p className="text-gray-600 mb-4">
              Install extensions to add new features and functionality to Alga PSA.
            </p>
            <Link
              href="/msp/settings/extensions/install"
              className="px-4 py-2 bg-primary-600 text-white rounded-md inline-flex items-center gap-2 hover:bg-primary-700 transition-colors"
            >
              <PlusIcon className="h-4 w-4" />
              <span>Add Extension</span>
            </Link>
          </div>
        )}
        
        {!loading && !error && extensions.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Extension
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Version
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Author
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {extensions.map((extension) => (
                  <tr key={extension.id} data-automation-id={`extension-row-${extension.id}`}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div>
                          <div className="text-sm font-medium text-gray-900">
                            <Link href={`/msp/settings/extensions/${extension.id}`} className="hover:text-primary-600">
                              {extension.name}
                            </Link>
                          </div>
                          <div className="text-sm text-gray-500">
                            {extension.description}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{extension.version}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{extension.author || 'Unknown'}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        extension.isEnabled 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-gray-100 text-gray-800'
                      }`}>
                        {extension.isEnabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex justify-end space-x-2">
                        <Link
                          href={`/msp/settings/extensions/${extension.id}`}
                          className="inline-flex items-center px-3 py-1 border border-transparent text-xs font-medium rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                          data-automation-id={`extension-view-${extension.id}`}
                        >
                          <EyeIcon className="h-3.5 w-3.5 mr-1" />
                          View
                        </Link>
                        <Link
                          href={`/msp/settings/extensions/${extension.id}/settings`}
                          className="inline-flex items-center px-3 py-1 border border-transparent text-xs font-medium rounded-md bg-blue-100 text-blue-700 hover:bg-blue-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                          data-automation-id={`extension-settings-${extension.id}`}
                        >
                          <Settings className="h-3.5 w-3.5 mr-1" />
                          Settings
                        </Link>
                        <button
                          onClick={() => handleToggleExtension(extension.id, extension.isEnabled)}
                          className={`inline-flex items-center px-3 py-1 border border-transparent text-xs font-medium rounded-md ${
                            extension.isEnabled
                              ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                              : 'bg-green-100 text-green-700 hover:bg-green-200'
                          } focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500`}
                          data-automation-id={`extension-toggle-${extension.id}`}
                        >
                          {extension.isEnabled ? (
                            <>
                              <XCircleIcon className="h-3.5 w-3.5 mr-1" />
                              Disable
                            </>
                          ) : (
                            <>
                              <CheckCircleIcon className="h-3.5 w-3.5 mr-1" />
                              Enable
                            </>
                          )}
                        </button>
                        <button
                          onClick={() => handleRemoveExtension(extension.id)}
                          className="inline-flex items-center px-3 py-1 border border-transparent text-xs font-medium rounded-md bg-red-100 text-red-700 hover:bg-red-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                          data-automation-id={`extension-remove-${extension.id}`}
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </ReflectionContainer>
  );
}