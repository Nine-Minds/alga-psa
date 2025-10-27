/**
 * Extension Details Page
 * 
 * Shows detailed information about an extension and allows configuration
 */
'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { useAutomationIdAndRegister } from 'server/src/types/ui-reflection/useAutomationIdAndRegister';
import { ContainerComponent } from 'server/src/types/ui-reflection/types';
import { Extension } from '../../../lib/extensions/types';
import { ChevronLeftIcon, InfoIcon, SettingsIcon, PackageIcon, ShieldIcon, AlertCircleIcon, CheckCircleIcon, XCircleIcon } from 'lucide-react';
import { toast } from 'react-hot-toast';
// Fallback to console for logging in EE components
import { fetchExtensionById, toggleExtension, uninstallExtension } from '@product/actions/extensionActions';
import { ExtensionPermissions } from './ExtensionPermissions';
import { getInstallInfo, reprovisionExtension } from '@product/actions/extensionDomainActions';

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
  type RunnerStatus = { state?: string } | null;
  const [installInfo, setInstallInfo] = useState<{ domain: string | null; status: RunnerStatus } | null>(null);
  
  // Register with Alga's UI automation system
  const { automationIdProps } = useAutomationIdAndRegister<ContainerComponent>({
    id: `extension-details-${extensionId}`,
    type: 'container',
    label: 'Extension Details'
  });
  
  // Fetch extension details
  useEffect(() => {
    const fetchExtensionDetails = async () => {
      try {
        const foundExtension = await fetchExtensionById(extensionId);
        setExtension(foundExtension);
        setLoading(false);
        if (foundExtension) {
          const info = await getInstallInfo(extensionId).catch(() => null);
          if (info) {
            const domain = typeof info.runner_domain === 'string' ? info.runner_domain : null;
            const rawStatus: unknown = info.runner_status;
            let status: RunnerStatus = null;
            if (rawStatus && typeof rawStatus === 'object') {
              const maybe = rawStatus as { state?: unknown };
              status = typeof maybe.state === 'string' ? { state: maybe.state } : {};
            }
            setInstallInfo({ domain, status });
          }
        }
      } catch (err) {
        console.error('Failed to fetch extension details', { extensionId, error: err });
        setError('Failed to load extension details');
        setLoading(false);
      }
    };
    
    void fetchExtensionDetails();
  }, [extensionId]);
  
  // Handle toggling extension
  const handleToggleExtension = async () => {
    if (!extension) return;
    
    try {
      const result = await toggleExtension(extensionId);
      if (!result.success) {
        toast.error(result.message || 'Failed to update extension state');
        return;
      }
      
      // Update local state
      setExtension(prevExtension => 
        prevExtension ? { ...prevExtension, is_enabled: !prevExtension.is_enabled } : null
      );
      
      console.info(`Extension ${extension.is_enabled ? 'disabled' : 'enabled'}`, { extensionId });
    } catch (err) {
      console.error('Failed to toggle extension', { extensionId, error: err });
      toast.error(`Failed to ${extension.is_enabled ? 'disable' : 'enable'} extension`);
    }
  };

  const handleReprovision = async () => {
    try {
      const result = await reprovisionExtension(extensionId);
      setInstallInfo({ domain: result.domain || null, status: { state: 'provisioning' } });
    } catch (_e) {
      toast.error('Failed to reprovision');
    }
  };
  
  // Handle removing extension
  const handleRemoveExtension = async () => {
    if (!confirm('Are you sure you want to remove this extension? This action cannot be undone.')) {
      return;
    }
    
    try {
      const result = await uninstallExtension(extensionId);
      if (!result.success) {
        toast.error(result.message || 'Failed to remove extension');
        return;
      }
      
      console.info('Extension removed', { extensionId });
      toast.success('Extension removed');
      
      // Navigate back to extensions list
      router.push('/msp/settings/extensions');
    } catch (err) {
      console.error('Failed to remove extension', { extensionId, error: err });
      toast.error('Failed to remove extension');
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
                extension.is_enabled 
                  ? 'bg-green-100 text-green-800' 
                  : 'bg-gray-100 text-gray-800'
                }`}>
                {extension.is_enabled ? 'Enabled' : 'Disabled'}
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
                onClick={() => { void handleToggleExtension(); }}
                className={`inline-flex items-center px-3 py-1.5 border border-transparent shadow-sm text-sm font-medium rounded-md text-white ${
                  extension.is_enabled
                    ? 'bg-amber-600 hover:bg-amber-700 focus:ring-amber-500'
                    : 'bg-green-600 hover:bg-green-700 focus:ring-green-500'
                } focus:outline-none focus:ring-2 focus:ring-offset-2`}
                data-automation-id="toggle-extension-button"
              >
                {extension.is_enabled ? (
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
                onClick={() => { void handleRemoveExtension(); }}
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
                  <div className="mb-6">
                    <div className="text-sm font-medium text-gray-500">Runtime Domain</div>
                    <div className="mt-1 text-sm text-gray-900">{installInfo?.domain || '—'}</div>
                    <div className="text-xs text-gray-500">{installInfo?.status?.state ? String(installInfo?.status?.state) : ''}</div>
                    <div className="mt-2 flex gap-2">
                      {installInfo?.domain ? (
                        <>
                          <a
                            href={`https://${installInfo.domain}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md bg-green-100 text-green-700 hover:bg-green-200"
                          >
                            Open
                          </a>
                          <button
                            onClick={() => { void navigator.clipboard.writeText(`https://${installInfo.domain}`); }}
                            className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200"
                          >
                            Copy
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => { void handleReprovision(); }}
                          className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md bg-amber-100 text-amber-700 hover:bg-amber-200"
                        >
                          Provision
                        </button>
                      )}
                    </div>
                  </div>
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
                      <dd className="mt-1 text-sm text-gray-900">
                        {typeof extension.manifest.author === 'string' 
                          ? extension.manifest.author 
                          : (extension.manifest.author?.name || 'Unknown')}
                      </dd>
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
                      <dd className="mt-1 text-sm text-gray-900">{extension.created_at.toLocaleDateString()}</dd>
                    </div>
                    
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Last Updated</dt>
                      <dd className="mt-1 text-sm text-gray-900">{extension.updated_at.toLocaleDateString()}</dd>
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
                  {Array.isArray(extension.manifest.components) && extension.manifest.components.length > 0 ? (
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
                          {(
                            extension.manifest.components as Array<Record<string, unknown>>
                          ).map((component, index) => {
                            const type = typeof (component as any).type === 'string' ? ((component as any).type as string) : '-';
                            const id = typeof (component as any).id === 'string' ? ((component as any).id as string) : '-';
                            const entryPoint = typeof (component as any).entryPoint === 'string' ? ((component as any).entryPoint as string) : '-';
                            const mountPoint = typeof (component as any).mountPoint === 'string' ? ((component as any).mountPoint as string) : '-';
                            return (
                              <tr key={index}>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{type}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{id}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{entryPoint}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{mountPoint}</td>
                              </tr>
                            );
                          })}
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
                        This extension was installed on {extension.created_at.toLocaleDateString()} and last updated on {extension.updated_at.toLocaleDateString()}.
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
