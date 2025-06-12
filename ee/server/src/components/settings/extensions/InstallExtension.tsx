/**
 * Install Extension Page
 * 
 * Allows administrators to install new extensions
 */
'use client';

import React, { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ReflectionContainer } from '../../../../../server/src/lib/ui-reflection/ReflectionContainer';
import { useAutomationIdAndRegister } from '../../../../../server/src/lib/ui-reflection/useAutomationIdAndRegister';
import { ContainerComponent } from '../../../../../server/src/lib/ui-reflection/types';
import { ExtensionManifest } from '../../../lib/extensions/types';
import { ChevronLeftIcon, UploadIcon, FilePlus2Icon, AlertCircleIcon, ShieldIcon, CheckCircleIcon } from 'lucide-react';
import { logger } from '../../../../../server/src/utils/logger';
import { installExtension } from '../../../lib/actions/extensionActions';
import { ExtensionPermissions } from './ExtensionPermissions';

/**
 * Install Extension page
 */
export default function InstallExtension() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [uploadState, setUploadState] = useState<'idle' | 'loading' | 'validating' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [manifest, setManifest] = useState<ExtensionManifest | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [installProgress, setInstallProgress] = useState<number>(0);
  
  // Register with Alga's UI automation system
  const { automationIdProps } = useAutomationIdAndRegister<ContainerComponent>({
    id: 'install-extension-page',
    type: 'container',
    label: 'Install Extension',
    variant: 'default'
  });
  
  // Handle file selection
  const handleFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    setFileName(file.name);
    setUploadState('loading');
    setErrorMessage(null);
    setManifest(null);
    
    try {
      // In a real implementation, this would validate the extension package
      // For now, we'll simulate parsing the manifest
      
      // Simulate file reading and processing
      await new Promise(resolve => setTimeout(resolve, 500));
      
      setUploadState('validating');
      
      // Simulate validation
      await new Promise(resolve => setTimeout(resolve, 800));
      
      // For now, create a mock manifest from the file
      // In a real implementation, this would parse the actual extension package
      const mockManifest: ExtensionManifest = {
        id: `uploaded-extension-${Date.now()}`,
        name: file.name.replace(/\.(zip|tgz|tar\.gz)$/i, ''),
        version: '1.0.0',
        description: 'Uploaded extension package',
        author: 'Unknown',
        components: [],
        permissions: ['company:read'],
        settings: []
      };
      setManifest(mockManifest);
      setUploadState('success');
    } catch (err) {
      logger.error('Failed to parse extension package', { fileName: file.name, error: err });
      setErrorMessage('Failed to parse extension package. Please ensure it is a valid extension.');
      setUploadState('error');
    }
  }, []);
  
  // Handle form submission
  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    
    if (!manifest || !fileName) return;
    
    try {
      setInstallProgress(0);
      
      // Simulate installation progress
      const interval = setInterval(() => {
        setInstallProgress(prev => {
          const next = prev + 10;
          if (next >= 100) {
            clearInterval(interval);
            return 100;
          }
          return next;
        });
      }, 300);
      
      // Create form data for the file upload
      const formData = new FormData();
      const fileInput = fileInputRef.current;
      if (fileInput && fileInput.files && fileInput.files[0]) {
        formData.append('extension', fileInput.files[0]);
      }
      
      // Install the extension
      const result = await installExtension(formData);
      
      clearInterval(interval);
      setInstallProgress(100);
      
      if (!result.success) {
        setErrorMessage(result.message);
        setUploadState('error');
        return;
      }
      
      // Redirect to extensions list after successful installation
      setTimeout(() => {
        router.push('/msp/settings/extensions');
      }, 500);
      
      logger.info('Extension installed successfully', { name: manifest.name, version: manifest.version });
    } catch (err) {
      logger.error('Failed to install extension', { name: manifest?.name, error: err });
      setErrorMessage('Failed to install extension. Please try again.');
      setUploadState('error');
    }
  };
  
  return (
    <ReflectionContainer id="install-extension-page" label="Install Extension">
      <div className="p-6" {...automationIdProps}>
        <div className="flex items-center mb-6">
          <Link
            href="/msp/settings/extensions"
            className="mr-4 text-gray-500 hover:text-gray-700"
            data-automation-id="back-button"
          >
            <ChevronLeftIcon className="h-5 w-5" />
          </Link>
          <h1 className="text-2xl font-semibold text-gray-900">Install Extension</h1>
        </div>
        
        <div className="bg-white shadow-sm rounded-lg overflow-hidden border border-gray-200">
          <div className="border-b border-gray-200 bg-gray-50 px-6 py-4">
            <div className="flex items-center">
              <FilePlus2Icon className="h-5 w-5 text-gray-500 mr-2" />
              <h2 className="text-lg font-medium text-gray-900">Upload Extension Package</h2>
            </div>
          </div>
          
          <div className="p-6">
            <form onSubmit={handleSubmit}>
              {/* File upload area */}
              <div className="mb-6">
                <div className={`
                  mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-dashed rounded-md
                  ${uploadState === 'error' ? 'border-red-300' : 'border-gray-300'}
                  ${uploadState === 'success' ? 'border-green-300' : ''}
                `}>
                  <div className="space-y-1 text-center">
                    <div className="flex text-sm text-gray-600">
                      <label
                        htmlFor="file-upload"
                        className="relative cursor-pointer bg-white rounded-md font-medium text-primary-600 hover:text-primary-500 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-primary-500"
                      >
                        <span>Upload a file</span>
                        <input
                          id="file-upload"
                          name="file-upload"
                          type="file"
                          className="sr-only"
                          ref={fileInputRef}
                          onChange={handleFileChange}
                          accept=".zip,.gz,.tgz"
                          disabled={uploadState === 'loading' || uploadState === 'validating' || installProgress > 0}
                          data-automation-id="file-upload-input"
                        />
                      </label>
                      <p className="pl-1">or drag and drop</p>
                    </div>
                    <p className="text-xs text-gray-500">
                      ZIP or TAR.GZ up to 50MB
                    </p>
                    
                    {uploadState === 'loading' && (
                      <div className="flex justify-center items-center mt-2">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
                        <span className="ml-2 text-sm text-gray-600">Uploading...</span>
                      </div>
                    )}
                    
                    {uploadState === 'validating' && (
                      <div className="flex justify-center items-center mt-2">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
                        <span className="ml-2 text-sm text-gray-600">Validating extension...</span>
                      </div>
                    )}
                    
                    {uploadState === 'success' && fileName && (
                      <div className="flex justify-center items-center mt-2 text-green-600">
                        <CheckCircleIcon className="h-5 w-5 mr-1.5" />
                        <span className="text-sm">{fileName} ready to install</span>
                      </div>
                    )}
                    
                    {uploadState === 'error' && errorMessage && (
                      <div className="flex justify-center items-center mt-2 text-red-600">
                        <AlertCircleIcon className="h-5 w-5 mr-1.5" />
                        <span className="text-sm">{errorMessage}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              
              {/* Extension manifest details */}
              {manifest && (
                <div className="mt-6 border border-gray-200 rounded-md overflow-hidden">
                  <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
                    <h3 className="text-sm font-medium text-gray-700">Extension Details</h3>
                  </div>
                  
                  <div className="p-4">
                    <dl className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        <dt className="text-sm font-medium text-gray-500">Name</dt>
                        <dd className="mt-1 text-sm text-gray-900">{manifest.name}</dd>
                      </div>
                      
                      <div className="sm:col-span-2">
                        <dt className="text-sm font-medium text-gray-500">Description</dt>
                        <dd className="mt-1 text-sm text-gray-900">{manifest.description}</dd>
                      </div>
                      
                      <div>
                        <dt className="text-sm font-medium text-gray-500">Version</dt>
                        <dd className="mt-1 text-sm text-gray-900">{manifest.version}</dd>
                      </div>
                      
                      <div>
                        <dt className="text-sm font-medium text-gray-500">Author</dt>
                        <dd className="mt-1 text-sm text-gray-900">
                          {typeof manifest.author === 'string' 
                            ? manifest.author 
                            : (manifest.author?.name || 'Unknown')}
                        </dd>
                      </div>
                      
                      <div className="sm:col-span-2">
                        <dt className="text-sm font-medium text-gray-500">Components</dt>
                        <dd className="mt-1 text-xs text-gray-700">
                          <ul className="list-disc pl-5 space-y-1">
                            {manifest.components?.map((component, index) => (
                              <li key={index}>
                                <span className="font-medium">{component.type}</span>: {component.id}
                              </li>
                            ))}
                          </ul>
                        </dd>
                      </div>
                      
                      <div className="sm:col-span-2">
                        <dt className="text-sm font-medium text-gray-500">Required Permissions</dt>
                        <dd className="mt-1">
                          {manifest.permissions && manifest.permissions.length > 0 ? (
                            <ExtensionPermissions permissions={manifest.permissions} compact={true} />
                          ) : (
                            <p className="text-sm text-gray-500">This extension does not require any permissions.</p>
                          )}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </div>
              )}
              
              {/* Installation progress */}
              {installProgress > 0 && (
                <div className="mt-6">
                  <h3 className="text-sm font-medium text-gray-700 mb-2">Installing Extension</h3>
                  <div className="w-full bg-gray-200 rounded-full h-2.5">
                    <div 
                      className="bg-primary-600 h-2.5 rounded-full" 
                      style={{ width: `${installProgress}%` }}
                    ></div>
                  </div>
                  <p className="mt-2 text-sm text-gray-600">
                    {installProgress < 100 
                      ? `Installing extension... ${installProgress}%` 
                      : 'Installation complete. Redirecting...'}
                  </p>
                </div>
              )}
              
              {/* Action buttons */}
              <div className="mt-6 flex justify-end">
                <Link
                  href="/msp/settings/extensions"
                  className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 mr-3"
                  data-automation-id="cancel-button"
                >
                  Cancel
                </Link>
                <button
                  type="submit"
                  disabled={!manifest || installProgress > 0}
                  className={`inline-flex justify-center items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white ${
                    !manifest || installProgress > 0
                      ? 'bg-gray-400 cursor-not-allowed'
                      : 'bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500'
                  }`}
                  data-automation-id="install-button"
                >
                  <UploadIcon className="h-4 w-4 mr-1.5" />
                  Install Extension
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </ReflectionContainer>
  );
}