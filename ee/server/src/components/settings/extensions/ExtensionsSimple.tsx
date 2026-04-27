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
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

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
  const { t } = useTranslation('msp/extensions');
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
        setExtensions(v2.map((r: any) => ({ id: r.id, name: r.name, description: '', version: r.version, author: r.author || t('simple.unknownAuthor'), isEnabled: r.is_enabled, createdAt: new Date(), updatedAt: new Date(), tenantId: r.tenant_id })));
        setLoading(false);
      } catch (err) {
        console.error('Failed to fetch extensions', err);
        setError(t('simple.loadFailed'));
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
      alert(currentStatus ? t('simple.toggleDisableFailed') : t('simple.toggleEnableFailed'));
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
      alert(t('simple.removeFailed'));
    }
  };
  
  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold text-foreground">{t('simple.heading')}</h2>
      </div>

      {loading && (
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
          <span className="ml-3 text-muted-foreground">{t('simple.loading')}</span>
        </div>
      )}

      {error && !loading && (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>
            <h3 className="text-sm font-medium">{t('simple.error')}</h3>
            <p className="text-sm mt-1">{error}</p>
          </AlertDescription>
        </Alert>
      )}

      {!loading && !error && extensions.length === 0 && (
        <div className="bg-card border border-border rounded-lg p-8 text-center">
          <h3 className="text-lg font-medium text-foreground mb-2">{t('simple.emptyTitle')}</h3>
          <p className="text-muted-foreground mb-4">
            {t('simple.emptyDescription')}
          </p>
        </div>
      )}
      
      {!loading && !error && extensions.length > 0 && (
        <div className="bg-card rounded-lg border border-border overflow-hidden">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-muted/50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {t('simple.colExtension')}
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {t('simple.colVersion')}
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {t('simple.colAuthor')}
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {t('simple.colStatus')}
                </th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {t('simple.colActions')}
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
                    <div className="text-sm text-foreground">{extension.author || t('simple.unknownAuthor')}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      extension.isEnabled
                        ? 'bg-success/15 text-success'
                        : 'bg-muted text-muted-foreground'
                    }`}>
                      {extension.isEnabled ? t('simple.enabled') : t('simple.disabled')}
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
                        {t('simple.view')}
                      </Button>
                      <Button
                        id={`extension-settings-${extension.id}`}
                        variant="soft"
                        size="xs"
                        onClick={() => alert(t('simple.settingsComingSoon'))}
                      >
                        {t('simple.settings')}
                      </Button>
                      <Button
                        id={`extension-toggle-${extension.id}`}
                        variant="secondary"
                        size="xs"
                        onClick={() => void handleToggleExtension(extension.id, extension.isEnabled)}
                      >
                        {extension.isEnabled ? t('simple.disable') : t('simple.enable')}
                      </Button>
                      <Button
                        id={`extension-remove-${extension.id}`}
                        variant="destructive"
                        size="xs"
                        onClick={() => void handleRemoveExtension(extension.id)}
                      >
                        {t('simple.remove')}
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
        title={t('simple.removeTitle')}
        message={t('simple.removeMessage')}
        confirmLabel={t('simple.confirmRemove')}
        cancelLabel={t('simple.cancel')}
        id="remove-extension-confirm"
      />
    </div>
  );
}
