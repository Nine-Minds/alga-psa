'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import type { ColumnDefinition } from '@alga-psa/types';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  issueServicePrincipalKeyAction,
  listServicePrincipalKeysAction,
  revokeServicePrincipalKeyAction,
  rotateServicePrincipalKeyAction,
} from '../../lib/actions/service-principal-actions';
import type { ServicePrincipalKeyListItem } from '../../lib/service-principals/service';
import { ServicePrincipalKeyRevealDialog } from './ServicePrincipalKeyRevealDialog';

export interface ServicePrincipalKeysDialogProps {
  /** The principal whose keys are managed; null keeps the dialog closed. */
  principal: { user_id: string; name: string } | null;
  /** Below Pro a grandfathered principal can no longer receive keys. */
  canIssue: boolean;
  onClose: () => void;
  onChanged: () => void;
}

/** Key create / rotate / revoke for one principal; the plaintext is shown once via the reveal dialog. */
export function ServicePrincipalKeysDialog({ principal, canIssue, onClose, onChanged }: ServicePrincipalKeysDialogProps) {
  const { t } = useTranslation('msp/settings');
  const { formatDate } = useFormatters();
  const [keys, setKeys] = useState<ServicePrincipalKeyListItem[]>([]);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState<{ value: string; rotated: boolean } | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<ServicePrincipalKeyListItem | null>(null);

  const userId = principal?.user_id ?? null;

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      setKeys(await listServicePrincipalKeysAction(userId));
    } catch (error) {
      handleError(error, t('servicePrincipals.keys.loadFailed', { defaultValue: 'Failed to load keys' }));
    }
  }, [userId, t]);

  useEffect(() => {
    if (userId) {
      setDescription('');
      void load();
    } else {
      setKeys([]);
    }
  }, [userId, load]);

  const issue = async (rotateKeyId?: string) => {
    if (!userId) return;
    setBusy(true);
    try {
      const issued = rotateKeyId
        ? await rotateServicePrincipalKeyAction(userId, rotateKeyId, {})
        : await issueServicePrincipalKeyAction(userId, { description: description.trim() || null });
      setRevealed({ value: issued.api_key, rotated: Boolean(rotateKeyId) });
      setDescription('');
      await load();
      onChanged();
    } catch (error) {
      handleError(error, t('servicePrincipals.keys.issueFailed', { defaultValue: 'Failed to create API key' }));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!userId || !pendingRevoke) return;
    setBusy(true);
    try {
      await revokeServicePrincipalKeyAction(userId, pendingRevoke.api_key_id);
      setPendingRevoke(null);
      await load();
      onChanged();
    } catch (error) {
      handleError(error, t('servicePrincipals.keys.revokeFailed', { defaultValue: 'Failed to revoke API key' }));
    } finally {
      setBusy(false);
    }
  };

  const columns: ColumnDefinition<ServicePrincipalKeyListItem>[] = useMemo(
    () => [
      {
        title: t('servicePrincipals.keys.columns.description', { defaultValue: 'Description' }),
        dataIndex: 'description',
        render: (value: string | null) => value || t('servicePrincipals.keys.noDescription', { defaultValue: 'No description' }),
      },
      {
        title: t('servicePrincipals.keys.columns.status', { defaultValue: 'Status' }),
        dataIndex: 'active',
        render: (value: boolean) => (
          <Badge variant={value ? 'success' : 'default-muted'}>
            {value
              ? t('servicePrincipals.keys.status.active', { defaultValue: 'Active' })
              : t('servicePrincipals.keys.status.inactive', { defaultValue: 'Inactive' })}
          </Badge>
        ),
      },
      {
        title: t('servicePrincipals.keys.columns.lastUsed', { defaultValue: 'Last used' }),
        dataIndex: 'last_used_at',
        render: (value: string | Date | null) =>
          value ? formatDate(new Date(value)) : t('servicePrincipals.keys.never', { defaultValue: 'Never' }),
      },
      {
        title: t('servicePrincipals.keys.columns.expires', { defaultValue: 'Expires' }),
        dataIndex: 'expires_at',
        render: (value: string | Date | null) =>
          value ? formatDate(new Date(value)) : t('servicePrincipals.keys.noExpiry', { defaultValue: 'No expiry' }),
      },
      {
        title: t('servicePrincipals.columns.actions', { defaultValue: 'Actions' }),
        dataIndex: 'api_key_id',
        sortable: false,
        render: (_: string, record: ServicePrincipalKeyListItem) =>
          record.active ? (
            <div className="flex gap-2">
              {canIssue && (
                <Button
                  id={`service-principal-key-rotate-${record.api_key_id}`}
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void issue(record.api_key_id)}
                >
                  {t('servicePrincipals.keys.rotate', { defaultValue: 'Rotate' })}
                </Button>
              )}
              <Button
                id={`service-principal-key-revoke-${record.api_key_id}`}
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => setPendingRevoke(record)}
              >
                {t('servicePrincipals.keys.revoke', { defaultValue: 'Revoke' })}
              </Button>
            </div>
          ) : null,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, formatDate, busy, canIssue, userId],
  );

  return (
    <>
      <Dialog
        id="service-principal-keys-dialog"
        isOpen={Boolean(principal)}
        onClose={onClose}
        title={t('servicePrincipals.keys.title', { defaultValue: 'API keys for {{name}}', name: principal?.name ?? '' })}
      >
        <DialogContent>
          <div className="space-y-4">
            {canIssue && (
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Input
                    id="service-principal-key-description"
                    label={t('servicePrincipals.keys.descriptionLabel', { defaultValue: 'Key description' })}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
                <Button id="service-principal-key-create" disabled={busy} onClick={() => void issue()}>
                  {t('servicePrincipals.keys.create', { defaultValue: 'Create key' })}
                </Button>
              </div>
            )}
            <DataTable id="service-principal-keys-table" data={keys} columns={columns} pagination={false} />
          </div>
        </DialogContent>
      </Dialog>
      <ServicePrincipalKeyRevealDialog
        keyValue={revealed?.value ?? null}
        rotated={revealed?.rotated}
        onClose={() => setRevealed(null)}
      />
      <ConfirmationDialog
        id="service-principal-key-revoke-confirm"
        isOpen={Boolean(pendingRevoke)}
        onClose={() => setPendingRevoke(null)}
        onConfirm={revoke}
        title={t('servicePrincipals.keys.revokeTitle', { defaultValue: 'Revoke API key?' })}
        message={t('servicePrincipals.keys.revokeMessage', {
          defaultValue: 'Anything using this key stops working immediately.',
        })}
        confirmLabel={t('servicePrincipals.keys.revoke', { defaultValue: 'Revoke' })}
        cancelLabel={t('servicePrincipals.dialog.cancel', { defaultValue: 'Cancel' })}
      />
    </>
  );
}

export default ServicePrincipalKeysDialog;
