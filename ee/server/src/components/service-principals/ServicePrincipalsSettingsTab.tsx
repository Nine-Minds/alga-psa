'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Card } from '@alga-psa/ui/components/Card';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Switch } from '@alga-psa/ui/components/Switch';
import type { ColumnDefinition } from '@alga-psa/types';
import { TIER_FEATURES } from '@alga-psa/types';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { toast } from 'react-hot-toast';
import { useTier } from 'server/src/context/TierContext';
import { TierGate } from 'server/src/components/tier-gating/TierGate';
import {
  deleteServicePrincipalAction,
  getServicePrincipalFormOptionsAction,
  getServicePrincipalUsage,
  listServicePrincipalRowsAction,
  setServicePrincipalActiveAction,
  type MspRoleOption,
  type ServicePrincipalFormOptions,
  type ServicePrincipalRow,
} from '../../lib/actions/service-principal-actions';
import type { ServicePrincipalUsage } from '../../lib/service-principals/usage';
import { ServicePrincipalDialog } from './ServicePrincipalDialog';
import { ServicePrincipalKeysDialog } from './ServicePrincipalKeysDialog';

const EMPTY_OPTIONS: ServicePrincipalFormOptions = {
  roles: [] as MspRoleOption[],
  rateLimitCeiling: { maxTokens: 120, refillPerMin: 60 },
};

/**
 * Settings > Security > Service principals (EE).
 *
 * Tier rules: creating, editing, and issuing keys need Pro. A tenant that dropped below Pro keeps
 * its principals (grandfathered) and may only deactivate or delete them; with none it just sees the
 * upgrade notice.
 */
export function ServicePrincipalsSettingsTab() {
  const { t } = useTranslation('msp/settings');
  const { formatDate } = useFormatters();
  const { hasFeature } = useTier();
  const hasPro = hasFeature(TIER_FEATURES.SERVICE_PRINCIPALS);

  const [rows, setRows] = useState<ServicePrincipalRow[]>([]);
  const [usage, setUsage] = useState<ServicePrincipalUsage | null>(null);
  const [options, setOptions] = useState<ServicePrincipalFormOptions>(EMPTY_OPTIONS);
  const [loaded, setLoaded] = useState(false);
  const [dialog, setDialog] = useState<{ open: boolean; principal: ServicePrincipalRow | null }>({
    open: false,
    principal: null,
  });
  const [keysFor, setKeysFor] = useState<ServicePrincipalRow | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ServicePrincipalRow | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, currentUsage, formOptions] = await Promise.all([
        listServicePrincipalRowsAction(),
        getServicePrincipalUsage(),
        getServicePrincipalFormOptionsAction(),
      ]);
      setRows(list);
      setUsage(currentUsage);
      setOptions(formOptions);
    } catch (error) {
      handleError(error, t('servicePrincipals.loadFailed', { defaultValue: 'Failed to load service principals' }));
    } finally {
      setLoaded(true);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleToggleActive = useCallback(
    async (row: ServicePrincipalRow, active: boolean) => {
      try {
        await setServicePrincipalActiveAction(row.user_id, active);
        await load();
      } catch (error) {
        handleError(error, t('servicePrincipals.toggleFailed', { defaultValue: 'Failed to update service principal' }));
      }
    },
    [load, t],
  );

  const handleDelete = async () => {
    if (!pendingDelete) return;
    try {
      const outcome = await deleteServicePrincipalAction(pendingDelete.user_id);
      toast.success(
        outcome === 'archived'
          ? t('servicePrincipals.delete.archived', {
              defaultValue: 'Service principal archived. Its history is kept so past activity still shows its name.',
            })
          : t('servicePrincipals.delete.deleted', { defaultValue: 'Service principal deleted.' }),
      );
      setPendingDelete(null);
      await load();
    } catch (error) {
      handleError(error, t('servicePrincipals.delete.failed', { defaultValue: 'Failed to delete service principal' }));
    }
  };

  const atLimit = usage ? usage.used >= usage.limit : false;
  const canCreate = hasPro && !atLimit;

  const columns: ColumnDefinition<ServicePrincipalRow>[] = useMemo(
    () => [
      {
        title: t('servicePrincipals.columns.name', { defaultValue: 'Name' }),
        dataIndex: 'name',
        render: (value: string, record) => (
          <div>
            <div className="font-medium">{value}</div>
            {record.description && <div className="text-xs text-gray-500">{record.description}</div>}
          </div>
        ),
      },
      {
        title: t('servicePrincipals.columns.kind', { defaultValue: 'Type' }),
        dataIndex: 'kind',
        render: (value: ServicePrincipalRow['kind']) => (
          <Badge variant={value === 'mcp_agent' ? 'info' : 'default-muted'}>
            {value === 'mcp_agent'
              ? t('servicePrincipals.kind.mcpAgent', { defaultValue: 'MCP agent' })
              : t('servicePrincipals.kind.api', { defaultValue: 'API' })}
          </Badge>
        ),
      },
      {
        title: t('servicePrincipals.columns.status', { defaultValue: 'Status' }),
        dataIndex: 'is_inactive',
        render: (_: boolean, record) => (
          <div className="flex items-center gap-2">
            <Switch
              id={`service-principal-active-${record.user_id}`}
              checked={!record.is_inactive}
              onCheckedChange={(checked) => void handleToggleActive(record, checked)}
              // Below Pro a principal can only be switched off, never back on.
              disabled={Boolean(record.archived_at) || (!hasPro && record.is_inactive)}
              aria-label={t('servicePrincipals.columns.active', { defaultValue: 'Active' })}
            />
            <Badge variant={record.is_inactive ? 'default-muted' : 'success'}>
              {record.is_inactive
                ? t('servicePrincipals.status.inactive', { defaultValue: 'Inactive' })
                : t('servicePrincipals.status.active', { defaultValue: 'Active' })}
            </Badge>
          </div>
        ),
      },
      {
        title: t('servicePrincipals.columns.roles', { defaultValue: 'Roles' }),
        dataIndex: 'role_names',
        render: (value: string[]) => (value.length ? value.join(', ') : '—'),
      },
      {
        title: t('servicePrincipals.columns.keys', { defaultValue: 'Active keys' }),
        dataIndex: 'active_key_count',
      },
      {
        title: t('servicePrincipals.columns.lastUsed', { defaultValue: 'Last used' }),
        dataIndex: 'last_used_at',
        render: (value: string | null) =>
          value ? formatDate(new Date(value)) : t('servicePrincipals.keys.never', { defaultValue: 'Never' }),
      },
      {
        title: t('servicePrincipals.columns.createdBy', { defaultValue: 'Created by' }),
        dataIndex: 'created_by_name',
        render: (value: string | null) => value ?? '—',
      },
      {
        title: t('servicePrincipals.columns.actions', { defaultValue: 'Actions' }),
        dataIndex: 'user_id',
        sortable: false,
        render: (_: string, record) => (
          <div className="flex gap-2">
            {hasPro && (
              <>
                <Button
                  id={`service-principal-edit-${record.user_id}`}
                  size="sm"
                  variant="outline"
                  onClick={() => setDialog({ open: true, principal: record })}
                >
                  {t('servicePrincipals.actions.edit', { defaultValue: 'Edit' })}
                </Button>
                <Button
                  id={`service-principal-keys-${record.user_id}`}
                  size="sm"
                  variant="outline"
                  onClick={() => setKeysFor(record)}
                >
                  {t('servicePrincipals.actions.keys', { defaultValue: 'Keys' })}
                </Button>
              </>
            )}
            {!hasPro && !record.is_inactive && (
              <Button
                id={`service-principal-deactivate-${record.user_id}`}
                size="sm"
                variant="outline"
                onClick={() => void handleToggleActive(record, false)}
              >
                {t('servicePrincipals.actions.deactivate', { defaultValue: 'Deactivate' })}
              </Button>
            )}
            <Button
              id={`service-principal-delete-${record.user_id}`}
              size="sm"
              variant="outline"
              onClick={() => setPendingDelete(record)}
            >
              {t('servicePrincipals.actions.delete', { defaultValue: 'Delete' })}
            </Button>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, formatDate, hasPro, handleToggleActive],
  );

  const activeRows = rows.filter((row) => !row.archived_at);

  // Below Pro with nothing grandfathered: the upgrade notice is the whole tab.
  if (!hasPro && loaded && activeRows.length === 0) {
    return (
      <TierGate
        feature={TIER_FEATURES.SERVICE_PRINCIPALS}
        featureName={t('servicePrincipals.featureName', { defaultValue: 'Service principals' })}
      >
        {null}
      </TierGate>
    );
  }

  return (
    <Card className="p-6 space-y-4" id="service-principals-settings">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold">{t('servicePrincipals.title', { defaultValue: 'Service principals' })}</h3>
          <p className="text-sm text-gray-500">
            {t('servicePrincipals.description', {
              defaultValue: 'Non-human identities with their own roles and API keys for integrations and agents.',
            })}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {usage && (
            <span className="text-sm font-medium" data-testid="service-principal-usage">
              {t('servicePrincipals.usage.header', {
                defaultValue: '{{used}} of {{limit}} service principals',
                used: usage.used,
                limit: usage.limit,
              })}
            </span>
          )}
          <Button
            id="service-principal-new"
            disabled={!canCreate}
            onClick={() => setDialog({ open: true, principal: null })}
          >
            {t('servicePrincipals.actions.new', { defaultValue: 'New service principal' })}
          </Button>
        </div>
      </div>

      {!hasPro && (
        <Alert variant="info" data-testid="service-principal-grandfathered-notice">
          <AlertDescription>
            {t('servicePrincipals.grandfathered', {
              defaultValue:
                'Service principals require the Pro plan. Your existing principals are kept, but you can only deactivate or delete them.',
            })}
          </AlertDescription>
        </Alert>
      )}
      {hasPro && atLimit && (
        <p className="text-sm text-gray-500" data-testid="service-principal-limit-reached">
          {t('servicePrincipals.limitReached', {
            defaultValue:
              'You have reached your limit of {{limit}} active service principals. Deactivate or delete one to add another.',
            limit: usage?.limit ?? 0,
          })}
        </p>
      )}

      <DataTable id="service-principals-table" data={activeRows} columns={columns} pagination={false} />

      <ServicePrincipalDialog
        isOpen={dialog.open}
        principal={dialog.principal}
        roles={options.roles}
        rateLimitCeiling={options.rateLimitCeiling}
        onClose={() => setDialog({ open: false, principal: null })}
        onSaved={() => {
          setDialog({ open: false, principal: null });
          void load();
        }}
      />
      <ServicePrincipalKeysDialog
        principal={keysFor}
        canIssue={hasPro}
        onClose={() => setKeysFor(null)}
        onChanged={() => void load()}
      />
      <ConfirmationDialog
        id="service-principal-delete-confirm"
        isOpen={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={handleDelete}
        title={t('servicePrincipals.delete.title', { defaultValue: 'Delete service principal?' })}
        message={t('servicePrincipals.delete.message', {
          defaultValue: 'Its API keys stop working. If it has history it is archived rather than removed.',
        })}
        confirmLabel={t('servicePrincipals.actions.delete', { defaultValue: 'Delete' })}
        cancelLabel={t('servicePrincipals.dialog.cancel', { defaultValue: 'Cancel' })}
      />
    </Card>
  );
}

export default ServicePrincipalsSettingsTab;
