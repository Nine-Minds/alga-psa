'use client'

/* global process */

import React from 'react';
import { Card, CardContent } from "@alga-psa/ui/components/Card";
import { Input } from "@alga-psa/ui/components/Input";
import { Button } from "@alga-psa/ui/components/Button";
import { Label } from "@alga-psa/ui/components/Label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@alga-psa/ui/components/Table";
import { Badge } from "@alga-psa/ui/components/Badge";
import { Alert, AlertDescription } from "@alga-psa/ui/components/Alert";
import { Switch } from "@alga-psa/ui/components/Switch";
import { ConfirmationDialog } from "@alga-psa/ui/components/ConfirmationDialog";
import { Plus, Trash } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  handleError,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { getTenantDetails, updateTenantName, addClientToTenant, removeClientFromTenant, setDefaultClient } from "@alga-psa/tenancy/actions/coreTenantActions";
import { getTenantTimezoneAuth, setTenantTimezone } from "@alga-psa/tenancy/actions/tenant-settings-actions/tenantSettingsActions";
import {
  getDashboardWelcomeSettingsAction,
  setDashboardWelcomeUseCompanyNameAction,
} from "@alga-psa/tenancy/actions/tenant-settings-actions/dashboardWelcomeActions";
import { getAllClients } from "@alga-psa/clients/actions/queryActions";
import {
  getClientCountryDefaultsPreview,
  type IClientCountryDefaultsPreview,
} from "@alga-psa/clients/actions/countryActions";
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import TimezonePicker from '@alga-psa/ui/components/TimezonePicker';
import { IClient } from "@alga-psa/types";
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { describeCountryDefaults } from './countryDefaultsPreview';

const isReturnedActionError = (value: unknown) =>
  isActionMessageError(value) || isActionPermissionError(value);

/** Only Enterprise renders the branded welcome banner, so only it offers the opt-in. */
const isEEAvailable = process.env.NEXT_PUBLIC_EDITION === 'enterprise';

const GeneralSettings = () => {
  const { t } = useTranslation('msp/settings');
  const [tenantName, setTenantName] = React.useState('');
  const [tenantTimezone, setTenantTimezoneState] = React.useState('');
  const [clients, setClients] = React.useState<{ id: string; name: string; isDefault: boolean }[]>([]);

  React.useEffect(() => {
    loadTenantData();
  }, []);
  const [selectedClientId, setSelectedClientId] = React.useState<string | null>(null);
  const [allClients, setAllClients] = React.useState<IClient[]>([]);
  const [filterState, setFilterState] = React.useState<'all' | 'active' | 'inactive'>('active');
  const [clientTypeFilter, setClientTypeFilter] = React.useState<'all' | 'company' | 'individual'>('all');
  const [pendingDefaultClient, setPendingDefaultClient] = React.useState<{ id: string; name: string } | null>(null);
  const [welcomeUsesCompanyName, setWelcomeUsesCompanyName] = React.useState(false);
  const [welcomeSaving, setWelcomeSaving] = React.useState(false);
  const [countryDefaults, setCountryDefaults] = React.useState<Record<string, IClientCountryDefaultsPreview | null>>({});
  const requestedCountryDefaults = React.useRef<Set<string>>(new Set());

  const defaultClient = clients.find(c => c.isDefault) ?? null;
  const selectableClients = allClients.filter(c => !clients.some(tc => tc.id === c.client_id));

  const loadTenantData = async () => {
    try {
      const [tenant, tz, welcome] = await Promise.all([
        getTenantDetails(),
        getTenantTimezoneAuth(),
        // The banner opt-in is a nicety; it must not take the page down.
        getDashboardWelcomeSettingsAction().catch(() => null)
      ]);
      const safeTenantName = typeof tenant?.client_name === 'string' ? tenant.client_name : '';
      setTenantName(safeTenantName);
      setTenantTimezoneState(tz || '');
      setWelcomeUsesCompanyName(welcome?.useCompanyName === true);
      setClients((tenant.clients ?? []).map(c => ({
        id: c.client_id,
        name: c.client_name,
        isDefault: c.is_default
      })));
    } catch (error) {
      handleError(error, t('general.messages.error.loadTenantData'));
    }
  };

  // One fetch per client, kept so the dialog can show the current defaults and
  // the ones being considered side by side.
  const ensureCountryDefaults = React.useCallback((clientId?: string | null) => {
    if (!clientId || requestedCountryDefaults.current.has(clientId)) return;
    requestedCountryDefaults.current.add(clientId);
    getClientCountryDefaultsPreview(clientId)
      .then((preview) => setCountryDefaults(current => ({ ...current, [clientId]: preview })))
      .catch(() => setCountryDefaults(current => ({ ...current, [clientId]: null })));
  }, []);

  React.useEffect(() => {
    ensureCountryDefaults(defaultClient?.id);
    ensureCountryDefaults(pendingDefaultClient?.id);
  }, [defaultClient?.id, pendingDefaultClient?.id, ensureCountryDefaults]);

  const handleToggleWelcomeCompanyName = async (checked: boolean) => {
    setWelcomeSaving(true);
    const previous = welcomeUsesCompanyName;
    setWelcomeUsesCompanyName(checked);
    try {
      const result = await setDashboardWelcomeUseCompanyNameAction(checked);
      if (isReturnedActionError(result)) {
        setWelcomeUsesCompanyName(previous);
        handleError(result, t('dashboardWelcome.messages.saveFailed'));
        return;
      }
      toast.success(t('dashboardWelcome.messages.saved'));
    } catch (error) {
      setWelcomeUsesCompanyName(previous);
      handleError(error, t('dashboardWelcome.messages.saveFailed'));
    } finally {
      setWelcomeSaving(false);
    }
  };

  const handleSaveTenantName = async () => {
    try {
      await updateTenantName(tenantName);
      toast.success(t('general.messages.success.tenantNameUpdated'));
    } catch (error) {
      handleError(error, t('general.messages.error.updateTenantName'));
    }
  };

  const handleSaveTimezone = async () => {
    try {
      if (tenantTimezone) {
        const result = await setTenantTimezone(tenantTimezone);
        if (isReturnedActionError(result)) {
          handleError(result, t('general.messages.error.updateTimezone'));
          return;
        }
        toast.success(t('general.messages.success.timezoneUpdated'));
      }
    } catch (error) {
      handleError(error, t('general.messages.error.updateTimezone'));
    }
  };

  const handleAddClient = async () => {
    if (!selectedClientId) {
      toast.error(t('general.messages.error.selectClient'));
      return;
    }

    try {
      const clientToAdd = allClients.find(c => c.client_id === selectedClientId);
      if (!clientToAdd) {
        throw new Error(t('general.messages.error.clientNotFound'));
      }

      if (clients.some(c => c.id === selectedClientId)) {
        toast.error(t('general.messages.error.clientAlreadyAdded'));
        setSelectedClientId(null);
        return;
      }

      const newClient = {
        id: clientToAdd.client_id,
        name: clientToAdd.client_name,
        isDefault: clients.length === 0
      };
      
      await addClientToTenant(newClient.id);
      setClients([...clients, newClient]);
      setSelectedClientId(null);
      
      if (newClient.isDefault) {
        await setDefaultClient(newClient.id);
      }

      toast.success(t('general.messages.success.clientAdded'));
    } catch (error) {
      handleError(error, t('general.messages.error.addClient'));
    }
  };

  React.useEffect(() => {
    const loadClients = async () => {
      try {
        const clients = await getAllClients();
        setAllClients(clients);
      } catch (error) {
        handleError(error, t('general.messages.error.loadClients'));
      }
    };
    loadClients();
  }, []);

  const handleRemoveClient = async (clientId: string) => {
    try {
      await removeClientFromTenant(clientId);
      setClients(clients.filter(c => c.id !== clientId));
      toast.success(t('general.messages.success.clientRemoved'));
    } catch (error) {
      handleError(error, t('general.messages.error.removeClient'));
    }
  };

  const handleSetDefaultClient = async (clientId: string) => {
    try {
      await setDefaultClient(clientId);
      setClients(clients.map(c => ({
        ...c,
        isDefault: c.id === clientId
      })));
      toast.success(t('general.messages.success.defaultClientUpdated'));
    } catch (error) {
      handleError(error, t('general.messages.error.setDefaultClient'));
    }
  };

  const translate = React.useCallback(
    (key: string, options?: Record<string, unknown>) => t(key, options) as string,
    [t]
  );
  const currentDefaultsPreview = defaultClient ? countryDefaults[defaultClient.id] : null;
  const currentDefaults = currentDefaultsPreview
    ? describeCountryDefaults(currentDefaultsPreview, translate)
    : null;
  const pendingDefaultsPreview = pendingDefaultClient ? countryDefaults[pendingDefaultClient.id] : null;
  const pendingDefaults = pendingDefaultsPreview
    ? describeCountryDefaults(pendingDefaultsPreview, translate)
    : null;

  return (
    <Card>
      <CardContent className="space-y-6">
        <div className="space-y-4">
            <div>
              <Label htmlFor="tenantName">{t('general.fields.organizationName.label')}</Label>
              <Input
                id="tenantName"
                value={tenantName ?? ''}
                onChange={(e) => setTenantName(e.target.value)}
              />
            </div>
            <Button
              id="save-tenant-name-button"
              onClick={handleSaveTenantName}
            >
              {t('general.actions.saveOrganizationName')}
            </Button>
          </div>

        <div className="space-y-4">
            <div>
              <Label htmlFor="tenantTimezone">{t('general.fields.defaultTimezone.label')}</Label>
              <p className="text-sm text-muted-foreground mb-2">
                {t('general.fields.defaultTimezone.help')}
              </p>
              <TimezonePicker
                value={tenantTimezone}
                onValueChange={setTenantTimezoneState}
              />
            </div>
            <Button
              id="save-timezone-button"
              onClick={handleSaveTimezone}
              disabled={!tenantTimezone}
            >
              {t('general.actions.saveDefaultTimezone')}
            </Button>
          </div>

        <div className="space-y-4">
          <div className="space-y-1">
            <h3 className="text-lg font-semibold">{t('general.clients.title')}</h3>
            <p className="text-sm text-muted-foreground">{t('general.clients.help')}</p>
          </div>
          {defaultClient && (
            <p className="text-sm">
              {t('general.clients.currentDefault', { name: defaultClient.name })}
            </p>
          )}
          {isEEAvailable && (
            <div className="flex items-center justify-between gap-4 rounded-md border border-[rgb(var(--color-border-200))] p-4">
              <div>
                <p className="text-sm font-medium">{t('dashboardWelcome.label')}</p>
                <p className="text-sm text-muted-foreground">
                  {defaultClient ? t('dashboardWelcome.help') : t('dashboardWelcome.noCompany')}
                </p>
                {defaultClient && (
                  <p className="mt-1 text-sm">
                    {t('dashboardWelcome.previewLabel')}{' '}
                    <span className="font-medium">
                      {welcomeUsesCompanyName
                        ? t('dashboardWelcome.preview', { companyName: defaultClient.name })
                        : t('dashboardWelcome.previewDefault')}
                    </span>
                  </p>
                )}
              </div>
              <Switch
                id="dashboard-welcome-company-name-toggle"
                checked={welcomeUsesCompanyName}
                disabled={welcomeSaving || !defaultClient}
                onCheckedChange={handleToggleWelcomeCompanyName}
                aria-label={t('dashboardWelcome.label')}
              />
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('general.clients.table.name')}</TableHead>
                <TableHead>{t('general.clients.table.default')}</TableHead>
                <TableHead>{t('general.clients.table.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.map((client) => (
                <TableRow key={client.id}>
                  <TableCell>
                    <label htmlFor={`default-client-radio-${client.id}`} className="cursor-pointer inline-flex items-center gap-2">
                      {client.name}
                      {client.isDefault && (
                        <Badge variant="success" size="sm">{t('general.clients.yourCompanyBadge')}</Badge>
                      )}
                    </label>
                  </TableCell>
                  <TableCell>
                    <input
                      type="radio"
                      name="default-client"
                      id={`default-client-radio-${client.id}`}
                      checked={client.isDefault}
                      onChange={() => setPendingDefaultClient({ id: client.id, name: client.name })}
                      className="h-4 w-4 border-gray-300 text-primary-500 focus:ring-2 focus:ring-primary-500 focus:ring-offset-0 focus-visible:outline-none focus:outline-none cursor-pointer"
                      style={{
                        accentColor: 'rgb(var(--color-primary-500))',
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      id={`remove-client-button-${client.id}`}
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveClient(client.id)}
                    >
                      <Trash className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {defaultClient && currentDefaults && (
            <Alert variant="info" id="tenant-company-defaults-alert" data-automation-id="tenant-company-defaults-alert">
              <AlertDescription>
                <p className="font-medium">{t('general.clients.defaults.title')}</p>
                <p className="mt-1">{t('general.clients.defaults.intro', { name: defaultClient.name })}</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  <li>{currentDefaults.country}</li>
                  <li>{currentDefaults.phoneCode}</li>
                  <li>{currentDefaults.dateFormat}</li>
                </ul>
                {!currentDefaults.hasCountry && (
                  <p className="mt-2">
                    {t('general.clients.defaults.noCountry', {
                      name: defaultClient.name,
                      pattern: currentDefaults.pattern,
                    })}
                  </p>
                )}
                <p className="mt-2">{t('general.clients.defaults.portalNote')}</p>
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-4">
            <ClientPicker
              id="tenant-client-picker"
              clients={selectableClients}
              onSelect={setSelectedClientId}
              selectedClientId={selectedClientId}
              filterState={filterState}
              onFilterStateChange={setFilterState}
              clientTypeFilter={clientTypeFilter}
              onClientTypeFilterChange={setClientTypeFilter}
              placeholder={t('general.clients.placeholder')}
              fitContent={true}
            />
            <Button
              onClick={handleAddClient}
              id="add-client-button"
              disabled={!selectedClientId}
            >
              <Plus className="mr-2 h-4 w-4" />
              {t('general.clients.addClient')}
            </Button>
          </div>
        </div>

        <ConfirmationDialog
          id="change-default-client-dialog"
          isOpen={pendingDefaultClient !== null}
          onClose={() => setPendingDefaultClient(null)}
          onConfirm={async () => {
            if (!pendingDefaultClient) return;
            await handleSetDefaultClient(pendingDefaultClient.id);
            setPendingDefaultClient(null);
          }}
          title={t('general.clients.confirmDialog.title')}
          message={
            <div className="space-y-3">
              <p>
                {defaultClient
                  ? t('general.clients.confirmDialog.message', {
                      current: defaultClient.name,
                      next: pendingDefaultClient?.name ?? ''
                    })
                  : t('general.clients.confirmDialog.messageInitial', {
                      next: pendingDefaultClient?.name ?? ''
                    })}
              </p>
              {pendingDefaults && pendingDefaultClient && (
                <div>
                  <p className="font-medium">
                    {t('general.clients.defaults.changeIntro', { name: pendingDefaultClient.name })}
                  </p>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    <li>{pendingDefaults.country}</li>
                    <li>{pendingDefaults.phoneCode}</li>
                    <li>{pendingDefaults.dateFormat}</li>
                  </ul>
                </div>
              )}
            </div>
          }
          confirmLabel={t('general.clients.confirmDialog.confirm')}
          cancelLabel={t('general.clients.confirmDialog.cancel')}
        />
      </CardContent>
    </Card>
  );
};

export default GeneralSettings;
