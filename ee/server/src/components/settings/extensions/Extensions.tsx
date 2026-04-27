/**
 * Extensions Management Page
 * 
 * Allows administrators to view, enable, disable, and remove extensions
 */
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import { useAutomationIdAndRegister } from '@alga-psa/ui/ui-reflection/useAutomationIdAndRegister';
import { ContainerComponent } from '@alga-psa/ui/ui-reflection/types';
import { Extension } from '../../../lib/extensions/types';
import { CheckCircleIcon, XCircleIcon, Settings, EyeIcon, Terminal } from 'lucide-react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { fetchInstalledExtensionsV2, toggleExtensionV2, uninstallExtensionV2 } from '../../../lib/actions/extRegistryV2Actions';
import { getInstallInfo, reprovisionExtension } from '../../../lib/actions/extensionDomainActions';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { toast } from 'react-hot-toast';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

/**
 * Extensions management page
 */
type ExtRow = Extension & { id: string };

export default function Extensions() {
  const { t } = useTranslation('msp/extensions');
  const [extensions, setExtensions] = useState<ExtRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [installInfo, setInstallInfo] = useState<Record<string, { domain: string | null; status: any }>>({});
  const [viewing, setViewing] = useState<ExtRow | null>(null);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);
  
  // Register with Alga's UI automation system
  const { automationIdProps } = useAutomationIdAndRegister<ContainerComponent>({
    id: 'extensions-page',
    type: 'container',
    label: t('list.label')
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
        setError(t('list.loadFailed'));
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
        toast.error(result.message || t('messages.toggleFailed'));
        return;
      }
  
      // Update local state (use is_enabled)
      setExtensions(prevExtensions =>
        prevExtensions.map(ext =>
          ext.id === id ? { ...ext, is_enabled: !currentStatus } : ext
        )
      );
  
      toast.success(currentStatus ? t('messages.extensionDisabled') : t('messages.extensionEnabled'));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      console.error('Failed to toggle extension', { id, error: msg });
      toast.error(currentStatus ? t('messages.disableFailed') : t('messages.enableFailed'));
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
        toast.error(result.message || t('messages.removeFailed'));
        return;
      }

      // Update local state
      setExtensions(prevExtensions =>
        prevExtensions.filter(ext => ext.id !== id)
      );

      toast.success(t('messages.extensionRemoved'));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      console.error('Failed to remove extension', { id, error: msg });
      toast.error(t('messages.removeFailed'));
    }
  };

  const handleReprovision = async (id: string) => {
    try {
      const result = await reprovisionExtension(id);
      setInstallInfo((prev) => ({ ...prev, [id]: { domain: result.domain || null, status: { state: 'provisioning' } } }));
    } catch (e) {
      toast.error(t('messages.reprovisionFailed'));
    }
  };
  
  return (
    <>
    <ReflectionContainer id="extensions-page" label={t('list.label')}>
      <div className="p-6" {...automationIdProps}>
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-semibold text-foreground">{t('list.heading')}</h1>
        </div>

        {loading && (
          <div className="flex justify-center items-center py-12">
            <LoadingIndicator
              layout="stacked"
              text={t('list.loading')}
              spinnerProps={{ size: 'md' }}
            />
          </div>
        )}

        {error && !loading && (
          <Alert variant="destructive" className="mb-6">
            <AlertDescription>
              <h3 className="text-sm font-medium">{t('list.error')}</h3>
              <p className="text-sm mt-1">{error}</p>
            </AlertDescription>
          </Alert>
        )}

        {!loading && !error && extensions.length === 0 && (
          <div className="bg-card border border-border rounded-lg p-8 text-center">
            <h3 className="text-lg font-medium text-foreground mb-2">{t('list.emptyTitle')}</h3>
            <p className="text-muted-foreground mb-4">
              {t('list.emptyDescription')}
            </p>
          </div>
        )}
        
        {!loading && !error && extensions.length > 0 && (
          <div className="bg-card rounded-lg border border-border overflow-hidden">
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
    <ConfirmationDialog
      isOpen={removeTarget !== null}
      onClose={() => setRemoveTarget(null)}
      onConfirm={confirmRemoveExtension}
      title={t('list.removeTitle')}
      message={t('list.removeMessage')}
      confirmLabel={t('list.confirmRemove')}
      cancelLabel={t('list.cancel')}
      id="remove-extension-confirm"
    />
    {viewing && (
      <Dialog isOpen={true} onClose={() => setViewing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{viewing.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p>
              <strong>{t('list.dialogVersion')}</strong> {viewing.manifest.version}
            </p>
            <p>
              <strong>{t('list.dialogAuthor')}</strong> {typeof viewing.manifest.author === 'string' ? viewing.manifest.author : viewing.manifest.author?.name ?? '—'}
            </p>
            <p>
              <strong>{t('list.dialogDomain')}</strong> {installInfo[viewing.id]?.domain || '—'}
            </p>
            {installInfo[viewing.id]?.status?.state && (
              <p>
                <strong>{t('list.dialogStatus')}</strong> {String(installInfo[viewing.id]?.status?.state)}
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
  const { t } = useTranslation('msp/extensions');
  const columns = useMemo<ColumnDefinition<ExtRow>[]>(() => [
    {
      title: t('list.colExtension'),
      dataIndex: 'name',
      width: '320px',
      headerClassName: 'sticky left-0 bg-card z-20',
      cellClassName: 'sticky left-0 bg-card z-10',
      render: (_v, extension) => (
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground truncate">
            <Link href={`/msp/settings/extensions/${extension.id}`} className="hover:text-primary-600">
              {extension.name}
            </Link>
          </div>
          {extension.description && (
            <div className="text-sm text-muted-foreground truncate">{extension.description}</div>
          )}
          <div className="mt-1 flex items-center gap-2">
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
              extension.is_enabled ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground'
            }`}>
              {extension.is_enabled ? t('list.enabled') : t('list.disabled')}
            </span>
            {(() => {
              const state = installInfo[extension.id]?.status?.state as string | undefined;
              if (!state) return null;
              const s = state.toLowerCase();
              const cls = s === 'ready'
                ? 'bg-success/15 text-success'
                : s === 'error'
                  ? 'bg-destructive/15 text-destructive'
                  : 'bg-warning/15 text-warning-foreground';
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
      title: t('list.colVersion'),
      dataIndex: ['manifest','version'],
      width: '40px',
      render: (value) => (
        <span className="text-sm text-foreground">{String(value ?? '—')}</span>
      )
    },
    {
      title: t('list.colAuthor'),
      dataIndex: ['manifest','author'],
      width: '40px',
      render: (value) => {
        const label = typeof value === 'string' ? value : (value?.name ?? '—');
        return <span className="text-sm text-foreground">{label}</span>;
      }
    },
    {
      title: t('list.colDomain'),
      dataIndex: 'id',
      render: (_v, extension) => (
        <div className="flex flex-col gap-1">
          <div className="text-sm text-foreground truncate">
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
          <div className="text-xs text-muted-foreground">
            {(installInfo[extension.id]?.status?.state) ? String(installInfo[extension.id]?.status?.state) : ''}
          </div>
        </div>
      )
    },
    {
      title: t('list.colActions'),
      dataIndex: 'id',
      width: '380px',
      headerClassName: 'text-right sticky right-0 bg-card z-20',
      cellClassName: 'sticky right-0 bg-card z-10',
      render: (_v, extension) => (
        <div className="grid grid-cols-2 gap-2 justify-items-stretch">
          <Button
            id={`extension-view-${extension.id}`}
            variant="outline"
            size="xs"
            onClick={() => onView(extension)}
          >
            <EyeIcon className="h-3.5 w-3.5 mr-1" />
            {t('list.view')}
          </Button>
          <Button
            id={`extension-settings-${extension.id}`}
            variant="soft"
            size="xs"
            asChild
          >
            <Link href={`/msp/settings/extensions/${extension.id}/settings`}>
              <Settings className="h-3.5 w-3.5 mr-1" />
              {t('list.settings')}
            </Link>
          </Button>
          {installInfo[extension.id]?.domain ? null : (
            <Button
              id={`extension-provision-${extension.id}`}
              variant="outline"
              size="xs"
              onClick={() => onReprovision(extension.id)}
            >
              {t('list.provision')}
            </Button>
          )}
          <Button
            id={`extension-toggle-${extension.id}`}
            variant="secondary"
            size="xs"
            onClick={() => { void onToggle(extension.id, extension.is_enabled); }}
          >
            {extension.is_enabled ? (
              <>
                <XCircleIcon className="h-3.5 w-3.5 mr-1" />
                {t('list.disable')}
              </>
            ) : (
              <>
                <CheckCircleIcon className="h-3.5 w-3.5 mr-1" />
                {t('list.enable')}
              </>
            )}
          </Button>
          <Button
            id={`extension-remove-${extension.id}`}
            variant="destructive"
            size="xs"
            onClick={() => { void onRemove(extension.id); }}
          >
            {t('list.remove')}
          </Button>
          <Button
            id={`extension-debug-${extension.id}`}
            variant="ghost"
            size="xs"
            asChild
          >
            <Link href={`/msp/extensions/${extension.id}/debug`}>
              <Terminal className="h-3.5 w-3.5 mr-1" />
              {t('list.debug')}
            </Link>
          </Button>
        </div>
      )
    }
  ], [installInfo, onRemove, onReprovision, onToggle, onView, t]);

  return (
    <DataTable<ExtRow>
      id="extensions-table"
      data={rows}
      columns={columns}
      pagination={false}
    />
  );
}
