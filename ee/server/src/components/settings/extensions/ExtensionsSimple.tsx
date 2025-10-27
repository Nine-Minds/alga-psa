/**
 * Extensions Management Component
 * 
 * Full extension management interface with working webpack alias imports
 */
'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { fetchInstalledExtensionsV2, toggleExtensionV2, uninstallExtensionV2 } from '@product/actions/extRegistryV2Actions';
import { Extension } from '../../../lib/extensions/types';
import ExtensionDetailsModal from './ExtensionDetailsModal';

// Define local interface to match UI expectations
interface ExtensionUI {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  isEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  tenantId: string;
}

// Helper function to convert Extension to ExtensionUI
const convertExtensionToUI = (ext: Extension): ExtensionUI => ({
  id: ext.id,
  name: ext.name,
  description: ext.description || '',
  version: ext.version,
  author: typeof ext.manifest.author === 'string' 
    ? ext.manifest.author 
    : (ext.manifest.author?.name || 'Unknown'),
  isEnabled: ext.is_enabled,
  createdAt: ext.created_at,
  updatedAt: ext.updated_at,
  tenantId: ext.tenant_id,
});


export default function Extensions() {
  const [extensions, setExtensions] = useState<ExtensionUI[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedExtension, setSelectedExtension] = useState<ExtensionUI | null>(null);
  const [showModal, setShowModal] = useState(false);
  
  // Fetch extensions
  useEffect(() => {
    const loadExtensions = async () => {
      try {
        const v2 = await fetchInstalledExtensionsV2();
        setExtensions(v2.map((r: any) => ({ id: r.id, name: r.name, description: '', version: r.version, author: r.author || 'Unknown', isEnabled: r.is_enabled, createdAt: new Date(), updatedAt: new Date(), tenantId: r.tenant_id })));
        setLoading(false);
      } catch (err) {
        console.error('Failed to fetch extensions', err);
        setError('Failed to load extensions');
        setLoading(false);
      }
    };
    
    void loadExtensions();
  }, []);
  
  // Handle enabling/disabling extensions
  const handleToggleExtension = async (id: string, currentStatus: boolean) => {
    try {
      const result = await toggleExtensionV2(id);
      if (!result.success) {
        alert(result.message);
        return;
      }
      
      // Update local state
      setExtensions(prevExtensions => 
        prevExtensions.map((ext): ExtensionUI => 
          ext.id === id ? { ...ext, isEnabled: !currentStatus } : ext
        )
      );
      
      console.log(`Extension ${currentStatus ? 'disabled' : 'enabled'}`, { id });
    } catch (err) {
      console.error('Failed to toggle extension', { id, error: err });
      alert(`Failed to ${currentStatus ? 'disable' : 'enable'} extension`);
    }
  };
  
  // Handle removing extensions
  const handleRemoveExtension = async (id: string) => {
    if (!confirm('Are you sure you want to remove this extension? This action cannot be undone.')) {
      return;
    }
    
    try {
      const result = await uninstallExtensionV2(id);
      if (!result.success) {
        alert(result.message);
        return;
      }
      
      // Update local state
      setExtensions(prevExtensions => 
        prevExtensions.filter((ext): boolean => ext.id !== id)
      );
      
      console.log('Extension removed', { id });
    } catch (err) {
      console.error('Failed to remove extension', { id, error: err });
      alert('Failed to remove extension');
    }
  };
  
  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold text-gray-900">Extensions</h2>
      </div>
      
      {loading && (
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <span className="ml-3 text-gray-600">Loading extensions...</span>
        </div>
      )}
      
      {error && !loading && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <div className="flex items-start">
            <svg className="h-5 w-5 text-red-600 mr-3 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
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
              {extensions.map((extension): React.ReactElement => (
                <tr key={extension.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div>
                        <div className="text-sm font-medium text-gray-900">
                          <button 
                            onClick={() => {
                              setSelectedExtension(extension);
                              setShowModal(true);
                            }}
                            className="hover:text-blue-600 text-left"
                          >
                            {extension.name}
                          </button>
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
                      <button
                        onClick={() => {
                          setSelectedExtension(extension);
                          setShowModal(true);
                        }}
                        className="inline-flex items-center px-3 py-1 border border-transparent text-xs font-medium rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200"
                      >
                        <svg className="h-3.5 w-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                        View
                      </button>
                      <button
                        onClick={() => alert('Extension settings will be available in the next update.')}
                        className="inline-flex items-center px-3 py-1 border border-transparent text-xs font-medium rounded-md bg-blue-100 text-blue-700 hover:bg-blue-200"
                      >
                        <svg className="h-3.5 w-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        Settings
                      </button>
                      <button
                        onClick={() => void handleToggleExtension(extension.id, extension.isEnabled)}
                        className={`inline-flex items-center px-3 py-1 border border-transparent text-xs font-medium rounded-md ${
                          extension.isEnabled
                            ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                            : 'bg-green-100 text-green-700 hover:bg-green-200'
                        }`}
                      >
                        {extension.isEnabled ? (
                          <>
                            <svg className="h-3.5 w-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            Disable
                          </>
                        ) : (
                          <>
                            <svg className="h-3.5 w-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            Enable
                          </>
                        )}
                      </button>
                      <button
                        onClick={() => void handleRemoveExtension(extension.id)}
                        className="inline-flex items-center px-3 py-1 border border-transparent text-xs font-medium rounded-md bg-red-100 text-red-700 hover:bg-red-200"
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
      
      <ExtensionDetailsModal
        extension={selectedExtension}
        isOpen={showModal}
        onClose={() => {
          setShowModal(false);
          setSelectedExtension(null);
        }}
        onToggle={(id, status) => void handleToggleExtension(id, status)}
        onRemove={(id) => void handleRemoveExtension(id)}
      />
    </div>
  );
}
