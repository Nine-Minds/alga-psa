'use client';

/**
 * NinjaOne Organization Mapping Manager
 *
 * Allows mapping NinjaOne organizations to Alga PSA companies.
 * Devices can only be synced for organizations that have a company mapping.
 */

import React, { useEffect, useState, useTransition } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Building2, Link2, Link2Off, RefreshCw, Check } from 'lucide-react';
import {
  getNinjaOneOrganizationMappings,
  updateNinjaOneOrganizationMapping,
  syncNinjaOneOrganizations,
} from '../../../../lib/actions/integrations/ninjaoneActions';
import { getAllClients } from '@/lib/actions/client-actions/clientActions';
import { RmmOrganizationMapping } from '../../../../interfaces/rmm.interfaces';
import { IClient } from '@/interfaces/client.interfaces';

interface OrganizationMappingManagerProps {
  onMappingChanged?: () => void;
}

const OrganizationMappingManager: React.FC<OrganizationMappingManagerProps> = ({
  onMappingChanged,
}) => {
  const [mappings, setMappings] = useState<RmmOrganizationMapping[]>([]);
  const [companies, setCompanies] = useState<IClient[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSyncing, startSyncTransition] = useTransition();
  const [savingMappingId, setSavingMappingId] = useState<string | null>(null);

  const loadData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [mappingsResult, companiesResult] = await Promise.all([
        getNinjaOneOrganizationMappings(),
        getAllClients(false), // Only active clients
      ]);
      setMappings(mappingsResult);
      setCompanies(companiesResult);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load organization mappings';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSyncOrganizations = () => {
    startSyncTransition(async () => {
      setError(null);
      setSuccessMessage(null);
      try {
        const result = await syncNinjaOneOrganizations();
        if (result.success) {
          setSuccessMessage(
            `Synced ${result.items_processed} organizations (${result.items_created} new, ${result.items_updated} updated)`
          );
          await loadData();
        } else {
          setError(result.errors?.join('; ') ?? 'Failed to sync organizations');
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to sync organizations';
        setError(message);
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
      });
      if (result.success) {
        // Update local state
        setMappings((prev) =>
          prev.map((m) =>
            m.mapping_id === mappingId
              ? { ...m, client_id: companyId ?? undefined }
              : m
          )
        );
        setSuccessMessage('Mapping updated successfully');
        onMappingChanged?.();
      } else {
        setError(result.error ?? 'Failed to update mapping');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update mapping';
      setError(message);
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
        setError(result.error ?? 'Failed to update auto-sync setting');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update auto-sync setting';
      setError(message);
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
            Organization Mappings
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            Loading organization mappings...
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Organization Mappings
            </CardTitle>
            <CardDescription>
              Map NinjaOne organizations to Alga companies to enable device sync
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
                Syncing...
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh Organizations
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
            {mappedCount} mapped
          </span>
          <span className="flex items-center gap-1">
            <Link2Off className="h-4 w-4 text-amber-500" />
            {unmappedCount} unmapped
          </span>
        </div>

        {mappings.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <Building2 className="mx-auto h-10 w-10 text-muted-foreground/50" />
            <p className="mt-2 text-sm text-muted-foreground">
              No organizations synced yet.
            </p>
            <p className="text-xs text-muted-foreground">
              Click &quot;Refresh Organizations&quot; to fetch organizations from NinjaOne.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 text-left text-sm font-medium">
                    NinjaOne Organization
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-medium">
                    Alga Company
                  </th>
                  <th className="px-4 py-3 text-center text-sm font-medium">
                    Auto-Sync
                  </th>
                  <th className="px-4 py-3 text-center text-sm font-medium w-16">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {mappings.map((mapping) => (
                  <tr
                    key={mapping.mapping_id}
                    className="border-b last:border-b-0 hover:bg-muted/30"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium">
                        {mapping.external_organization_name || `Org ${mapping.external_organization_id}`}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        ID: {mapping.external_organization_id}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        className="w-full rounded-md border bg-background px-3 py-1.5 text-sm"
                        value={mapping.client_id || ''}
                        onChange={(e) =>
                          handleCompanyChange(
                            mapping.mapping_id,
                            e.target.value || null
                          )
                        }
                        disabled={savingMappingId === mapping.mapping_id}
                      >
                        <option value="">-- Select Company --</option>
                        {companies.map((company) => (
                          <option key={company.client_id} value={company.client_id}>
                            {company.client_name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-gray-300"
                        checked={mapping.auto_sync_assets}
                        onChange={(e) =>
                          handleAutoSyncChange(mapping.mapping_id, e.target.checked)
                        }
                        disabled={savingMappingId === mapping.mapping_id}
                      />
                    </td>
                    <td className="px-4 py-3 text-center">
                      {mapping.client_id ? (
                        <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                          <Check className="mr-1 h-3 w-3" />
                          Mapped
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                          Unmapped
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {unmappedCount > 0 && (
          <p className="text-xs text-muted-foreground">
            Devices from unmapped organizations will not be synced. Map each organization to an
            Alga company to enable device synchronization.
          </p>
        )}
      </CardContent>
    </Card>
  );
};

export default OrganizationMappingManager;
