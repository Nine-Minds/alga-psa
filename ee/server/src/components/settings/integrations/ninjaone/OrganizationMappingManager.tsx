'use client';

/**
 * NinjaOne Organization Mapping Manager
 *
 * Allows mapping NinjaOne organizations to Alga PSA companies.
 * Devices can only be synced for organizations that have a company mapping.
 */

import React, { useEffect, useRef, useState, useTransition } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Building2, Link2, Link2Off, RefreshCw, Check } from 'lucide-react';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { ContactPicker } from '@alga-psa/ui/components/ContactPicker';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import {
  getNinjaOneOrganizationMappings,
  updateNinjaOneOrganizationMapping,
  syncNinjaOneOrganizations,
} from '../../../../lib/actions/integrations/ninjaoneActions';
import { getAllClients } from '@alga-psa/clients/actions';
import { getAllContacts } from '@alga-psa/clients/actions';
import { RmmOrganizationMapping } from '../../../../interfaces/rmm.interfaces';
import type { IClient, IContact, ColumnDefinition } from '@alga-psa/types';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useQuickAddClient } from '@alga-psa/ui/context';

interface OrganizationMappingManagerProps {
  onMappingChanged?: () => void;
  /**
   * When this value changes, reload mappings from the server.
   * Useful for parent-driven refresh after a top-level sync.
   */
  refreshKey?: number;
}

const OrganizationMappingManager: React.FC<OrganizationMappingManagerProps> = ({
  onMappingChanged,
  refreshKey,
}) => {
  const { t } = useTranslation('msp/integrations');
  const { renderQuickAddContact } = useQuickAddClient();
  const [quickAddContactFor, setQuickAddContactFor] = useState<{ mappingId: string; clientId: string } | null>(null);
  const [mappings, setMappings] = useState<RmmOrganizationMapping[]>([]);
  const [companies, setCompanies] = useState<IClient[]>([]);
  const [contacts, setContacts] = useState<IContact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSyncing, startSyncTransition] = useTransition();
  const [savingMappingId, setSavingMappingId] = useState<string | null>(null);

  const loadData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [mappingsResult, companiesResult, contactsResult] = await Promise.all([
        getNinjaOneOrganizationMappings(),
        getAllClients(false), // Only active clients
        getAllContacts('active'),
      ]);
      setMappings(mappingsResult);
      setCompanies(companiesResult);
      setContacts(contactsResult ?? []);
    } catch (err) {
      console.error('Failed to load NinjaOne organization mappings:', err);
      setError(t('integrations.rmm.ninjaone.errors.load', { defaultValue: 'Failed to load organization mappings' }));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Parent-driven refresh without double-fetching on mount.
  const lastRefreshKeyRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (refreshKey === undefined) return;
    if (lastRefreshKeyRef.current === undefined) {
      lastRefreshKeyRef.current = refreshKey;
      return;
    }
    if (refreshKey !== lastRefreshKeyRef.current) {
      lastRefreshKeyRef.current = refreshKey;
      loadData();
    }
  }, [refreshKey]);

  const handleSyncOrganizations = () => {
    startSyncTransition(async () => {
      setError(null);
      setSuccessMessage(null);
      try {
        const result = await syncNinjaOneOrganizations();
        if (result.success) {
          setSuccessMessage(
            t('integrations.rmm.ninjaone.success.synced', { defaultValue: 'Synced {{processed}} organizations ({{created}} new, {{updated}} updated)', processed: result.items_processed, created: result.items_created, updated: result.items_updated })
          );
          await loadData();
        } else {
          setError(result.errors?.join('; ') ?? t('integrations.rmm.ninjaone.errors.sync', { defaultValue: 'Failed to sync organizations' }));
        }
      } catch (err) {
        console.error('NinjaOne organization sync failed:', err);
        setError(t('integrations.rmm.ninjaone.errors.sync', { defaultValue: 'Failed to sync organizations' }));
      }
    });
  };

  const handleCompanyChange = async (mappingId: string, companyId: string | null) => {
    setSavingMappingId(mappingId);
    setError(null);
    setSuccessMessage(null);
    try {
      const result = await updateNinjaOneOrganizationMapping(mappingId, {
        company_id: companyId,
        default_contact_id: null,
      });
      if (result.success) {
        // Update local state
        setMappings((prev) =>
          prev.map((m) =>
            m.mapping_id === mappingId
              ? { ...m, client_id: companyId ?? undefined, default_contact_id: null }
              : m
          )
        );
        setSuccessMessage(t('integrations.rmm.ninjaone.success.mappingUpdated', { defaultValue: 'Mapping updated successfully' }));
        onMappingChanged?.();
      } else {
        setError(result.error ?? t('integrations.rmm.ninjaone.errors.updateMapping', { defaultValue: 'Failed to update mapping' }));
      }
    } catch (err) {
      console.error('NinjaOne organization mapping update failed:', err);
      setError(t('integrations.rmm.ninjaone.errors.updateMapping', { defaultValue: 'Failed to update mapping' }));
    } finally {
      setSavingMappingId(null);
    }
  };

  const handleDefaultContactChange = async (mappingId: string, contactId: string) => {
    setSavingMappingId(mappingId);
    setError(null);
    setSuccessMessage(null);
    try {
      const result = await updateNinjaOneOrganizationMapping(mappingId, {
        default_contact_id: contactId || null,
      });
      if (result.success) {
        setMappings((prev) =>
          prev.map((m) =>
            m.mapping_id === mappingId
              ? { ...m, default_contact_id: contactId || null }
              : m
          )
        );
        setSuccessMessage(t('integrations.rmm.ninjaone.success.contactUpdated', { defaultValue: 'Default contact updated successfully' }));
        onMappingChanged?.();
      } else {
        setError(result.error ?? t('integrations.rmm.ninjaone.errors.updateContact', { defaultValue: 'Failed to update default contact' }));
      }
    } catch (err) {
      console.error('NinjaOne default contact update failed:', err);
      setError(t('integrations.rmm.ninjaone.errors.updateContact', { defaultValue: 'Failed to update default contact' }));
    } finally {
      setSavingMappingId(null);
    }
  };

  const handleAutoSyncChange = async (mappingId: string, autoSync: boolean) => {
    setSavingMappingId(mappingId);
    setError(null);
    try {
      const result = await updateNinjaOneOrganizationMapping(mappingId, {
        auto_sync_assets: autoSync,
      });
      if (result.success) {
        setMappings((prev) =>
          prev.map((m) =>
            m.mapping_id === mappingId
              ? { ...m, auto_sync_assets: autoSync }
              : m
          )
        );
      } else {
        setError(result.error ?? t('integrations.rmm.ninjaone.errors.updateAutoSync', { defaultValue: 'Failed to update auto-sync setting' }));
      }
    } catch (err) {
      console.error('NinjaOne auto-sync update failed:', err);
      setError(t('integrations.rmm.ninjaone.errors.updateAutoSync', { defaultValue: 'Failed to update auto-sync setting' }));
    } finally {
      setSavingMappingId(null);
    }
  };

  const mappedCount = mappings.filter((m) => m.client_id).length;
  const unmappedCount = mappings.length - mappedCount;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            {t('integrations.rmm.ninjaone.title', { defaultValue: 'Organization Mappings' })}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            {t('integrations.rmm.ninjaone.loading', { defaultValue: 'Loading organization mappings...' })}
          </div>
        </CardContent>
      </Card>
    );
  }

  const columns: ColumnDefinition<RmmOrganizationMapping>[] = [
    {
      title: t('integrations.rmm.ninjaone.columns.organization', { defaultValue: 'NinjaOne Organization' }),
      dataIndex: 'external_organization_name',
      render: (_v, mapping) => (
        <>
          <div className="font-medium">
            {mapping.external_organization_name || t('integrations.rmm.ninjaone.orgFallback', { defaultValue: 'Org {{id}}', id: mapping.external_organization_id })}
          </div>
          <div className="text-xs text-muted-foreground">
            {t('integrations.rmm.ninjaone.idLabel', { defaultValue: 'ID: {{id}}', id: mapping.external_organization_id })}
          </div>
        </>
      ),
    },
    {
      title: t('integrations.rmm.ninjaone.columns.company', { defaultValue: 'Alga Company' }),
      dataIndex: 'client_id',
      sortable: false,
      render: (_v, mapping) => {
        const isSaving = savingMappingId === mapping.mapping_id;
        return (
          <div className={isSaving ? 'pointer-events-none opacity-60' : undefined}>
            <ClientPicker
              id={`ninjaone-company-picker-${mapping.mapping_id}`}
              clients={companies}
              selectedClientId={mapping.client_id ?? null}
              onSelect={(clientId) => {
                if (isSaving) return;
                handleCompanyChange(mapping.mapping_id, clientId);
              }}
              filterState="active"
              onFilterStateChange={() => {}}
              clientTypeFilter="company"
              onClientTypeFilterChange={() => {}}
              placeholder={t('integrations.rmm.ninjaone.selectCompany', { defaultValue: 'Select company' })}
              fitContent={true}
              className="w-full"
            />
          </div>
        );
      },
    },
    {
      title: t('integrations.rmm.ninjaone.columns.defaultContact', { defaultValue: 'Default Contact' }),
      dataIndex: 'default_contact_id',
      sortable: false,
      render: (_v, mapping) => {
        const isSaving = savingMappingId === mapping.mapping_id;
        return (
          <div className={isSaving ? 'pointer-events-none opacity-60' : undefined}>
            <ContactPicker
              id={`ninjaone-default-contact-picker-${mapping.mapping_id}`}
              contacts={contacts}
              value={mapping.default_contact_id ?? ''}
              onValueChange={(contactId) => {
                if (isSaving) return;
                handleDefaultContactChange(mapping.mapping_id, contactId);
              }}
              clientId={mapping.client_id ?? undefined}
              disabled={!mapping.client_id || isSaving}
              placeholder={t('integrations.rmm.ninjaone.selectContact', { defaultValue: 'Select contact' })}
              onAddNew={mapping.client_id ? () => setQuickAddContactFor({ mappingId: mapping.mapping_id, clientId: mapping.client_id! }) : undefined}
            />
          </div>
        );
      },
    },
    {
      title: t('integrations.rmm.ninjaone.columns.autoSync', { defaultValue: 'Auto-Sync' }),
      dataIndex: 'auto_sync_assets',
      sortable: false,
      headerClassName: 'text-center',
      cellClassName: 'text-center',
      render: (_v, mapping) => {
        const isSaving = savingMappingId === mapping.mapping_id;
        return (
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-gray-300"
            checked={mapping.auto_sync_assets}
            onChange={(e) =>
              handleAutoSyncChange(mapping.mapping_id, e.target.checked)
            }
            disabled={isSaving}
          />
        );
      },
    },
    {
      title: t('integrations.rmm.ninjaone.columns.status', { defaultValue: 'Status' }),
      dataIndex: 'client_id',
      sortable: false,
      width: '4rem',
      headerClassName: 'text-center',
      cellClassName: 'text-center',
      render: (_v, mapping) =>
        mapping.client_id ? (
          <span className="inline-flex items-center rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success">
            <Check className="mr-1 h-3 w-3" />
            {t('integrations.rmm.ninjaone.status.mapped', { defaultValue: 'Mapped' })}
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning-foreground">
            {t('integrations.rmm.ninjaone.status.unmapped', { defaultValue: 'Unmapped' })}
          </span>
        ),
    },
  ];

  return (
    <>
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              {t('integrations.rmm.ninjaone.title', { defaultValue: 'Organization Mappings' })}
            </CardTitle>
            <CardDescription>
              {t('integrations.rmm.ninjaone.description', { defaultValue: 'Map NinjaOne organizations to Alga companies to enable device sync' })}
            </CardDescription>
          </div>
          <Button
            id="ninjaone-sync-organizations-btn"
            variant="outline"
            size="sm"
            onClick={handleSyncOrganizations}
            disabled={isSyncing}
          >
            {isSyncing ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                {t('integrations.rmm.ninjaone.syncing', { defaultValue: 'Syncing...' })}
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" />
                {t('integrations.rmm.ninjaone.refreshButton', { defaultValue: 'Refresh Organizations' })}
              </>
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {successMessage && (
          <Alert variant="success">
            <AlertDescription>{successMessage}</AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Summary */}
        <div className="flex gap-4 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <Link2 className="h-4 w-4 text-green-500" />
            {t('integrations.rmm.ninjaone.summary.mapped', { defaultValue: '{{count}} mapped', count: mappedCount })}
          </span>
          <span className="flex items-center gap-1">
            <Link2Off className="h-4 w-4 text-amber-500" />
            {t('integrations.rmm.ninjaone.summary.unmapped', { defaultValue: '{{count}} unmapped', count: unmappedCount })}
          </span>
        </div>

        {mappings.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <Building2 className="mx-auto h-10 w-10 text-muted-foreground/50" />
            <p className="mt-2 text-sm text-muted-foreground">
              {t('integrations.rmm.ninjaone.empty.title', { defaultValue: 'No organizations synced yet.' })}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('integrations.rmm.ninjaone.empty.hint', { defaultValue: 'Click "Refresh Organizations" to fetch organizations from NinjaOne.' })}
            </p>
          </div>
        ) : (
          <div className="rounded-lg border">
            <DataTable
              id="ninjaone-org-mappings"
              data={mappings}
              columns={columns}
              pagination
            />
          </div>
        )}

        {unmappedCount > 0 && (
          <p className="text-xs text-muted-foreground">
            {t('integrations.rmm.ninjaone.unmappedNote', { defaultValue: 'Devices from unmapped organizations will not be synced. Map each organization to an Alga company to enable device synchronization.' })}
          </p>
        )}
      </CardContent>
    </Card>
    {renderQuickAddContact({
      isOpen: !!quickAddContactFor,
      onClose: () => setQuickAddContactFor(null),
      onContactAdded: (newContact) => {
        setContacts((prev) => {
          const i = prev.findIndex((c) => c.contact_name_id === newContact.contact_name_id);
          if (i >= 0) { const next = [...prev]; next[i] = newContact; return next; }
          return [...prev, newContact];
        });
        if (quickAddContactFor) handleDefaultContactChange(quickAddContactFor.mappingId, newContact.contact_name_id);
        setQuickAddContactFor(null);
      },
      clients: companies,
      selectedClientId: quickAddContactFor?.clientId ?? null,
    })}
    </>
  );
};

export default OrganizationMappingManager;
