'use client';

import { rmmMappingErrorMessage } from '@alga-psa/integrations/components/settings/integrations/rmmMappingErrors';
import React, { useCallback, useEffect, useState, useTransition } from 'react';
import { buildRmmPeopleModeOptions, RmmUserContactMappingPanel } from '@alga-psa/integrations/components/settings/integrations/RmmUserContactMappingPanel';
import { RmmOrganizationClientChangeDialog } from '@alga-psa/integrations/components/settings/integrations/RmmOrganizationClientChangeDialog';
import { RmmOrganizationBillingProfileSelect } from '@alga-psa/integrations/components/settings/integrations/RmmOrganizationBillingProfileSelect';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
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
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useQuickAddClient } from '@alga-psa/ui/context';
import { getAllClients, getAllContacts } from '@alga-psa/clients/actions';
import type { IClient, IContact, ColumnDefinition } from '@alga-psa/types';
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
  const { t } = useTranslation('msp/integrations');
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
      setError(t('integrations.rmm.huntress.errors.load', { defaultValue: 'Failed to load organization mappings' }));
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
      if (!result.success) setError(rmmMappingErrorMessage(t, result.error, t('integrations.rmm.huntress.errors.sync', { defaultValue: 'Sync failed' })));
      await load();
      onMappingChanged?.();
    });
  };

  // FR-G4: re-pointing an organization moves its devices, so confirm first.
  const [pendingClientChange, setPendingClientChange] = useState<{ mappingId: string; clientId: string | null } | null>(null);

  const handleClientChangeConfirmed = (mappingId: string, clientId: string | null) => {
    startTransition(async () => {
      const result = await updateHuntressOrganizationMapping(mappingId, {
        client_id: clientId,
        default_contact_id: null,
      });
      if (!result.success) setError(rmmMappingErrorMessage(t, result.error, t('integrations.rmm.huntress.errors.updateMapping', { defaultValue: 'Failed to update mapping' })));
      await load();
      onMappingChanged?.();
    });
  };

  const handleDefaultContactChange = (mappingId: string, contactId: string) => {
    startTransition(async () => {
      const result = await updateHuntressOrganizationMapping(mappingId, {
        default_contact_id: contactId || null,
      });
      if (!result.success) setError(rmmMappingErrorMessage(t, result.error, t('integrations.rmm.huntress.errors.updateContact', { defaultValue: 'Failed to update default contact' })));
      await load();
      onMappingChanged?.();
    });
  };

  const handlePeopleModeChange = (mappingId: string, mode: string) => {
    startTransition(async () => {
      const result = await updateHuntressOrganizationMapping(mappingId, {
        contact_assignment_mode: mode,
      });
      if (!result.success) {
        setError(rmmMappingErrorMessage(t, result.error, t('integrations.rmm.peopleMode.updateFailed', { defaultValue: 'Failed to update the people mode' })));
      }
      await load();
      onMappingChanged?.();
    });
  };

  // F090: the profile this organization's alert tickets are attributed to.
  const handleBillingProfileChange = (mappingId: string, billingProfileId: string | null) => {
    startTransition(async () => {
      const result = await updateHuntressOrganizationMapping(mappingId, {
        billing_profile_id: billingProfileId,
      });
      if (!result.success) {
        setError(rmmMappingErrorMessage(t, result.error, t('integrations.rmm.billingProfile.updateFailed', { defaultValue: 'Failed to update the billing profile' })));
      }
      await load();
      onMappingChanged?.();
    });
  };

  const peopleModeOptions = buildRmmPeopleModeOptions(t);

  const handleAutoCreateToggle = (mappingId: string, enabled: boolean) => {
    startTransition(async () => {
      const result = await updateHuntressOrganizationMapping(mappingId, {
        auto_create_tickets: enabled,
      });
      if (!result.success) setError(rmmMappingErrorMessage(t, result.error, t('integrations.rmm.huntress.errors.updateMapping', { defaultValue: 'Failed to update mapping' })));
      await load();
      onMappingChanged?.();
    });
  };

  const unmappedCount = mappings.filter((m) => !m.client_id).length;

  const handleClientChange = (mappingId: string, clientId: string | null) => {
    const current = mappings.find((m) => m.mapping_id === mappingId);
    if (clientId && current?.client_id && current.client_id !== clientId) {
      setPendingClientChange({ mappingId: mappingId, clientId: clientId });
      return;
    }
    void handleClientChangeConfirmed(mappingId, clientId);
  };

  const columns: ColumnDefinition<RmmOrganizationMapping>[] = [
    {
      title: t('integrations.rmm.huntress.columns.organization', { defaultValue: 'Huntress Organization' }),
      dataIndex: 'external_organization_name',
      render: (_v, mapping) => mapping.external_organization_name,
    },
    {
      title: t('integrations.rmm.huntress.columns.client', { defaultValue: 'Alga Client' }),
      dataIndex: 'client_id',
      sortable: false,
      render: (_v, mapping) => (
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
      ),
    },
    {
      // FR-D8: what sync does with the device's signed-in user.
      title: t('integrations.rmm.peopleMode.label', { defaultValue: 'People' }),
      dataIndex: 'contact_assignment_mode',
      sortable: false,
      render: (_v, mapping) => (
        <CustomSelect
          id={`rmm-org-people-mode-${mapping.mapping_id}`}
          value={mapping.contact_assignment_mode ?? 'suggest'}
          onValueChange={(mode) => void handlePeopleModeChange(mapping.mapping_id, mode)}
          options={peopleModeOptions}
          className="min-w-[160px]"
        />
      ),
    },
    {
      // F090: which profile this organization's alert tickets bill to.
      title: t('integrations.rmm.billingProfile.label', { defaultValue: 'Billing profile' }),
      dataIndex: 'billing_profile_id',
      sortable: false,
      render: (_v, mapping) => (
        <RmmOrganizationBillingProfileSelect
          mappingId={mapping.mapping_id}
          clientId={mapping.client_id}
          value={(mapping as { billing_profile_id?: string | null }).billing_profile_id}
          onChange={(billingProfileId) => handleBillingProfileChange(mapping.mapping_id, billingProfileId)}
        />
      ),
    },
    {
      title: t('integrations.rmm.huntress.columns.defaultContact', { defaultValue: 'Default Contact' }),
      dataIndex: 'default_contact_id',
      sortable: false,
      render: (_v, mapping) => (
        <ContactPicker
          id={`huntress-default-contact-picker-${mapping.mapping_id}`}
          contacts={contacts}
          value={mapping.default_contact_id ?? ''}
          onValueChange={(contactId) =>
            handleDefaultContactChange(mapping.mapping_id, contactId)
          }
          clientId={mapping.client_id ?? undefined}
          disabled={!mapping.client_id}
          placeholder={t('integrations.rmm.huntress.selectContact', { defaultValue: 'Select contact' })}
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
      ),
    },
    {
      title: t('integrations.rmm.huntress.columns.createTickets', { defaultValue: 'Create Tickets' }),
      dataIndex: 'auto_create_tickets',
      sortable: false,
      render: (_v, mapping) => (
        <input
          id={`huntress-auto-create-${mapping.mapping_id}`}
          type="checkbox"
          checked={mapping.auto_create_tickets !== false}
          onChange={(e) => handleAutoCreateToggle(mapping.mapping_id, e.target.checked)}
        />
      ),
    },
    {
      title: t('integrations.rmm.huntress.columns.status', { defaultValue: 'Status' }),
      dataIndex: 'mapping_id',
      sortable: false,
      render: (_v, mapping) =>
        mapping.client_id ? (
          isAutoMatched(mapping) ? (
            <Badge variant="secondary">{t('integrations.rmm.huntress.status.autoMatched', { defaultValue: 'Auto-matched' })}</Badge>
          ) : (
            <Badge variant="default">{t('integrations.rmm.huntress.status.mapped', { defaultValue: 'Mapped' })}</Badge>
          )
        ) : (
          <Badge variant="outline">{t('integrations.rmm.huntress.status.unmapped', { defaultValue: 'Unmapped → triage' })}</Badge>
        ),
    },
  ];

  return (
    <>
    <RmmOrganizationClientChangeDialog
      mappingId={pendingClientChange?.mappingId ?? null}
      pendingClientName={clients.find((c) => c.client_id === pendingClientChange?.clientId)?.client_name ?? null}
      isOpen={Boolean(pendingClientChange)}
      onCancel={() => setPendingClientChange(null)}
      onConfirm={() => {
        const pending = pendingClientChange;
        setPendingClientChange(null);
        if (pending) handleClientChangeConfirmed(pending.mappingId, pending.clientId);
      }}
    />
    <Card id="huntress-org-mappings">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" /> {t('integrations.rmm.huntress.title', { defaultValue: 'Organization Mapping' })}
            </CardTitle>
            <CardDescription>
              {t('integrations.rmm.huntress.description', { defaultValue: 'Map Huntress organizations to clients. Incidents for unmapped organizations go to the fallback client and triage board.' })}
              {unmappedCount > 0 ? ` ${t('integrations.rmm.huntress.unmappedSuffix', { defaultValue: '({{count}} unmapped)', count: unmappedCount })}` : ''}
            </CardDescription>
          </div>
          <Button
            id="huntress-sync-orgs"
            variant="outline"
            onClick={handleSync}
            disabled={isPending}
          >
            <RefreshCw className="mr-1 h-4 w-4" /> {t('integrations.rmm.huntress.syncButton', { defaultValue: 'Sync organizations' })}
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
          <p className="py-6 text-center text-sm text-muted-foreground">{t('integrations.rmm.huntress.loading', { defaultValue: 'Loading…' })}</p>
        ) : mappings.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t('integrations.rmm.huntress.empty', { defaultValue: 'No organizations yet — click "Sync organizations".' })}
          </p>
        ) : (
          <>
            <DataTable
              id="huntress-org-mappings"
              data={mappings}
              columns={columns}
              pagination
            />
            {/* FR-D8: one Signed-in users panel per mapped organization. */}
            {mappings
              .filter((m) => m.client_id)
              .map((m) => (
                <div key={`signed-in-${m.mapping_id}`} className="mt-4 border-t pt-4">
                  <div className="mb-2 text-sm font-medium">
                    {m.external_organization_name || m.external_organization_id}
                  </div>
                  <RmmUserContactMappingPanel
                    mappingId={m.mapping_id}
                    clientId={m.client_id ?? null}
                    contacts={contacts}
                    idPrefix={`huntress-signed-in-${m.mapping_id}`}
                  />
                </div>
              ))}
          </>
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
