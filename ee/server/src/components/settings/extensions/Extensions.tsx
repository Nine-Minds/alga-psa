/**
 * Extensions Management Page
 * 
 * Allows administrators to view, enable, disable, and remove extensions
 */
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { useAutomationIdAndRegister } from 'server/src/types/ui-reflection/useAutomationIdAndRegister';
import { ContainerComponent } from 'server/src/types/ui-reflection/types';
import { Extension } from '../../../lib/extensions/types';
import { AlertCircleIcon, CheckCircleIcon, XCircleIcon, Settings, EyeIcon } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from 'server/src/components/ui/Dialog';
import { fetchInstalledExtensionsV2, toggleExtensionV2, uninstallExtensionV2 } from '../../../lib/actions/extRegistryV2Actions';
import { getInstallInfo, reprovisionExtension } from '../../../lib/actions/extensionDomainActions';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { toast } from 'react-hot-toast';
import LoadingIndicator from 'server/src/components/ui/LoadingIndicator';

/**
 * Extensions management page
 */
type ExtRow = Extension & { id: string };

export default function Extensions() {
  const [extensions, setExtensions] = useState<ExtRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [installInfo, setInstallInfo] = useState<Record<string, { domain: string | null; status: any }>>({});
  const [viewing, setViewing] = useState<ExtRow | null>(null);
  
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
        toast.error(result.message || 'Failed to update extension state');
        return;
      }
  
      // Update local state (use is_enabled)
      setExtensions(prevExtensions =>
        prevExtensions.map(ext =>
          ext.id === id ? { ...ext, is_enabled: !currentStatus } : ext
        )
      );
  
      toast.success(`Extension ${currentStatus ? 'disabled' : 'enabled'}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      console.error('Failed to toggle extension', { id, error: msg });
      toast.error(`Failed to ${currentStatus ? 'disable' : 'enable'} extension`);
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
        toast.error(result.message || 'Failed to remove extension');
        return;
      }
  
      // Update local state
      setExtensions(prevExtensions =>
        prevExtensions.filter(ext => ext.id !== id)
      );
  
      toast.success('Extension removed');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      console.error('Failed to remove extension', { id, error: msg });
      toast.error('Failed to remove extension');
    }
  };

  const handleReprovision = async (id: string) => {
    try {
      const result = await reprovisionExtension(id);
      setInstallInfo((prev) => ({ ...prev, [id]: { domain: result.domain || null, status: { state: 'provisioning' } } }));
    } catch (e) {
      toast.error('Failed to reprovision');
    }
  };
  
  return (
    <>
    <ReflectionContainer id="extensions-page" label="Extensions Management">
      <div className="p-6" {...automationIdProps}>
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-semibold text-gray-900">Extensions</h1>
        </div>
        
        {loading && (
          <div className="flex justify-center items-center py-12">
            <LoadingIndicator 
              layout="stacked" 
              text="Loading extensions..."
              spinnerProps={{ size: 'md' }}
            />
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
            <ExtensionsTable
              rows={extensions}
              installInfo={installInfo}
              onReprovision={handleReprovision}
              onToggle={handleToggleExtension}
              onRemove={handleRemoveExtension}
              onView={setViewing}
            />
          </div>
        )}
      </div>
    </ReflectionContainer>
    {viewing && (
      <Dialog isOpen={true} onClose={() => setViewing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{viewing.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p>
              <strong>Version:</strong> {viewing.manifest.version}
            </p>
            <p>
              <strong>Author:</strong> {typeof viewing.manifest.author === 'string' ? viewing.manifest.author : viewing.manifest.author?.name ?? '—'}
            </p>
            <p>
              <strong>Domain:</strong> {installInfo[viewing.id]?.domain || '—'}
            </p>
            {installInfo[viewing.id]?.status?.state && (
              <p>
                <strong>Status:</strong> {String(installInfo[viewing.id]?.status?.state)}
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    )}
    </>
  );
}

function ExtensionsTable({
  rows,
  installInfo,
  onReprovision,
  onToggle,
  onRemove,
  onView,
}: {
  rows: ExtRow[];
  installInfo: Record<string, { domain: string | null; status: any }>;
  onReprovision: (id: string) => void;
  onToggle: (id: string, current: boolean) => void;
  onRemove: (id: string) => void;
  onView: (ext: ExtRow) => void;
}) {
  const columns = useMemo<ColumnDefinition<ExtRow>[]>(() => [
    {
      title: 'Extension',
      dataIndex: 'name',
      width: '320px',
      headerClassName: 'sticky left-0 bg-white z-20',
      cellClassName: 'sticky left-0 bg-white z-10',
      render: (_v, extension) => (
        <div className="min-w-0">
          <div className="text-sm font-medium text-gray-900 truncate">
            <Link href={`/msp/settings/extensions/${extension.id}`} className="hover:text-primary-600">
              {extension.name}
            </Link>
          </div>
          {extension.description && (
            <div className="text-sm text-gray-500 truncate">{extension.description}</div>
          )}
          <div className="mt-1 flex items-center gap-2">
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
              extension.is_enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
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
        </div>
      )
    },
    {
      title: 'Version',
      dataIndex: ['manifest','version'],
      width: '40px',
      render: (value) => (
        <span className="text-sm text-gray-900">{String(value ?? '—')}</span>
      )
    },
    {
      title: 'Author',
      dataIndex: ['manifest','author'],
      width: '40px',
      render: (value) => {
        const label = typeof value === 'string' ? value : (value?.name ?? '—');
        return <span className="text-sm text-gray-900">{label}</span>;
      }
    },
    {
      title: 'Domain',
      dataIndex: 'id',
      // No fixed width: allow Domain column to flex and absorb remaining space
      render: (_v, extension) => (
        <div className="flex flex-col gap-1">
          <div className="text-sm text-gray-900 truncate">
            {installInfo[extension.id]?.domain ? (
              <a
                href={`https://${installInfo[extension.id]?.domain}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-600 hover:underline"
              >
                {installInfo[extension.id]?.domain}
              </a>
            ) : '—'}
          </div>
          <div className="text-xs text-gray-500">
            {(installInfo[extension.id]?.status?.state) ? String(installInfo[extension.id]?.status?.state) : ''}
          </div>
        </div>
      )
    },
    {
      title: 'Actions',
      dataIndex: 'id',
      width: '380px',
      headerClassName: 'text-right sticky right-0 bg-white z-20',
      cellClassName: 'sticky right-0 bg-white z-10',
      render: (_v, extension) => (
        <div className="grid grid-cols-2 gap-2 justify-items-stretch">
          <button
            onClick={() => onView(extension)}
            className="inline-flex items-center justify-center px-3 py-1 border border-transparent text-xs font-medium rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200"
            data-automation-id={`extension-view-${extension.id}`}
          >
            <EyeIcon className="h-3.5 w-3.5 mr-1" />
            View
          </button>
          <Link
            href={`/msp/settings/extensions/${extension.id}/settings`}
            className="inline-flex items-center justify-center px-3 py-1 border border-transparent text-xs font-medium rounded-md bg-blue-100 text-blue-700 hover:bg-blue-200"
            data-automation-id={`extension-settings-${extension.id}`}
          >
            <Settings className="h-3.5 w-3.5 mr-1" />
            Settings
          </Link>
          {installInfo[extension.id]?.domain ? null : (
            <button
              onClick={() => onReprovision(extension.id)}
              className="inline-flex items-center justify-center px-3 py-1 border border-transparent text-xs font-medium rounded-md bg-amber-100 text-amber-700 hover:bg-amber-200"
            >
              Provision
            </button>
          )}
          <button
            onClick={() => { void onToggle(extension.id, extension.is_enabled); }}
            className={`inline-flex items-center justify-center px-3 py-1 border border-transparent text-xs font-medium rounded-md ${
              extension.is_enabled ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'bg-green-100 text-green-700 hover:bg-green-200'
            }`}
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
            onClick={() => { void onRemove(extension.id); }}
            className="inline-flex items-center justify-center px-3 py-1 border border-transparent text-xs font-medium rounded-md bg-red-100 text-red-700 hover:bg-red-200"
            data-automation-id={`extension-remove-${extension.id}`}
          >
            Remove
          </button>
          {/* Per-extension debug console entrypoint.
              Uses only the extension id; tenant scoping is enforced server-side
              based on the authenticated session in /api/ext-debug/stream. */}
          <Link
            href={`/msp/extensions/${extension.id}/debug`}
            className="inline-flex items-center justify-center px-3 py-1 border border-violet-200 text-violet-700 bg-violet-50 hover:bg-violet-100 hover:border-violet-300 text-[10px] font-medium transition-colors"
            data-automation-id={`extension-debug-${extension.id}`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            Debug
          </Link>
        </div>
      )
    }
  ], [installInfo, onRemove, onReprovision, onToggle, onView]);

  return (
    <DataTable<ExtRow>
      id="extensions-table"
      data={rows}
      columns={columns}
      pagination={false}
    />
  );
}
