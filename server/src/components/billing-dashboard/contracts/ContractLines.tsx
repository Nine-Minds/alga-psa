'use client';

import React, { useEffect, useState } from 'react';
import { Card, Box } from '@radix-ui/themes';
import { Button } from 'server/src/components/ui/Button';
import { Plus, ChevronDown, ChevronUp, Trash2, Package } from 'lucide-react';
import { IContract } from 'server/src/interfaces/contract.interfaces';
import { IContractLine } from 'server/src/interfaces/billing.interfaces';
import { getContractLines } from 'server/src/lib/actions/contractLineAction';
import {
  getDetailedContractLines,
  addContractLine,
  removeContractLine,
} from 'server/src/lib/actions/contractLineMappingActions';
import {
  getContractLineServicesWithConfigurations,
  getTemplateLineServicesWithConfigurations,
} from 'server/src/lib/actions/contractLineServiceActions';
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
                      <h4 className="font-medium text-gray-900">{line.contract_line_name}</h4>
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

                  {/* Expanded Content */}
                  {isExpanded && (
                    <div className="p-4 bg-white">
                      {isLoadingServices ? (
                        <div className="flex items-center justify-center py-8 text-gray-500">
                          <LoadingIndicator
                            layout="inline"
                            spinnerProps={{ size: 'sm' }}
                            text="Loading services..."
                          />
                        </div>
                      ) : services.length === 0 ? (
                        <div className="text-center py-8 text-gray-500">
                          <p className="text-sm">No services configured for this contract line.</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="text-sm font-medium text-gray-700 mb-3">
                            Services ({services.length})
                          </div>
                          {services.map((serviceConfig, idx) => (
                            <div
                              key={`${serviceConfig.configuration.config_id}-${idx}`}
                              className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200"
                            >
                              <div className="flex-shrink-0 mt-0.5">
                                {serviceConfig.configuration.configuration_type === 'Bucket' ? (
                                  <Package className="h-5 w-5 text-purple-600" />
                                ) : (
                                  <div className="h-5 w-5 rounded-full bg-blue-100 flex items-center justify-center">
                                    <span className="text-xs font-medium text-blue-700">
                                      {serviceConfig.configuration.configuration_type[0]}
                                    </span>
                                  </div>
                                )}
                              </div>

                              <div className="flex-1 min-w-0">
                                <div className="flex items-start justify-between gap-2">
                                  <div>
                                    <h5 className="font-medium text-gray-900">
                                      {serviceConfig.service.service_name}
                                    </h5>
                                    <div className="mt-1 text-xs text-gray-600">
                                      <Badge
                                        className={`text-xs mr-2 ${
                                          serviceConfig.configuration.configuration_type === 'Fixed'
                                            ? 'bg-green-100 text-green-800'
                                            : serviceConfig.configuration.configuration_type === 'Hourly'
                                            ? 'bg-purple-100 text-purple-800'
                                            : serviceConfig.configuration.configuration_type === 'Usage'
                                            ? 'bg-indigo-100 text-indigo-800'
                                            : serviceConfig.configuration.configuration_type === 'Bucket'
                                            ? 'bg-blue-100 text-blue-800'
                                            : 'bg-gray-100 text-gray-800'
                                        }`}
                                      >
                                        {serviceConfig.configuration.configuration_type}
                                      </Badge>
                                      {renderServiceDetails(serviceConfig)}
                                    </div>
                                  </div>
                                </div>

                                {/* Additional configuration details */}
                                {serviceConfig.configuration.configuration_type === 'Bucket' &&
                                  serviceConfig.typeConfig && (
                                    <div className="mt-2 p-2 bg-purple-50 rounded border border-purple-200">
                                      <div className="text-xs space-y-1">
                                        <div className="flex items-center gap-4">
                                          <span className="font-medium text-purple-900">
                                            Bucket Configuration
                                          </span>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2 mt-1">
                                          <div>
                                            <span className="text-gray-600">Total Minutes:</span>
                                            <span className="ml-1 text-gray-900">
                                              {serviceConfig.typeConfig.total_minutes}
                                            </span>
                                          </div>
                                          <div>
                                            <span className="text-gray-600">Overage Rate:</span>
                                            <span className="ml-1 text-gray-900">
                                              {formatRate(serviceConfig.typeConfig.overage_rate)}
                                            </span>
                                          </div>
                                          <div>
                                            <span className="text-gray-600">Rollover:</span>
                                            <span className="ml-1 text-gray-900">
                                              {serviceConfig.typeConfig.allow_rollover ? 'Yes' : 'No'}
                                            </span>
                                          </div>
                                          <div>
                                            <span className="text-gray-600">Period:</span>
                                            <span className="ml-1 text-gray-900 capitalize">
                                              {serviceConfig.typeConfig.billing_period}
                                            </span>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  )}
                              </div>
                            </div>
                          ))}
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
