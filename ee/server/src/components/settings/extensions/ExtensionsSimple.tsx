/**
 * Extensions Management Component
 * 
 * Full extension management interface with working webpack alias imports
 */
'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { fetchInstalledExtensionsV2, toggleExtensionV2, uninstallExtensionV2 } from '../../../lib/actions/extRegistryV2Actions';
import { Extension } from '../../../lib/extensions/types';
import ExtensionDetailsModal from './ExtensionDetailsModal';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';

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
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);
  
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
  const handleRemoveExtension = (id: string) => {
    setRemoveTarget(id);
  };

  const confirmRemoveExtension = async () => {
    if (!removeTarget) return;
    const id = removeTarget;
    setRemoveTarget(null);

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
        <h2 className="text-xl font-semibold text-foreground">Extensions</h2>
      </div>
      
      {loading && (
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
          <span className="ml-3 text-muted-foreground">Loading extensions...</span>
        </div>
      )}
      
      {error && !loading && (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>
            <h3 className="text-sm font-medium">Error</h3>
            <p className="text-sm mt-1">{error}</p>
          </AlertDescription>
        </Alert>
      )}
      
      {!loading && !error && extensions.length === 0 && (
        <div className="bg-card border border-border rounded-lg p-8 text-center">
          <h3 className="text-lg font-medium text-foreground mb-2">No extensions installed</h3>
          <p className="text-muted-foreground mb-4">
            Install extensions to add new features and functionality to Alga PSA.
          </p>
        </div>
      )}
      
      {!loading && !error && extensions.length > 0 && (
        <div className="bg-card rounded-lg border border-border overflow-hidden">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-muted/50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Extension
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Version
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Author
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Status
                </th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-card divide-y divide-border">
              {extensions.map((extension): React.ReactElement => (
                <tr key={extension.id} className="hover:bg-muted/30">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div>
                        <div className="text-sm font-medium text-foreground">
                          <button
                            onClick={() => {
                              setSelectedExtension(extension);
                              setShowModal(true);
                            }}
                            className="hover:text-primary-600 text-left"
                          >
                            {extension.name}
                          </button>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {extension.description}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-foreground">{extension.version}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-foreground">{extension.author || 'Unknown'}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      extension.isEnabled
                        ? 'bg-success/15 text-success'
                        : 'bg-muted text-muted-foreground'
                    }`}>
                      {extension.isEnabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <div className="flex justify-end space-x-2">
                      <Button
                        id={`extension-view-${extension.id}`}
                        variant="outline"
                        size="xs"
                        onClick={() => {
                          setSelectedExtension(extension);
                          setShowModal(true);
                        }}
                      >
                        View
                      </Button>
                      <Button
                        id={`extension-settings-${extension.id}`}
                        variant="soft"
                        size="xs"
                        onClick={() => alert('Extension settings will be available in the next update.')}
                      >
                        Settings
                      </Button>
                      <Button
                        id={`extension-toggle-${extension.id}`}
                        variant="secondary"
                        size="xs"
                        onClick={() => void handleToggleExtension(extension.id, extension.isEnabled)}
                      >
                        {extension.isEnabled ? 'Disable' : 'Enable'}
                      </Button>
                      <Button
                        id={`extension-remove-${extension.id}`}
                        variant="destructive"
                        size="xs"
                        onClick={() => void handleRemoveExtension(extension.id)}
                      >
                        Remove
                      </Button>
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
      <ConfirmationDialog
        isOpen={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        onConfirm={confirmRemoveExtension}
        title="Remove Extension"
        message="Are you sure you want to remove this extension? This action cannot be undone."
        confirmLabel="Remove"
        cancelLabel="Cancel"
        id="remove-extension-confirm"
      />
    </div>
  );
}
