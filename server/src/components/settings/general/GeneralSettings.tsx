'use client'


import React from 'react';
import { Card, CardContent } from "@alga-psa/ui/components/Card";
import { Input } from "@alga-psa/ui/components/Input";
import { Button } from "@alga-psa/ui/components/Button";
import { Label } from "@alga-psa/ui/components/Label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@alga-psa/ui/components/Table";
import { Plus, Trash } from 'lucide-react';
import toast from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { getTenantDetails, updateTenantName, addClientToTenant, removeClientFromTenant, setDefaultClient, getTenantTimezoneAuth, setTenantTimezone } from "@alga-psa/tenancy/actions";
import { getAllClients } from "@alga-psa/clients/actions";
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import TimezonePicker from '@alga-psa/ui/components/TimezonePicker';
import { IClient } from "@alga-psa/types";
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

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

  const loadTenantData = async () => {
    try {
      const [tenant, tz] = await Promise.all([
        getTenantDetails(),
        getTenantTimezoneAuth()
      ]);
      const safeTenantName = typeof tenant?.client_name === 'string' ? tenant.client_name : '';
      setTenantName(safeTenantName);
      setTenantTimezoneState(tz || '');
      setClients((tenant.clients ?? []).map(c => ({
        id: c.client_id,
        name: c.client_name,
        isDefault: c.is_default
      })));
    } catch (error) {
      handleError(error, t('general.messages.error.loadTenantData'));
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
        await setTenantTimezone(tenantTimezone);
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
          <h3 className="text-lg font-semibold">{t('general.clients.title')}</h3>
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
                    <label htmlFor={`default-client-radio-${client.id}`} className="cursor-pointer">
                      {client.name}
                    </label>
                  </TableCell>
                  <TableCell>
                    <input
                      type="radio"
                      name="default-client"
                      id={`default-client-radio-${client.id}`}
                      checked={client.isDefault}
                      onChange={() => handleSetDefaultClient(client.id)}
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

          <div className="space-y-4">
            <ClientPicker
              id="tenant-client-picker"
              clients={allClients}
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
      </CardContent>
    </Card>
  );
};

export default GeneralSettings;
