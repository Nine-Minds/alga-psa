'use client';

/**
 * UniFi API keys: the list of credentials (label, type, status, consoles reached,
 * last error, last checked) with add / replace key / rename / remove.
 *
 * Keys are write-only: state here only holds what the user is typing right now.
 * No id is rendered; every row is identified by its label.
 */

import React, { useState, useTransition } from 'react';
import { MoreVertical } from 'lucide-react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@alga-psa/ui/components/DropdownMenu';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ColumnDefinition } from '@alga-psa/types';
import {
  addUniFiCredential,
  removeUniFiCredential,
  replaceUniFiCredentialKey,
  saveUniFiConfiguration,
  updateUniFiCredential,
} from '../../../lib/actions/integrations/uniFiActions';

export type UniFiCredentialItem = {
  credentialId: string;
  label: string;
  mode: 'site_manager' | 'local';
  status: 'active' | 'reconnect_required' | 'disabled';
  consoles: string[];
  lastError: string | null;
  lastCheckedAt: string | null;
};

type Props = {
  items: UniFiCredentialItem[];
  unreachableConsoles: Array<{ name: string }>;
  disabled?: boolean;
  /** Called after any change so the parent reloads; `message` is a success notice. */
  onChanged: (message?: string) => void | Promise<void>;
  onError: (message: string) => void;
};

type Mode = 'site_manager' | 'local';

export default function UniFiCredentialsPanel({ items, unreachableConsoles, disabled, onChanged, onError }: Props) {
  const { t } = useTranslation('msp/integrations');
  const [isWorking, startWorking] = useTransition();

  const [showAdd, setShowAdd] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newMode, setNewMode] = useState<Mode>('site_manager');
  const [newUrl, setNewUrl] = useState('');
  const [newKey, setNewKey] = useState('');

  const [replacing, setReplacing] = useState<UniFiCredentialItem | null>(null);
  const [replaceKey, setReplaceKey] = useState('');
  const [replaceUrl, setReplaceUrl] = useState('');

  const [renaming, setRenaming] = useState<UniFiCredentialItem | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const [removing, setRemoving] = useState<{ item: UniFiCredentialItem; sites: string[] } | null>(null);

  const isFirstKey = items.length === 0;
  const formVisible = showAdd || isFirstKey;

  const modeLabel = (mode: Mode) =>
    mode === 'local'
      ? t('integrations.rmm.unifi.fields.modeLocal', { defaultValue: 'Local controller' })
      : t('integrations.rmm.unifi.fields.modeSiteManager', { defaultValue: 'Site Manager (cloud)' });

  const modeOptions = [
    { value: 'site_manager', label: modeLabel('site_manager') },
    { value: 'local', label: modeLabel('local') },
  ];

  const resetAdd = () => {
    setShowAdd(false);
    setNewLabel('');
    setNewKey('');
    setNewUrl('');
    setNewMode('site_manager');
  };

  const handleAdd = () => {
    startWorking(async () => {
      const label = newLabel.trim() || (isFirstKey ? 'Default' : '');
      const payload = {
        label,
        apiKey: newKey.trim(),
        connectionMode: newMode,
        localBaseUrl: newMode === 'local' ? newUrl.trim() : undefined,
      };
      // The very first key also creates the integration row.
      const result = isFirstKey ? await saveUniFiConfiguration(payload) : await addUniFiCredential(payload);
      if (result.success) {
        resetAdd();
        await onChanged(t('integrations.rmm.unifi.credentials.added', { defaultValue: 'API key added' }));
      } else {
        onError(result.error || t('integrations.rmm.unifi.credentials.addFailed', { defaultValue: 'Failed to add the API key' }));
      }
    });
  };

  const handleReplace = () => {
    if (!replacing) return;
    startWorking(async () => {
      const result = await replaceUniFiCredentialKey({
        credentialId: replacing.credentialId,
        apiKey: replaceKey.trim(),
        localBaseUrl: replacing.mode === 'local' && replaceUrl.trim() ? replaceUrl.trim() : undefined,
      });
      if (result.success) {
        setReplacing(null);
        setReplaceKey('');
        setReplaceUrl('');
        await onChanged(t('integrations.rmm.unifi.credentials.replaced', { defaultValue: 'API key replaced' }));
      } else {
        onError(result.error || t('integrations.rmm.unifi.credentials.replaceFailed', { defaultValue: 'Failed to replace the API key' }));
      }
    });
  };

  const handleRename = () => {
    if (!renaming) return;
    startWorking(async () => {
      const result = await updateUniFiCredential({ credentialId: renaming.credentialId, label: renameValue });
      if (result.success) {
        setRenaming(null);
        await onChanged(t('integrations.rmm.unifi.credentials.renamed', { defaultValue: 'Label updated' }));
      } else {
        onError(result.error || t('integrations.rmm.unifi.credentials.renameFailed', { defaultValue: 'Failed to update the label' }));
      }
    });
  };

  /** Without `confirm` the server lists mapped sites that would lose their key; ask, then repeat. */
  const requestRemove = (item: UniFiCredentialItem) => {
    startWorking(async () => {
      const result = await removeUniFiCredential({ credentialId: item.credentialId });
      if (!result.success) {
        onError(result.error || t('integrations.rmm.unifi.credentials.removeFailed', { defaultValue: 'Failed to remove the API key' }));
      } else if ('requiresConfirmation' in result && result.requiresConfirmation) {
        setRemoving({ item, sites: result.affectedSites ?? [] });
      } else {
        await onChanged(t('integrations.rmm.unifi.credentials.removed', { defaultValue: 'API key removed' }));
      }
    });
  };

  const confirmRemove = async () => {
    if (!removing) return;
    const result = await removeUniFiCredential({ credentialId: removing.item.credentialId, confirm: true });
    setRemoving(null);
    if (result.success) {
      await onChanged(t('integrations.rmm.unifi.credentials.removed', { defaultValue: 'API key removed' }));
    } else {
      onError(result.error || t('integrations.rmm.unifi.credentials.removeFailed', { defaultValue: 'Failed to remove the API key' }));
    }
  };

  const statusBadge = (status: UniFiCredentialItem['status']) => {
    if (status === 'reconnect_required') {
      return <Badge variant="error">{t('integrations.rmm.unifi.credentials.statusReconnect', { defaultValue: 'Key rejected' })}</Badge>;
    }
    if (status === 'disabled') {
      return <Badge variant="outline">{t('integrations.rmm.unifi.credentials.statusDisabled', { defaultValue: 'Disabled' })}</Badge>;
    }
    return <Badge variant="default">{t('integrations.rmm.unifi.credentials.statusActive', { defaultValue: 'Active' })}</Badge>;
  };

  const columns: ColumnDefinition<UniFiCredentialItem>[] = [
    {
      title: t('integrations.rmm.unifi.credentials.columns.label', { defaultValue: 'Key' }),
      dataIndex: 'label',
      render: (_v, item) => <span className="font-medium">{item.label}</span>,
    },
    {
      title: t('integrations.rmm.unifi.credentials.columns.type', { defaultValue: 'Type' }),
      dataIndex: 'mode',
      render: (_v, item) => modeLabel(item.mode),
    },
    {
      title: t('integrations.rmm.unifi.credentials.columns.status', { defaultValue: 'Status' }),
      dataIndex: 'status',
      sortable: false,
      render: (_v, item) => statusBadge(item.status),
    },
    {
      title: t('integrations.rmm.unifi.credentials.columns.consoles', { defaultValue: 'Consoles reached' }),
      dataIndex: 'consoles',
      sortable: false,
      render: (_v, item) =>
        item.consoles.length > 0 ? (
          item.consoles.join(', ')
        ) : (
          <span className="text-muted-foreground">
            {t('integrations.rmm.unifi.credentials.noConsoles', { defaultValue: 'None yet' })}
          </span>
        ),
    },
    {
      title: t('integrations.rmm.unifi.credentials.columns.lastError', { defaultValue: 'Last error' }),
      dataIndex: 'lastError',
      sortable: false,
      render: (_v, item) => item.lastError ?? <span className="text-muted-foreground">—</span>,
    },
    {
      title: t('integrations.rmm.unifi.credentials.columns.lastChecked', { defaultValue: 'Last checked' }),
      dataIndex: 'lastCheckedAt',
      sortable: false,
      render: (_v, item) =>
        item.lastCheckedAt ? (
          new Date(item.lastCheckedAt).toLocaleString()
        ) : (
          <span className="text-muted-foreground">{t('integrations.rmm.unifi.connection.never', { defaultValue: 'never' })}</span>
        ),
    },
    {
      title: t('integrations.rmm.unifi.credentials.columns.actions', { defaultValue: 'Actions' }),
      dataIndex: 'credentialId',
      sortable: false,
      width: '1%',
      render: (_v, item) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id={`unifi-key-actions-${item.credentialId}`}
              variant="ghost"
              className="h-8 w-8 p-0"
              disabled={disabled || isWorking}
            >
              <span className="sr-only">
                {t('integrations.rmm.unifi.credentials.actionsMenu', {
                  defaultValue: 'Actions for {{label}}',
                  label: item.label,
                })}
              </span>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              id={`unifi-replace-key-${item.credentialId}`}
              onClick={() => {
                setReplacing(item);
                setReplaceKey('');
                setReplaceUrl('');
              }}
            >
              {t('integrations.rmm.unifi.credentials.replaceKey', { defaultValue: 'Replace key' })}
            </DropdownMenuItem>
            <DropdownMenuItem
              id={`unifi-rename-key-${item.credentialId}`}
              onClick={() => {
                setRenaming(item);
                setRenameValue(item.label);
              }}
            >
              {t('integrations.rmm.unifi.credentials.rename', { defaultValue: 'Rename' })}
            </DropdownMenuItem>
            <DropdownMenuItem
              id={`unifi-remove-key-${item.credentialId}`}
              className="text-red-600 focus:text-red-600"
              onClick={() => requestRemove(item)}
            >
              {t('integrations.rmm.unifi.credentials.remove', { defaultValue: 'Remove' })}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const canSubmitAdd =
    newKey.trim().length > 0 && (isFirstKey || newLabel.trim().length > 0) && (newMode !== 'local' || newUrl.trim().length > 0);

  return (
    <div className="space-y-4" id="unifi-credentials">
      {unreachableConsoles.length > 0 ? (
        <Alert variant="destructive" id="unifi-unreachable-consoles">
          <AlertDescription>
            <p className="font-medium">
              {t('integrations.rmm.unifi.credentials.unreachableTitle', {
                defaultValue: 'Some consoles are visible but none of your keys can access them.',
              })}
            </p>
            <ul className="mt-1 list-disc pl-5">
              {unreachableConsoles.map((console) => (
                <li key={console.name}>{console.name}</li>
              ))}
            </ul>
            <p className="mt-1">
              {t('integrations.rmm.unifi.credentials.unreachableAction', {
                defaultValue:
                  'If a console belongs to a fabric, add a key created under that fabric. Create it in UniFi Site Manager while that fabric is selected.',
              })}
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      {items.length > 0 ? (
        <div className="overflow-x-auto rounded-md border">
          <DataTable id="unifi-credentials-table" data={items} columns={columns} pagination={false} />
        </div>
      ) : null}

      {formVisible ? (
        <div className="space-y-3 rounded-md border p-4">
          <p className="text-sm text-muted-foreground">
            {isFirstKey
              ? t('integrations.rmm.unifi.credentials.firstKeyHelp', {
                  defaultValue: 'Paste a UniFi API key to connect. You can add more keys later, for example one per fabric.',
                })
              : t('integrations.rmm.unifi.credentials.addHelp', {
                  defaultValue:
                    'A key created under Independent reaches your independent consoles. A key created under a fabric reaches only that fabric, so add one per fabric.',
                })}
          </p>
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="unifi-new-label">
              {t('integrations.rmm.unifi.credentials.labelField', { defaultValue: 'Label' })}
            </label>
            <Input
              id="unifi-new-label"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder={
                isFirstKey
                  ? t('integrations.rmm.unifi.credentials.labelPlaceholderFirst', { defaultValue: 'Default' })
                  : t('integrations.rmm.unifi.credentials.labelPlaceholder', { defaultValue: 'For example: Acme fabric' })
              }
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="unifi-new-mode">
              {t('integrations.rmm.unifi.fields.connectionMode', { defaultValue: 'Connection mode' })}
            </label>
            <CustomSelect
              id="unifi-new-mode"
              options={modeOptions}
              value={newMode}
              onValueChange={(value) => setNewMode(value === 'local' ? 'local' : 'site_manager')}
            />
          </div>
          {newMode === 'local' ? (
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="unifi-new-url">
                {t('integrations.rmm.unifi.fields.localBaseUrl', { defaultValue: 'Controller URL' })}
              </label>
              <Input
                id="unifi-new-url"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder={t('integrations.rmm.unifi.fields.localBaseUrlPlaceholder', { defaultValue: 'https://unifi.example.com' })}
              />
            </div>
          ) : null}
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="unifi-new-key">
              {t('integrations.rmm.unifi.credentials.keyField', { defaultValue: 'API key' })}
            </label>
            <Input
              id="unifi-new-key"
              type="password"
              autoComplete="off"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder={t('integrations.rmm.unifi.fields.apiKeyPlaceholderNew', { defaultValue: 'Paste your UniFi API key' })}
            />
          </div>
          <div className="flex gap-2">
            <Button id="unifi-add-key-submit" onClick={handleAdd} disabled={disabled || isWorking || !canSubmitAdd}>
              {isFirstKey
                ? t('integrations.rmm.unifi.actions.saveConfiguration', { defaultValue: 'Save Configuration' })
                : t('integrations.rmm.unifi.credentials.addKey', { defaultValue: 'Add key' })}
            </Button>
            {!isFirstKey ? (
              <Button id="unifi-add-key-cancel" variant="outline" onClick={resetAdd} disabled={isWorking}>
                {t('integrations.rmm.unifi.credentials.cancel', { defaultValue: 'Cancel' })}
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <Button id="unifi-add-key" variant="outline" onClick={() => setShowAdd(true)} disabled={disabled || isWorking}>
          {t('integrations.rmm.unifi.credentials.addAnother', { defaultValue: 'Add another key' })}
        </Button>
      )}

      <Dialog
        id="unifi-replace-key-dialog"
        isOpen={replacing !== null}
        onClose={() => setReplacing(null)}
        title={t('integrations.rmm.unifi.credentials.replaceTitle', {
          defaultValue: 'Replace key: {{label}}',
          label: replacing?.label ?? '',
        })}
      >
        <DialogContent>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t('integrations.rmm.unifi.credentials.replaceHelp', {
                defaultValue: 'The new key is checked before it replaces the saved one. The old key is discarded.',
              })}
            </p>
            {replacing?.mode === 'local' ? (
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="unifi-replace-url">
                  {t('integrations.rmm.unifi.credentials.replaceUrlField', { defaultValue: 'Controller URL (leave empty to keep the saved one)' })}
                </label>
                <Input id="unifi-replace-url" value={replaceUrl} onChange={(e) => setReplaceUrl(e.target.value)} />
              </div>
            ) : null}
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="unifi-replace-key">
                {t('integrations.rmm.unifi.credentials.newKeyField', { defaultValue: 'New API key' })}
              </label>
              <Input
                id="unifi-replace-key"
                type="password"
                autoComplete="off"
                value={replaceKey}
                onChange={(e) => setReplaceKey(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button id="unifi-replace-key-cancel" variant="outline" onClick={() => setReplacing(null)} disabled={isWorking}>
              {t('integrations.rmm.unifi.credentials.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button id="unifi-replace-key-submit" onClick={handleReplace} disabled={isWorking || !replaceKey.trim()}>
              {t('integrations.rmm.unifi.credentials.replaceKey', { defaultValue: 'Replace key' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        id="unifi-rename-key-dialog"
        isOpen={renaming !== null}
        onClose={() => setRenaming(null)}
        title={t('integrations.rmm.unifi.credentials.renameTitle', { defaultValue: 'Rename key' })}
      >
        <DialogContent>
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="unifi-rename-label">
              {t('integrations.rmm.unifi.credentials.labelField', { defaultValue: 'Label' })}
            </label>
            <Input id="unifi-rename-label" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} />
          </div>
          <DialogFooter>
            <Button id="unifi-rename-key-cancel" variant="outline" onClick={() => setRenaming(null)} disabled={isWorking}>
              {t('integrations.rmm.unifi.credentials.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button id="unifi-rename-key-submit" onClick={handleRename} disabled={isWorking || !renameValue.trim()}>
              {t('integrations.rmm.unifi.credentials.rename', { defaultValue: 'Rename' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        id="unifi-remove-key-dialog"
        isOpen={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={confirmRemove}
        title={t('integrations.rmm.unifi.credentials.removeTitle', {
          defaultValue: 'Remove key: {{label}}',
          label: removing?.item.label ?? '',
        })}
        message={
          <div className="space-y-2">
            <p>
              {t('integrations.rmm.unifi.credentials.removeWarning', {
                defaultValue:
                  'These mapped sites use this key. They keep their client mapping and assets, but they stop syncing until another key can reach their console.',
              })}
            </p>
            <ul className="list-disc pl-5">
              {(removing?.sites ?? []).map((site) => (
                <li key={site}>{site}</li>
              ))}
            </ul>
          </div>
        }
        confirmLabel={t('integrations.rmm.unifi.credentials.remove', { defaultValue: 'Remove' })}
        cancelLabel={t('integrations.rmm.unifi.credentials.cancel', { defaultValue: 'Cancel' })}
      />
    </div>
  );
}
