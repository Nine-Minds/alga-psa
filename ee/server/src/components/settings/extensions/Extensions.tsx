/**
 * Extensions Management Page
 * 
 * Allows administrators to view, enable, disable, and remove extensions
 */
'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { useAutomationIdAndRegister } from 'server/src/types/ui-reflection/useAutomationIdAndRegister';
import { ContainerComponent } from 'server/src/types/ui-reflection/types';
import { Extension } from '../../../lib/extensions/types';
import { PlusIcon, AlertCircleIcon, CheckCircleIcon, XCircleIcon, Settings, EyeIcon } from 'lucide-react';
import { fetchInstalledExtensionsV2, toggleExtensionV2, uninstallExtensionV2, getBundleInfoForInstall } from '../../../lib/actions/extRegistryV2Actions';
import { getInstallInfo, reprovisionExtension } from '../../../lib/actions/extensionDomainActions';

/**
 * Extensions management page
 */
export default function Extensions() {
  const [extensions, setExtensions] = useState<Extension[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [installInfo, setInstallInfo] = useState<Record<string, { domain: string | null; status: any }>>({});
  const [bundleKeys, setBundleKeys] = useState<Record<string, string>>({});
  
  // Register with Alga's UI automation system
  const { automationIdProps } = useAutomationIdAndRegister<ContainerComponent>({
    id: 'extensions-page',
    type: 'container',
    label: 'Extensions Management'
  });
  
  // Fetch extensions
  useEffect(() => {
    const fetchExtensionsData = async () => {
      try {
        const v2 = await fetchInstalledExtensionsV2();
        const mapped = (v2 as any).map((r: any) => ({ id: r.id, name: r.name, description: '', version: r.version, manifest: { name: r.name, version: r.version, author: r.author, main: '' } as any, is_enabled: r.is_enabled }));
        setExtensions(mapped as any);
        // Kick off per-extension install info fetches (after setting extensions)
        const entries = await Promise.all(
          mapped.map(async (ext: any) => {
            const info = await getInstallInfo(ext.id).catch(() => null);
            return [ext.id, { domain: info?.runner_domain ?? null, status: info?.runner_status ?? null }];
          })
        );
        setInstallInfo(Object.fromEntries(entries));
        // Fetch bundle storage key per extension
        const bundleEntries = await Promise.all(
          mapped.map(async (ext: any) => {
            const b = await getBundleInfoForInstall(ext.id).catch(() => null);
            return [ext.id, b?.canonical_key ?? ''];
          })
        );
        setBundleKeys(Object.fromEntries(bundleEntries));
        setLoading(false);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        console.error('Failed to fetch extensions', { error: msg });
        setError('Failed to load extensions');
        setLoading(false);
      }
    };
  
    // Fire and forget is okay here; internal awaits handled
    void fetchExtensionsData();
  }, []);
  
  // Handle enabling/disabling extensions
  const handleToggleExtension = async (id: string, currentStatus: boolean) => {
    try {
      const result = await toggleExtensionV2(id);
      if (!result.success) {
        alert(result.message);
        return;
      }
  
      // Update local state (use is_enabled)
      setExtensions(prevExtensions =>
        prevExtensions.map(ext =>
          ext.id === id ? { ...ext, is_enabled: !currentStatus } : ext
        )
      );
  
      console.info(`Extension ${currentStatus ? 'disabled' : 'enabled'}`, { id });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      console.error('Failed to toggle extension', { id, error: msg });
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
        prevExtensions.filter(ext => ext.id !== id)
      );
  
      console.info('Extension removed', { id });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      console.error('Failed to remove extension', { id, error: msg });
      alert('Failed to remove extension');
    }
  };

  const handleReprovision = async (id: string) => {
    try {
      const result = await reprovisionExtension(id);
      setInstallInfo((prev) => ({ ...prev, [id]: { domain: result.domain || null, status: { state: 'provisioning' } } }));
    } catch (e) {
      alert('Failed to reprovision');
    }
  };
  
  return (
    <ReflectionContainer id="extensions-page" label="Extensions Management">
      <div className="p-6" {...automationIdProps}>
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-semibold text-gray-900">Extensions</h1>
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
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Domain
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Bundle Path
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
                      <div className="text-sm text-gray-900">
                        {(extension.manifest as any)?.publisher || (extension.manifest as any)?.author || 'Unknown'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          extension.is_enabled
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}>
                          {extension.is_enabled ? 'Enabled' : 'Disabled'}
                        </span>
                        {(() => {
                          const state = installInfo[extension.id]?.status?.state as string | undefined;
                          if (!state) return null;
                          const s = state.toLowerCase();
                          const cls = s === 'ready'
                            ? 'bg-green-100 text-green-800'
                            : s === 'error'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-amber-100 text-amber-800';
                          const label = s.charAt(0).toUpperCase() + s.slice(1);
                          return (
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${cls}`}>
                              {label}
                            </span>
                          );
                        })()}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        {installInfo[extension.id]?.domain || '—'}
                      </div>
                      <div className="text-xs text-gray-500">
                        {(installInfo[extension.id]?.status?.state) ? String(installInfo[extension.id]?.status?.state) : ''}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <code className="text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded px-2 py-0.5">
                          {bundleKeys[extension.id] || '—'}
                        </code>
                        {bundleKeys[extension.id] && (
                          <button
                            onClick={() => navigator.clipboard.writeText(bundleKeys[extension.id])}
                            className="inline-flex items-center px-2 py-0.5 border border-transparent text-xs font-medium rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200"
                          >
                            Copy
                          </button>
                        )}
                      </div>
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
                        {installInfo[extension.id]?.domain ? (
                          <>
                            <a
                              href={`https://${installInfo[extension.id]?.domain}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center px-3 py-1 border border-transparent text-xs font-medium rounded-md bg-green-100 text-green-700 hover:bg-green-200"
                            >
                              Open
                            </a>
                            <button
                              onClick={() => navigator.clipboard.writeText(`https://${installInfo[extension.id]?.domain}`)}
                              className="inline-flex items-center px-3 py-1 border border-transparent text-xs font-medium rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200"
                            >
                              Copy
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => handleReprovision(extension.id)}
                            className="inline-flex items-center px-3 py-1 border border-transparent text-xs font-medium rounded-md bg-amber-100 text-amber-700 hover:bg-amber-200"
                          >
                            Provision
                          </button>
                        )}
                        <button
                          onClick={() => { void handleToggleExtension(extension.id, extension.is_enabled); }}
                          className={`inline-flex items-center px-3 py-1 border border-transparent text-xs font-medium rounded-md ${
                            extension.is_enabled
                              ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                              : 'bg-green-100 text-green-700 hover:bg-green-200'
                          } focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500`}
                          data-automation-id={`extension-toggle-${extension.id}`}
                        >
                          {extension.is_enabled ? (
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
                          onClick={() => { void handleRemoveExtension(extension.id); }}
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
