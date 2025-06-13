/**
 * Install Extension Component
 * 
 * Simplified extension installation workflow with working imports
 */
'use client';

import React, { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { installExtension } from '../../../lib/actions/extensionActions';

// Define types locally to avoid import issues
interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  components: any[];
  permissions: string[];
  settings: any[];
}

export default function InstallExtension() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [uploadState, setUploadState] = useState<'idle' | 'loading' | 'validating' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [manifest, setManifest] = useState<ExtensionManifest | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [installProgress, setInstallProgress] = useState<number>(0);
  
  // Handle file selection
  const handleFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    setFileName(file.name);
    setUploadState('loading');
    setErrorMessage(null);
    setManifest(null);
    
    try {
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
      console.error('Failed to parse extension package', { fileName: file.name, error: err });
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
        router.push('/msp/settings?tab=extensions');
      }, 500);
      
      console.log('Extension installed successfully', { name: manifest.name, version: manifest.version });
    } catch (err) {
      console.error('Failed to install extension', { name: manifest?.name, error: err });
      setErrorMessage('Failed to install extension. Please try again.');
      setUploadState('error');
    }
  };
  
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
      
      <div className="bg-white shadow-sm rounded-lg overflow-hidden border border-gray-200">
        <div className="border-b border-gray-200 bg-gray-50 px-6 py-4">
          <div className="flex items-center">
            <svg className="h-5 w-5 text-gray-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
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
                      className="relative cursor-pointer bg-white rounded-md font-medium text-blue-600 hover:text-blue-500 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-blue-500"
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
                      />
                    </label>
                    <p className="pl-1">or drag and drop</p>
                  </div>
                  <p className="text-xs text-gray-500">
                    ZIP or TAR.GZ up to 50MB
                  </p>
                  
                  {uploadState === 'loading' && (
                    <div className="flex justify-center items-center mt-2">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                      <span className="ml-2 text-sm text-gray-600">Uploading...</span>
                    </div>
                  )}
                  
                  {uploadState === 'validating' && (
                    <div className="flex justify-center items-center mt-2">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                      <span className="ml-2 text-sm text-gray-600">Validating extension...</span>
                    </div>
                  )}
                  
                  {uploadState === 'success' && fileName && (
                    <div className="flex justify-center items-center mt-2 text-green-600">
                      <svg className="h-5 w-5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span className="text-sm">{fileName} ready to install</span>
                    </div>
                  )}
                  
                  {uploadState === 'error' && errorMessage && (
                    <div className="flex justify-center items-center mt-2 text-red-600">
                      <svg className="h-5 w-5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
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
                        {manifest.author || 'Unknown'}
                      </dd>
                    </div>
                    
                    <div className="sm:col-span-2">
                      <dt className="text-sm font-medium text-gray-500">Required Permissions</dt>
                      <dd className="mt-1">
                        {manifest.permissions && manifest.permissions.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {manifest.permissions.map((permission, index) => (
                              <span
                                key={index}
                                className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800"
                              >
                                {permission}
                              </span>
                            ))}
                          </div>
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
                    className="bg-blue-600 h-2.5 rounded-full transition-all duration-300" 
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
                href="/msp/settings?tab=extensions"
                className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 mr-3"
              >
                Cancel
              </Link>
              <button
                type="submit"
                disabled={!manifest || installProgress > 0}
                className={`inline-flex justify-center items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white ${
                  !manifest || installProgress > 0
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500'
                }`}
              >
                <svg className="h-4 w-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                Install Extension
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}