'use client';

import React, { useCallback, useEffect, useState, useTransition } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { ContactPicker } from '@alga-psa/ui/components/ContactPicker';
import { useQuickAddClient } from '@alga-psa/ui/context';
import { getAllClients, getAllContacts } from '@alga-psa/clients/actions';
import type { IClient, IContact } from '@alga-psa/types';
import { Building2, RefreshCw } from 'lucide-react';
import {
  getHuntressOrganizationMappings,
  syncHuntressOrganizationMappings,
  updateHuntressOrganizationMapping,
} from '../../../../lib/actions/integrations/huntressActions';
import type { RmmOrganizationMapping } from '../../../../interfaces/rmm.interfaces';

interface Props {
  refreshKey?: number;
  onMappingChanged?: () => void;
}

function isAutoMatched(mapping: RmmOrganizationMapping): boolean {
  const metadata =
    typeof mapping.metadata === 'string'
      ? (() => {
          try {
            return JSON.parse(mapping.metadata as unknown as string);
          } catch {
            return {};
          }
        })()
      : mapping.metadata ?? {};
  return (metadata as Record<string, unknown>).auto_matched === true;
}

const HuntressOrganizationMappingManager: React.FC<Props> = ({ refreshKey, onMappingChanged }) => {
  const [mappings, setMappings] = useState<RmmOrganizationMapping[]>([]);
  const [clients, setClients] = useState<IClient[]>([]);
  const [contacts, setContacts] = useState<IContact[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const { renderQuickAddContact } = useQuickAddClient();
  const [quickAddContactFor, setQuickAddContactFor] = useState<{
    mappingId: string;
    clientId: string;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [mappingsResult, clientsResult, contactsResult] = await Promise.all([
        getHuntressOrganizationMappings(),
        getAllClients(false),
        getAllContacts('active'),
      ]);
      setMappings(mappingsResult);
      setClients(clientsResult ?? []);
      setContacts(contactsResult ?? []);
    } catch {
      setError('Failed to load organization mappings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const handleSync = () => {
    startTransition(async () => {
      const result = await syncHuntressOrganizationMappings();
      if (!result.success) setError(result.error ?? 'Sync failed');
      await load();
      onMappingChanged?.();
    });
  };

  const handleClientChange = (mappingId: string, clientId: string | null) => {
    startTransition(async () => {
      const result = await updateHuntressOrganizationMapping(mappingId, {
        client_id: clientId,
        default_contact_id: null,
      });
      if (!result.success) setError(result.error ?? 'Failed to update mapping');
      await load();
      onMappingChanged?.();
    });
  };

  const handleDefaultContactChange = (mappingId: string, contactId: string) => {
    startTransition(async () => {
      const result = await updateHuntressOrganizationMapping(mappingId, {
        default_contact_id: contactId || null,
      });
      if (!result.success) setError(result.error ?? 'Failed to update default contact');
      await load();
      onMappingChanged?.();
    });
  };

  const handleAutoCreateToggle = (mappingId: string, enabled: boolean) => {
    startTransition(async () => {
      const result = await updateHuntressOrganizationMapping(mappingId, {
        auto_create_tickets: enabled,
      });
      if (!result.success) setError(result.error ?? 'Failed to update mapping');
      await load();
      onMappingChanged?.();
    });
  };

  const unmappedCount = mappings.filter((m) => !m.client_id).length;

  return (
    <>
    <Card id="huntress-org-mappings">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" /> Organization Mapping
            </CardTitle>
            <CardDescription>
              Map Huntress organizations to clients. Incidents for unmapped organizations go to the
              fallback client and triage board{unmappedCount > 0 ? ` (${unmappedCount} unmapped)` : ''}.
            </CardDescription>
          </div>
          <Button
            id="huntress-sync-orgs"
            variant="outline"
            onClick={handleSync}
            disabled={isPending}
          >
            <RefreshCw className="mr-1 h-4 w-4" /> Sync organizations
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : mappings.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No organizations yet — click "Sync organizations".
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Huntress Organization</th>
                <th className="py-2 pr-4 font-medium">Alga Client</th>
                <th className="py-2 pr-4 font-medium">Default Contact</th>
                <th className="py-2 pr-4 font-medium">Create Tickets</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {mappings.map((mapping) => (
                <tr key={mapping.mapping_id} className="border-b last:border-0">
                  <td className="py-2 pr-4">{mapping.external_organization_name}</td>
                  <td className="py-2 pr-4">
                    <ClientPicker
                      id={`huntress-client-picker-${mapping.mapping_id}`}
                      clients={clients}
                      selectedClientId={mapping.client_id ?? null}
                      onSelect={(clientId) => handleClientChange(mapping.mapping_id, clientId)}
                      filterState="active"
                      onFilterStateChange={() => {}}
                      clientTypeFilter="all"
                      onClientTypeFilterChange={() => {}}
                    />
                  </td>
                  <td className="py-2 pr-4">
                    <ContactPicker
                      id={`huntress-default-contact-picker-${mapping.mapping_id}`}
                      contacts={contacts}
                      value={mapping.default_contact_id ?? ''}
                      onValueChange={(contactId) =>
                        handleDefaultContactChange(mapping.mapping_id, contactId)
                      }
                      clientId={mapping.client_id ?? undefined}
                      disabled={!mapping.client_id}
                      placeholder="Select contact"
                      onAddNew={
                        mapping.client_id
                          ? () =>
                              setQuickAddContactFor({
                                mappingId: mapping.mapping_id,
                                clientId: mapping.client_id!,
                              })
                          : undefined
                      }
                    />
                  </td>
                  <td className="py-2 pr-4">
                    <input
                      id={`huntress-auto-create-${mapping.mapping_id}`}
                      type="checkbox"
                      checked={mapping.auto_create_tickets !== false}
                      onChange={(e) =>
                        handleAutoCreateToggle(mapping.mapping_id, e.target.checked)
                      }
                    />
                  </td>
                  <td className="py-2">
                    {mapping.client_id ? (
                      isAutoMatched(mapping) ? (
                        <Badge variant="secondary">Auto-matched</Badge>
                      ) : (
                        <Badge variant="default">Mapped</Badge>
                      )
                    ) : (
                      <Badge variant="outline">Unmapped → triage</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
    {renderQuickAddContact({
      isOpen: !!quickAddContactFor,
      onClose: () => setQuickAddContactFor(null),
      onContactAdded: (newContact) => {
        setContacts((prev) => {
          const i = prev.findIndex((c) => c.contact_name_id === newContact.contact_name_id);
          if (i >= 0) {
            const next = [...prev];
            next[i] = newContact;
            return next;
          }
          return [...prev, newContact];
        });
        if (quickAddContactFor) {
          handleDefaultContactChange(quickAddContactFor.mappingId, newContact.contact_name_id);
        }
        setQuickAddContactFor(null);
      },
      clients,
      selectedClientId: quickAddContactFor?.clientId ?? null,
    })}
    </>
  );
};

export default HuntressOrganizationMappingManager;
