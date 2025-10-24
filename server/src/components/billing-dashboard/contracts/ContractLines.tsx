'use client';

import React, { useEffect, useState } from 'react';
import { Card, Box } from '@radix-ui/themes';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { Plus, ChevronDown, ChevronUp, Trash2, Package, Edit, Check, X } from 'lucide-react';
import { IContract } from 'server/src/interfaces/contract.interfaces';
import { IContractLine } from 'server/src/interfaces/billing.interfaces';
import { getContractLines, updateContractLine } from 'server/src/lib/actions/contractLineAction';
import {
  getDetailedContractLines,
  addContractLine,
  removeContractLine,
  updateContractLineAssociation,
} from 'server/src/lib/actions/contractLineMappingActions';
import { checkContractHasInvoices } from 'server/src/lib/actions/contractActions';
import {
  getContractLineServicesWithConfigurations,
  getTemplateLineServicesWithConfigurations,
} from 'server/src/lib/actions/contractLineServiceActions';
import { updateConfiguration } from 'server/src/lib/actions/contractLineServiceConfigurationActions';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { AlertCircle } from 'lucide-react';
import LoadingIndicator from 'server/src/components/ui/LoadingIndicator';
import { Badge } from 'server/src/components/ui/Badge';
import { AddContractLinesDialog } from './AddContractLinesDialog';

interface ContractLinesProps {
  contract: IContract;
  onContractLinesChanged?: () => void;
}

interface DetailedContractLineMapping {
  tenant: string;
  contract_id: string;
  contract_line_id: string;
  display_order: number;
  custom_rate?: number | null;
  created_at: string | Date;
  contract_line_name: string;
  billing_frequency: string;
  contract_line_type: string;
  default_rate?: number | null;
  minimum_billable_time?: number | null;
  round_up_to_nearest?: number | null;
}

interface ServiceConfiguration {
  service: {
    service_id: string;
    service_name: string;
    service_type?: string;
    billing_method?: string;
  };
  configuration: {
    config_id: string;
    service_id: string;
    contract_line_id: string;
    configuration_type: 'Fixed' | 'Hourly' | 'Usage' | 'Bucket';
    custom_rate?: number;
    quantity?: number;
  };
  typeConfig: any;
}

const ContractLines: React.FC<ContractLinesProps> = ({ contract, onContractLinesChanged }) => {
  const [contractLines, setContractLines] = useState<DetailedContractLineMapping[]>([]);
  const [availableContractLines, setAvailableContractLines] = useState<IContractLine[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedLines, setExpandedLines] = useState<Record<string, boolean>>({});
  const [lineServices, setLineServices] = useState<Record<string, ServiceConfiguration[]>>({});
  const [loadingServices, setLoadingServices] = useState<Record<string, boolean>>({});
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [editLineData, setEditLineData] = useState<Partial<DetailedContractLineMapping>>({});
  const [editServiceConfigs, setEditServiceConfigs] = useState<Record<string, any>>({});

  useEffect(() => {
    if (contract.contract_id) {
      void fetchData();
    }
  }, [contract.contract_id]);

  const fetchData = async () => {
    if (!contract.contract_id) return;

    setIsLoading(true);
    setError(null);

    try {
      const [allContractLines, detailedContractLines] = await Promise.all([
        getContractLines(),
        getDetailedContractLines(contract.contract_id),
      ]);

      setContractLines(detailedContractLines);

      // Filter to only show contract lines that aren't already added
      const unusedLines = allContractLines.filter(
        (line) => !detailedContractLines.some((cl) => cl.contract_line_id === line.contract_line_id)
      );
      setAvailableContractLines(unusedLines);
    } catch (err) {
      console.error('Error fetching contract lines:', err);
      setError('Failed to load contract lines');
    } finally {
      setIsLoading(false);
    }
  };

  const loadServicesForLine = async (contractLineId: string) => {
    if (lineServices[contractLineId] || loadingServices[contractLineId]) {
      return; // Already loaded or loading
    }

    setLoadingServices(prev => ({ ...prev, [contractLineId]: true }));

    try {
      const isTemplate = contract.is_template;
      const services = isTemplate
        ? await getTemplateLineServicesWithConfigurations(contractLineId)
        : await getContractLineServicesWithConfigurations(contractLineId);

      setLineServices(prev => ({ ...prev, [contractLineId]: services }));
    } catch (err) {
      console.error(`Error loading services for contract line ${contractLineId}:`, err);
    } finally {
      setLoadingServices(prev => ({ ...prev, [contractLineId]: false }));
    }
  };

  const toggleExpand = async (contractLineId: string) => {
    const isExpanded = expandedLines[contractLineId];

    setExpandedLines(prev => ({
      ...prev,
      [contractLineId]: !isExpanded
    }));

    if (!isExpanded) {
      await loadServicesForLine(contractLineId);
    }
  };

  const handleAddContractLines = async (selectedLineIds: string[]) => {
    if (!contract.contract_id || selectedLineIds.length === 0) return;

    try {
      // Add all selected contract lines
      await Promise.all(
        selectedLineIds.map(lineId => addContractLine(contract.contract_id, lineId, undefined))
      );
      await fetchData();
      onContractLinesChanged?.();
    } catch (err) {
      console.error('Error adding contract lines:', err);
      setError('Failed to add contract lines');
      throw err; // Re-throw to let dialog handle it
    }
  };

  const handleRemoveContractLine = async (contractLineId: string) => {
    if (!contract.contract_id) return;

    try {
      await removeContractLine(contract.contract_id, contractLineId);
      await fetchData();
      onContractLinesChanged?.();
    } catch (err) {
      console.error('Error removing contract line:', err);
      setError(err instanceof Error ? err.message : 'Failed to remove contract line');
    }
  };

  const handleEditContractLine = async (line: DetailedContractLineMapping) => {
    if (!contract.contract_id) return;

    try {
      // Check if contract has invoices
      const hasInvoices = await checkContractHasInvoices(contract.contract_id);

      if (hasInvoices) {
        setError('Cannot edit contract line: This contract has associated invoices. Contract lines cannot be edited once invoices have been generated.');
        return;
      }

      // Start editing - populate edit data from the line
      setEditingLineId(line.contract_line_id);
      setEditLineData({
        minimum_billable_time: line.minimum_billable_time,
        round_up_to_nearest: line.round_up_to_nearest,
      });

      // Populate service configs for editing
      const services = lineServices[line.contract_line_id] || [];
      const serviceConfigsData: Record<string, any> = {};

      services.forEach(serviceConfig => {
        serviceConfigsData[serviceConfig.configuration.config_id] = {
          quantity: serviceConfig.configuration.quantity,
          custom_rate: serviceConfig.configuration.custom_rate,
          hourly_rate: serviceConfig.typeConfig?.hourly_rate,
          base_rate: serviceConfig.typeConfig?.base_rate,
          unit_of_measure: serviceConfig.typeConfig?.unit_of_measure,
        };
      });

      setEditServiceConfigs(serviceConfigsData);
    } catch (err) {
      console.error('Error checking contract invoices:', err);
      setError('Failed to check if contract can be edited');
    }
  };

  const handleSaveContractLine = async (contractLineId: string) => {
    try {
      // Update contract line fields
      await updateContractLine(contractLineId, {
        minimum_billable_time: editLineData.minimum_billable_time,
        round_up_to_nearest: editLineData.round_up_to_nearest,
      });

      // Update all service configurations
      const services = lineServices[contractLineId] || [];
      for (const serviceConfig of services) {
        const configId = serviceConfig.configuration.config_id;
        const editData = editServiceConfigs[configId];

        if (editData) {
          const baseConfig: any = {
            quantity: editData.quantity,
            custom_rate: editData.custom_rate,
          };

          const typeConfig: any = {};

          // Build type-specific config based on configuration type
          if (serviceConfig.configuration.configuration_type === 'Hourly') {
            if (editData.hourly_rate !== undefined) {
              typeConfig.hourly_rate = editData.hourly_rate;
            }
          } else if (serviceConfig.configuration.configuration_type === 'Usage') {
            if (editData.base_rate !== undefined) {
              typeConfig.base_rate = editData.base_rate;
            }
            if (editData.unit_of_measure !== undefined) {
              typeConfig.unit_of_measure = editData.unit_of_measure;
            }
          } else if (serviceConfig.configuration.configuration_type === 'Fixed') {
            if (editData.base_rate !== undefined) {
              typeConfig.base_rate = editData.base_rate;
            }
          }

          await updateConfiguration(configId, baseConfig, typeConfig);
        }
      }

      // Reload services for this line
      await loadServicesForLine(contractLineId);
      await fetchData();
      setEditingLineId(null);
      setEditLineData({});
      setEditServiceConfigs({});
      onContractLinesChanged?.();
    } catch (err) {
      console.error('Error updating contract line:', err);
      setError('Failed to update contract line');
    }
  };

  const handleCancelEdit = () => {
    setEditingLineId(null);
    setEditLineData({});
    setEditServiceConfigs({});
  };

  const formatRate = (rate?: number | null) => {
    if (rate === undefined || rate === null) return 'N/A';
    return `$${(rate / 100).toFixed(2)}`;
  };

  const renderServiceDetails = (service: ServiceConfiguration) => {
    const { configuration, typeConfig } = service;
    const details: string[] = [];

    if (configuration.configuration_type === 'Fixed') {
      if (typeConfig?.base_rate) {
        details.push(`Rate: ${formatRate(typeConfig.base_rate)}`);
      }
      if (configuration.quantity) {
        details.push(`Qty: ${configuration.quantity}`);
      }
    } else if (configuration.configuration_type === 'Hourly') {
      if (typeConfig?.hourly_rate) {
        details.push(`$${(typeConfig.hourly_rate / 100).toFixed(2)}/hr`);
      }
      if (typeConfig?.minimum_billable_time) {
        details.push(`Min: ${typeConfig.minimum_billable_time} min`);
      }
      if (typeConfig?.round_up_to_nearest) {
        details.push(`Round: ${typeConfig.round_up_to_nearest} min`);
      }
    } else if (configuration.configuration_type === 'Usage') {
      if (typeConfig?.base_rate) {
        details.push(`Rate: ${formatRate(typeConfig.base_rate)}`);
      }
      if (typeConfig?.unit_of_measure) {
        details.push(`Unit: ${typeConfig.unit_of_measure}`);
      }
    } else if (configuration.configuration_type === 'Bucket') {
      if (typeConfig?.total_minutes) {
        details.push(`${typeConfig.total_minutes} min`);
      }
      if (typeConfig?.overage_rate) {
        details.push(`Overage: ${formatRate(typeConfig.overage_rate)}`);
      }
      if (typeConfig?.billing_period) {
        details.push(`Period: ${typeConfig.billing_period}`);
      }
    }

    if (configuration.custom_rate) {
      details.push(`Custom: ${formatRate(configuration.custom_rate)}`);
    }

    return details.join(' • ');
  };

  if (isLoading) {
    return (
      <Card size="2">
        <Box p="8">
          <LoadingIndicator
            layout="stacked"
            className="py-6 text-gray-600"
            spinnerProps={{ size: 'md' }}
            text="Loading contract lines"
          />
        </Box>
      </Card>
    );
  }

  return (
    <Card size="2">
      <Box p="4" className="space-y-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-lg font-medium">Contract Lines</h3>
            <p className="text-sm text-gray-600">
              Manage the contract lines and services for this contract
            </p>
          </div>
          <Button
            id="add-contract-line-btn"
            onClick={() => setShowAddDialog(true)}
            disabled={availableContractLines.length === 0}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Contract Lines
          </Button>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {contractLines.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <p>No contract lines added yet.</p>
            <p className="text-sm mt-1">Select a contract line above to get started.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {contractLines.map((line) => {
              const isExpanded = expandedLines[line.contract_line_id];
              const services = lineServices[line.contract_line_id] || [];
              const isLoadingServices = loadingServices[line.contract_line_id];

              return (
                <div
                  key={line.contract_line_id}
                  className="border rounded-lg overflow-hidden bg-white"
                >
                  {/* Header */}
                  <div className="flex items-center gap-3 p-4 bg-gray-50 border-b">
                    <button
                      type="button"
                      onClick={() => toggleExpand(line.contract_line_id)}
                      className="p-1 hover:bg-gray-200 rounded transition-colors"
                    >
                      {isExpanded ? (
                        <ChevronUp className="h-5 w-5 text-gray-600" />
                      ) : (
                        <ChevronDown className="h-5 w-5 text-gray-600" />
                      )}
                    </button>

                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-900">
                        {line.contract_line_name}
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-xs text-gray-600">
                        <Badge
                          className={`text-xs ${
                            line.contract_line_type === 'Fixed'
                              ? 'bg-green-100 text-green-800'
                              : line.contract_line_type === 'Hourly'
                              ? 'bg-purple-100 text-purple-800'
                              : line.contract_line_type === 'Usage'
                              ? 'bg-indigo-100 text-indigo-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {line.contract_line_type}
                        </Badge>
                        <span>•</span>
                        <span>{line.billing_frequency}</span>
                        {services.length > 0 && (
                          <>
                            <span>•</span>
                            <span>{services.length} service{services.length !== 1 ? 's' : ''}</span>
                          </>
                        )}
                        {line.default_rate !== null && line.default_rate !== undefined && (
                          <>
                            <span>•</span>
                            <span>Base: {formatRate(line.default_rate)}</span>
                          </>
                        )}
                        {line.custom_rate !== null && line.custom_rate !== undefined && (
                          <>
                            <span>•</span>
                            <span className="text-blue-600 font-medium">
                              Custom: {formatRate(line.custom_rate)}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        id={`edit-${line.contract_line_id}`}
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEditContractLine(line);
                        }}
                        className="h-8 text-gray-600 hover:text-gray-700 hover:bg-gray-100"
                      >
                        <Edit className="h-4 w-4 mr-1" />
                        Edit
                      </Button>
                      <Button
                        id={`remove-${line.contract_line_id}`}
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveContractLine(line.contract_line_id);
                        }}
                        className="h-8 text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4 mr-1" />
                        Remove
                      </Button>
                    </div>
                  </div>

                  {/* Expanded Content */}
                  {isExpanded && (
                    <div className="p-4 bg-white border-t">
                      {isLoadingServices ? (
                        <div className="flex items-center justify-center py-8 text-gray-500">
                          <LoadingIndicator
                            layout="inline"
                            spinnerProps={{ size: 'sm' }}
                            text="Loading..."
                          />
                        </div>
                      ) : (
                        <div className="space-y-6">
                          {/* Contract Line Configuration Section */}
                          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="font-semibold text-gray-900">Contract Line Configuration</p>
                                <p className="text-xs text-gray-500">
                                  Settings that apply to this contract line
                                </p>
                              </div>
                              {editingLineId === line.contract_line_id ? (
                                <div className="flex gap-2">
                                  <Button
                                    id={`save-line-${line.contract_line_id}`}
                                    type="button"
                                    size="sm"
                                    onClick={() => handleSaveContractLine(line.contract_line_id)}
                                    className="gap-2"
                                  >
                                    <Check className="h-4 w-4" />
                                    Save
                                  </Button>
                                  <Button
                                    id={`cancel-line-${line.contract_line_id}`}
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={handleCancelEdit}
                                    className="gap-2"
                                  >
                                    <X className="h-4 w-4" />
                                    Cancel
                                  </Button>
                                </div>
                              ) : null}
                            </div>

                            <div className="grid gap-4 md:grid-cols-2">
                              {/* Hourly contract line fields */}
                              {line.contract_line_type === 'Hourly' && (
                                <>
                                  <div>
                                    <Label className="text-xs uppercase tracking-wide text-gray-500">
                                      Minimum Billable Time (minutes)
                                    </Label>
                                    {editingLineId === line.contract_line_id ? (
                                      <Input
                                        id={`min-billable-${line.contract_line_id}`}
                                        type="number"
                                        min="0"
                                        value={editLineData.minimum_billable_time ?? ''}
                                        onChange={(e) => setEditLineData({
                                          ...editLineData,
                                          minimum_billable_time: e.target.value ? parseInt(e.target.value) : undefined
                                        })}
                                        placeholder="15"
                                        className="mt-1"
                                      />
                                    ) : (
                                      <p className="mt-1 text-sm text-gray-800">
                                        {line.minimum_billable_time || 0} minutes
                                      </p>
                                    )}
                                  </div>
                                  <div>
                                    <Label className="text-xs uppercase tracking-wide text-gray-500">
                                      Round Up To Nearest (minutes)
                                    </Label>
                                    {editingLineId === line.contract_line_id ? (
                                      <Input
                                        id={`round-up-${line.contract_line_id}`}
                                        type="number"
                                        min="0"
                                        value={editLineData.round_up_to_nearest ?? ''}
                                        onChange={(e) => setEditLineData({
                                          ...editLineData,
                                          round_up_to_nearest: e.target.value ? parseInt(e.target.value) : undefined
                                        })}
                                        placeholder="15"
                                        className="mt-1"
                                      />
                                    ) : (
                                      <p className="mt-1 text-sm text-gray-800">
                                        {line.round_up_to_nearest || 0} minutes
                                      </p>
                                    )}
                                  </div>
                                </>
                              )}

                              {/* Fixed contract line - show info message */}
                              {line.contract_line_type === 'Fixed' && (
                                <div className="col-span-2">
                                  <p className="text-sm text-gray-600">
                                    Fixed contract lines have a base rate and proration settings configured at setup.
                                  </p>
                                </div>
                              )}

                              {/* Usage contract line - show info message */}
                              {line.contract_line_type === 'Usage' && (
                                <div className="col-span-2">
                                  <p className="text-sm text-gray-600">
                                    Usage-based contract lines are configured per service with unit rates.
                                  </p>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Services List Section */}
                          <div>
                            <h4 className="text-sm font-medium text-gray-700 mb-3">
                              Services ({services.length})
                            </h4>
                            {services.length === 0 ? (
                              <div className="text-center py-8 text-gray-500 bg-gray-50 rounded-lg border border-gray-200">
                                <p className="text-sm">No services configured for this contract line.</p>
                              </div>
                            ) : (
                              <div className="space-y-3">
                                {services.map((serviceConfig, idx) => {
                                  const isEditing = editingLineId === line.contract_line_id;
                                  const configId = serviceConfig.configuration.config_id;
                                  const editData = editServiceConfigs[configId] || {};

                                  return (
                                    <div
                                      key={`${serviceConfig.configuration.config_id}-${idx}`}
                                      className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-4"
                                    >
                                      <div className="flex flex-wrap items-start justify-between gap-3">
                                        <div className="flex items-center gap-2">
                                          <div>
                                            <p className="font-semibold text-gray-900">
                                              {serviceConfig.service.service_name}
                                            </p>
                                            <p className="text-xs text-gray-500">
                                              {serviceConfig.configuration.configuration_type} Service
                                            </p>
                                          </div>
                                          <Badge className="bg-[rgb(var(--color-primary-50))] text-[rgb(var(--color-primary-600))] border-[rgb(var(--color-primary-200))]">
                                            Qty: {isEditing ? (editData.quantity ?? serviceConfig.configuration.quantity ?? 1) : (serviceConfig.configuration.quantity || 1)}
                                          </Badge>
                                        </div>
                                      </div>

                                      <div className="grid gap-4 md:grid-cols-2">
                                        {/* Quantity - all service types */}
                                        <div>
                                          <Label className="text-xs uppercase tracking-wide text-gray-500">
                                            Quantity
                                          </Label>
                                          {isEditing ? (
                                            <Input
                                              id={`quantity-${serviceConfig.configuration.config_id}`}
                                              type="number"
                                              min="1"
                                              value={editData.quantity ?? ''}
                                              onChange={(e) => setEditServiceConfigs({
                                                ...editServiceConfigs,
                                                [configId]: {
                                                  ...editData,
                                                  quantity: e.target.value ? parseInt(e.target.value) : undefined
                                                }
                                              })}
                                              className="mt-1"
                                            />
                                          ) : (
                                            <p className="mt-1 text-sm text-gray-800 font-semibold">
                                              {serviceConfig.configuration.quantity || 1}
                                            </p>
                                          )}
                                        </div>

                                        {/* Rate field - varies by type */}
                                        <div>
                                          <Label className="text-xs uppercase tracking-wide text-gray-500">
                                            {serviceConfig.configuration.configuration_type === 'Hourly' ? 'Hourly Rate' :
                                             serviceConfig.configuration.configuration_type === 'Usage' ? 'Unit Rate' : 'Rate'}
                                          </Label>
                                          {isEditing ? (
                                            <div className="relative mt-1">
                                              <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">$</span>
                                              <Input
                                                id={`rate-${serviceConfig.configuration.config_id}`}
                                                type="number"
                                                min="0"
                                                step="0.01"
                                                value={
                                                  serviceConfig.configuration.configuration_type === 'Hourly'
                                                    ? (editData.hourly_rate !== undefined ? (editData.hourly_rate / 100).toFixed(2) : '')
                                                    : (editData.base_rate !== undefined ? (editData.base_rate / 100).toFixed(2) : '')
                                                }
                                                onChange={(e) => {
                                                  const cents = e.target.value ? Math.round(parseFloat(e.target.value) * 100) : undefined;
                                                  if (serviceConfig.configuration.configuration_type === 'Hourly') {
                                                    setEditServiceConfigs({
                                                      ...editServiceConfigs,
                                                      [configId]: {
                                                        ...editData,
                                                        hourly_rate: cents
                                                      }
                                                    });
                                                  } else {
                                                    setEditServiceConfigs({
                                                      ...editServiceConfigs,
                                                      [configId]: {
                                                        ...editData,
                                                        base_rate: cents
                                                      }
                                                    });
                                                  }
                                                }}
                                                className="pl-7"
                                              />
                                            </div>
                                          ) : (
                                            <p className="mt-1 text-sm text-gray-800">
                                              {formatRate(serviceConfig.typeConfig?.hourly_rate || serviceConfig.typeConfig?.base_rate)}
                                            </p>
                                          )}
                                        </div>

                                        {/* Unit of Measure - Usage only */}
                                        {serviceConfig.configuration.configuration_type === 'Usage' && (
                                          <div>
                                            <Label className="text-xs uppercase tracking-wide text-gray-500">
                                              Unit of Measure
                                            </Label>
                                            {isEditing ? (
                                              <Input
                                                id={`unit-${serviceConfig.configuration.config_id}`}
                                                type="text"
                                                value={editData.unit_of_measure ?? ''}
                                                onChange={(e) => setEditServiceConfigs({
                                                  ...editServiceConfigs,
                                                  [configId]: {
                                                    ...editData,
                                                    unit_of_measure: e.target.value
                                                  }
                                                })}
                                                placeholder="unit"
                                                className="mt-1"
                                              />
                                            ) : (
                                              <p className="mt-1 text-sm text-gray-800">
                                                {serviceConfig.typeConfig?.unit_of_measure || 'unit'}
                                              </p>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Box>

      <AddContractLinesDialog
        isOpen={showAddDialog}
        onClose={() => setShowAddDialog(false)}
        availableContractLines={availableContractLines}
        onAdd={handleAddContractLines}
      />
    </Card>
  );
};

export default ContractLines;
