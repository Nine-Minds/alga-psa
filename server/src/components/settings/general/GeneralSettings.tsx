'use client'

import React from 'react';
import { Card, CardContent } from "server/src/components/ui/Card";
import { Input } from "server/src/components/ui/Input";
import { Button } from "server/src/components/ui/Button";
import { Label } from "server/src/components/ui/Label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "server/src/components/ui/Table";
import { Checkbox } from "server/src/components/ui/Checkbox";
import { Plus, Trash } from 'lucide-react';
import toast from 'react-hot-toast';
import { getTenantDetails, updateTenantName, addClientToTenant, removeClientFromTenant, setDefaultClient } from "server/src/lib/actions/tenantActions";
import { getAllClients } from "server/src/lib/actions/client-actions/clientActions";
import { ClientPicker } from "server/src/components/clients/ClientPicker";
import { IClient } from "server/src/interfaces/client.interfaces";

const GeneralSettings = () => {
  const [tenantName, setTenantName] = React.useState('');
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
      const tenant = await getTenantDetails();
      const safeTenantName = typeof tenant?.client_name === 'string' ? tenant.client_name : '';
      setTenantName(safeTenantName);
      setClients((tenant.clients ?? []).map(c => ({
        id: c.client_id,
        name: c.client_name,
        isDefault: c.is_default
      })));
    } catch (error) {
      toast.error("Failed to load tenant data");
    }
  };

  const handleSaveTenantName = async () => {
    try {
      await updateTenantName(tenantName);
      toast.success("Tenant name updated successfully");
    } catch (error) {
      toast.error("Failed to update tenant name");
    }
  };

  const handleAddClient = async () => {
    if (!selectedClientId) {
      toast.error("Please select a client");
      return;
    }

    try {
      const clientToAdd = allClients.find(c => c.client_id === selectedClientId);
      if (!clientToAdd) {
        throw new Error("Client not found");
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

      toast.success("Client added successfully");
    } catch (error) {
      toast.error("Failed to add client");
    }
  };

  React.useEffect(() => {
    const loadClients = async () => {
      try {
        const clients = await getAllClients();
        setAllClients(clients);
      } catch (error) {
        toast.error("Failed to load clients");
      }
    };
    loadClients();
  }, []);

  const handleRemoveClient = async (clientId: string) => {
    try {
      await removeClientFromTenant(clientId);
      setClients(clients.filter(c => c.id !== clientId));
      toast.success("Client removed successfully");
    } catch (error) {
      toast.error("Failed to remove client");
    }
  };

  const handleSetDefaultClient = async (clientId: string) => {
    try {
      await setDefaultClient(clientId);
      setClients(clients.map(c => ({
        ...c,
        isDefault: c.id === clientId
      })));
      toast.success("Default client updated successfully");
    } catch (error) {
      toast.error("Failed to set default client");
    }
  };

  return (
    <Card>
      <CardContent className="space-y-6">
        <div className="space-y-4">
            <div>
              <Label htmlFor="tenantName">Organization Name</Label>
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
              Save Organization Name
            </Button>
          </div>

        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Clients</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Default</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.map((client) => (
                <TableRow key={client.id}>
                  <TableCell>{client.name}</TableCell>
                  <TableCell>
                    <Checkbox
                      id={`default-client-checkbox-${client.id}`}
                      checked={client.isDefault}
                      onChange={() => handleSetDefaultClient(client.id)}
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
              placeholder="Select a client to add"
              fitContent={true}
            />
            <Button
              onClick={handleAddClient}
              id="add-client-button"
              disabled={!selectedClientId}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Client
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default GeneralSettings;
