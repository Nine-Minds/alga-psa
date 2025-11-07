'use client';

import React, { useEffect, useState } from 'react';
import { Label } from 'server/src/components/ui/Label';
import { Input } from 'server/src/components/ui/Input';
import { Button } from 'server/src/components/ui/Button';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { IService, IContractLinePreset, IContractLinePresetService } from 'server/src/interfaces';
import { getServices } from 'server/src/lib/actions/serviceActions';
import { getContractLinePresets, getContractLinePresetServices } from 'server/src/lib/actions/contractLinePresetActions';
import { Plus, X, Package, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { TemplateWizardData } from '../TemplateWizard';
import { TemplateServicePreviewSection } from '../TemplateServicePreviewSection';

interface TemplateFixedFeeServicesStepProps {
  data: TemplateWizardData;
  updateData: (data: Partial<TemplateWizardData>) => void;
}

type PresetWithServices = {
  preset: IContractLinePreset;
  services: Array<IContractLinePresetService & { service_name?: string }>;
};

export function TemplateFixedFeeServicesStep({
  data,
  updateData,
}: TemplateFixedFeeServicesStepProps) {
  const [services, setServices] = useState<IService[]>([]);
  const [isLoadingServices, setIsLoadingServices] = useState(true);
  const [presets, setPresets] = useState<IContractLinePreset[]>([]);
  const [isLoadingPresets, setIsLoadingPresets] = useState(true);
  const [presetServicesMap, setPresetServicesMap] = useState<Map<string, PresetWithServices>>(new Map());
  const [expandedPresets, setExpandedPresets] = useState<Set<string>>(new Set());
  const [previewPresetData, setPreviewPresetData] = useState<PresetWithServices | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [rateInputs, setRateInputs] = useState<Record<number, string>>({});

  useEffect(() => {
    const load = async () => {
      try {
        const result = await getServices();
        if (result && Array.isArray(result.services)) {
          const fixedServices = result.services.filter(
            (service) => service.billing_method === 'fixed'
          );
          setServices(fixedServices);
        }
      } catch (error) {
        console.error('Error loading services:', error);
      } finally {
        setIsLoadingServices(false);
      }
    };

    void load();
  }, []);

  useEffect(() => {
    const inputs: Record<number, string> = {};
    data.fixed_services.forEach((service, index) => {
      if (service.suggested_rate !== undefined) {
        inputs[index] = service.suggested_rate.toFixed(2);
      }
    });
    setRateInputs(inputs);
  }, [data.fixed_services]);

  useEffect(() => {
    const loadPresets = async () => {
      try {
        const allPresets = await getContractLinePresets();
        const fixedPresets = allPresets.filter(
          (preset) => preset.contract_line_type === 'Fixed'
        );
        setPresets(fixedPresets);
      } catch (error) {
        console.error('Error loading presets:', error);
      } finally {
        setIsLoadingPresets(false);
      }
    };

    void loadPresets();
  }, []);

  const serviceOptions = services.map((service) => ({
    value: service.service_id,
    label: service.service_name,
  }));

  const presetOptions = presets.map((preset) => ({
    value: preset.preset_id,
    label: preset.preset_name,
  }));

  const handleAddService = () => {
    updateData({
      fixed_services: [
        ...data.fixed_services,
        { service_id: '', service_name: '', quantity: 1, suggested_rate: undefined },
      ],
    });
  };

  const loadPresetServices = async (presetId: string) => {
    try {
      const preset = presets.find((p) => p.preset_id === presetId);
      if (!preset) return;

      const presetServices = await getContractLinePresetServices(presetId);

      // Enrich with service names
      const enrichedServices = presetServices.map((ps) => {
        const service = services.find((s) => s.service_id === ps.service_id);
        return {
          ...ps,
          service_name: service?.service_name || 'Unknown Service',
        };
      });

      setPresetServicesMap((prev) => {
        const newMap = new Map(prev);
        newMap.set(presetId, { preset, services: enrichedServices });
        return newMap;
      });

      // Auto-expand the newly added preset
      setExpandedPresets((prev) => new Set([...prev, presetId]));
    } catch (error) {
      console.error(`Error loading services for preset ${presetId}:`, error);
    }
  };

  const handleAddPreset = async (presetId: string) => {
    const preset = presets.find((p) => p.preset_id === presetId);
    if (!preset) return;

    const existingPresets = data.fixed_presets ?? [];
    // Check if preset is already added
    if (existingPresets.some((p) => p.preset_id === presetId)) {
      return;
    }

    // Load services first to get default quantities
    const presetServices = await getContractLinePresetServices(presetId);
    const serviceQuantities: Record<string, number> = {};
    presetServices.forEach((ps) => {
      serviceQuantities[ps.service_id] = ps.quantity ?? 1;
    });

    updateData({
      fixed_presets: [
        ...existingPresets,
        {
          preset_id: presetId,
          preset_name: preset.preset_name,
          service_quantities: serviceQuantities,
        },
      ],
    });

    // Load services for display
    await loadPresetServices(presetId);
  };

  const handlePresetServiceQuantityChange = (presetIndex: number, serviceId: string, quantity: number) => {
    const existingPresets = data.fixed_presets ?? [];
    const updatedPresets = [...existingPresets];
    const preset = updatedPresets[presetIndex];

    if (preset) {
      preset.service_quantities = {
        ...preset.service_quantities,
        [serviceId]: Math.max(1, quantity),
      };
      updateData({ fixed_presets: updatedPresets });
    }
  };

  const handleRemovePreset = (index: number) => {
    const existingPresets = data.fixed_presets ?? [];
    const removedPreset = existingPresets[index];
    const next = existingPresets.filter((_, i) => i !== index);
    updateData({ fixed_presets: next });

    // Clean up preset services from map
    if (removedPreset) {
      setPresetServicesMap((prev) => {
        const newMap = new Map(prev);
        newMap.delete(removedPreset.preset_id);
        return newMap;
      });
      setExpandedPresets((prev) => {
        const newSet = new Set(prev);
        newSet.delete(removedPreset.preset_id);
        return newSet;
      });
    }
  };

  const togglePresetExpanded = (presetId: string) => {
    setExpandedPresets((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(presetId)) {
        newSet.delete(presetId);
      } else {
        newSet.add(presetId);
      }
      return newSet;
    });
  };

  const handleRemoveService = (index: number) => {
    const next = data.fixed_services.filter((_, i) => i !== index);
    updateData({ fixed_services: next });
  };

  const handleServiceChange = (index: number, serviceId: string) => {
    const service = services.find((s) => s.service_id === serviceId);
    const next = [...data.fixed_services];
    next[index] = {
      ...next[index],
      service_id: serviceId,
      service_name: service?.service_name ?? '',
    };
    updateData({ fixed_services: next });
  };

  const handleQuantityChange = (index: number, quantity: number) => {
    const next = [...data.fixed_services];
    next[index] = { ...next[index], quantity };
    updateData({ fixed_services: next });
  };

  const handleRateChange = (index: number, rate: number | undefined) => {
    const next = [...data.fixed_services];
    next[index] = { ...next[index], suggested_rate: rate };
    updateData({ fixed_services: next });
  };

  const [selectedPresetId, setSelectedPresetId] = useState<string>('');

  // Load preview when preset is selected
  useEffect(() => {
    const loadPreview = async () => {
      if (!selectedPresetId) {
        setPreviewPresetData(null);
        return;
      }

      setIsLoadingPreview(true);
      try {
        const preset = presets.find((p) => p.preset_id === selectedPresetId);
        if (!preset) {
          setPreviewPresetData(null);
          return;
        }

        const presetServices = await getContractLinePresetServices(selectedPresetId);

        // Enrich with service names
        const enrichedServices = presetServices.map((ps) => {
          const service = services.find((s) => s.service_id === ps.service_id);
          return {
            ...ps,
            service_name: service?.service_name || 'Unknown Service',
          };
        });

        setPreviewPresetData({ preset, services: enrichedServices });
      } catch (error) {
        console.error(`Error loading preview for preset ${selectedPresetId}:`, error);
        setPreviewPresetData(null);
      } finally {
        setIsLoadingPreview(false);
      }
    };

    void loadPreview();
  }, [selectedPresetId, presets, services]);

  // Build preview services list
  const previewServices = React.useMemo(() => {
    const items: Array<{
      id: string;
      name: string;
      quantity?: number;
      fromPreset?: {
        presetId: string;
        presetName: string;
      };
      serviceId: string;
    }> = [];

    // Add preset services
    for (const preset of data.fixed_presets ?? []) {
      const presetData = presetServicesMap.get(preset.preset_id);
      if (presetData) {
        for (const presetService of presetData.services) {
          items.push({
            id: `preset-${preset.preset_id}-${presetService.service_id}`,
            name: presetService.service_name || 'Unknown Service',
            quantity: preset.service_quantities?.[presetService.service_id] ?? presetService.quantity ?? 1,
            fromPreset: {
              presetId: preset.preset_id,
              presetName: preset.preset_name || 'Unknown Preset',
            },
            serviceId: presetService.service_id,
          });
        }
      }
    }

    // Add individual services
    for (const service of data.fixed_services) {
      if (service.service_id) {
        items.push({
          id: `service-${service.service_id}`,
          name: service.service_name || 'Unknown Service',
          quantity: service.quantity ?? 1,
          serviceId: service.service_id,
        });
      }
    }

    return items;
  }, [data.fixed_presets, data.fixed_services, presetServicesMap]);

  const handlePreviewQuantityChange = (itemId: string, quantity: number) => {
    if (itemId.startsWith('preset-')) {
      // Extract preset and service IDs
      const match = itemId.match(/^preset-(.+?)-(.+)$/);
      if (match) {
        const [, presetId, serviceId] = match;
        const presetIndex = (data.fixed_presets ?? []).findIndex((p) => p.preset_id === presetId);
        if (presetIndex !== -1) {
          handlePresetServiceQuantityChange(presetIndex, serviceId, quantity);
        }
      }
    } else if (itemId.startsWith('service-')) {
      const serviceId = itemId.replace('service-', '');
      const serviceIndex = data.fixed_services.findIndex((s) => s.service_id === serviceId);
      if (serviceIndex !== -1) {
        handleQuantityChange(serviceIndex, quantity);
      }
    }
  };

  const handlePreviewRemoveService = (itemId: string, fromPresetId?: string) => {
    if (fromPresetId) {
      // Remove entire preset
      const presetIndex = (data.fixed_presets ?? []).findIndex((p) => p.preset_id === fromPresetId);
      if (presetIndex !== -1) {
        handleRemovePreset(presetIndex);
      }
    } else if (itemId.startsWith('service-')) {
      // Remove individual service
      const serviceId = itemId.replace('service-', '');
      const serviceIndex = data.fixed_services.findIndex((s) => s.service_id === serviceId);
      if (serviceIndex !== -1) {
        handleRemoveService(serviceIndex);
      }
    }
  };

  return (
    <ReflectionContainer id="template-fixed-fee-services-step">
      <div className="space-y-6">
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-2">Fixed Fee Services</h3>
          <p className="text-sm text-gray-600">
            Configure services that are billed at a fixed rate each billing cycle. You can still track time, but billing is based on this flat amount.
          </p>
        </div>

        <div className="p-4 bg-accent-50 border border-accent-200 rounded-md">
          <p className="text-sm text-accent-900">
            <strong>What are Fixed Fee Services?</strong> These services have a set recurring price. You'll still track time entries for these services, but billing is based on the fixed rate, not hours worked.
          </p>
        </div>

        <TemplateServicePreviewSection
          services={previewServices}
          serviceType="fixed"
          onQuantityChange={handlePreviewQuantityChange}
          onRemoveService={handlePreviewRemoveService}
        />

        {/* Contract Line Presets Section */}
        <div className="space-y-4 p-4 bg-primary-50 border border-primary-200 rounded-md">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary-600" />
            <Label className="text-primary-900 font-semibold">Contract Line Presets</Label>
          </div>
          <p className="text-sm text-primary-700">
            Load pre-configured contract line presets as templates for your contract. Presets will be copied with their services and configurations.
          </p>

          {/* Preview Section */}
          {selectedPresetId && previewPresetData && (
            <div className="p-4 bg-white border-2 border-primary-300 rounded-md">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="h-4 w-4 text-primary-600" />
                <h4 className="text-sm font-semibold text-primary-900">Preview: {previewPresetData.preset.preset_name}</h4>
              </div>

              {isLoadingPreview ? (
                <div className="text-sm text-gray-500 text-center py-4">Loading preview...</div>
              ) : previewPresetData.services.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs text-gray-600 mb-2">
                    This preset contains {previewPresetData.services.length} service{previewPresetData.services.length !== 1 ? 's' : ''}:
                  </p>
                  {previewPresetData.services.map((presetService, idx) => (
                    <div
                      key={idx}
                      className="p-3 bg-gray-50 border border-gray-200 rounded-md"
                    >
                      <div className="flex items-center gap-2">
                        <Package className="h-3 w-3 text-gray-600" />
                        <span className="text-sm font-medium text-gray-900">
                          {presetService.service_name}
                        </span>
                        {presetService.quantity && (
                          <span className="text-xs text-gray-600 ml-auto">
                            Qty: {presetService.quantity}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-gray-500 text-center py-2">
                  No services configured for this preset
                </div>
              )}
            </div>
          )}

          {(data.fixed_presets ?? []).length > 0 && (
            <div className="space-y-3">
              {(data.fixed_presets ?? []).map((preset, index) => {
                const presetData = presetServicesMap.get(preset.preset_id);
                const isExpanded = expandedPresets.has(preset.preset_id);
                const presetServices = presetData?.services || [];

                return (
                  <div
                    key={index}
                    className="bg-white border border-primary-200 rounded-md overflow-hidden"
                  >
                    {/* Preset Header */}
                    <div className="flex items-center justify-between p-3 bg-primary-50">
                      <button
                        type="button"
                        onClick={() => togglePresetExpanded(preset.preset_id)}
                        className="flex items-center gap-2 flex-1 text-left hover:bg-primary-100 -m-3 p-3 rounded transition-colors"
                      >
                        <Sparkles className="h-4 w-4 text-primary-600 flex-shrink-0" />
                        <span className="text-sm font-medium text-primary-900">{preset.preset_name}</span>
                        {presetServices.length > 0 && (
                          <span className="text-xs text-primary-600 ml-2">
                            ({presetServices.length} service{presetServices.length !== 1 ? 's' : ''})
                          </span>
                        )}
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4 text-primary-600 ml-auto" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-primary-600 ml-auto" />
                        )}
                      </button>
                      <Button
                        id={`template-fixed-remove-preset-${index}`}
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemovePreset(index)}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50 ml-2"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>

                    {/* Preset Services */}
                    {isExpanded && presetServices.length > 0 && (
                      <div className="p-3 space-y-2 bg-white border-t border-primary-100">
                        {presetServices.map((presetService, svcIndex) => {
                          const currentQuantity = preset.service_quantities?.[presetService.service_id] ?? presetService.quantity ?? 1;

                          return (
                            <div
                              key={svcIndex}
                              className="p-3 bg-gray-50 border border-gray-200 rounded-md"
                            >
                              <div className="space-y-3">
                                <div className="flex items-center gap-2">
                                  <Package className="h-4 w-4 text-gray-600" />
                                  <span className="text-sm font-medium text-gray-900">
                                    {presetService.service_name}
                                  </span>
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor={`preset-${index}-service-${svcIndex}-quantity`} className="text-sm">
                                    Quantity Guidance
                                  </Label>
                                  <Input
                                    id={`preset-${index}-service-${svcIndex}-quantity`}
                                    type="number"
                                    min="1"
                                    value={currentQuantity}
                                    onChange={(e) =>
                                      handlePresetServiceQuantityChange(
                                        index,
                                        presetService.service_id,
                                        Math.max(1, Number(e.target.value) || 1)
                                      )
                                    }
                                    className="w-28"
                                  />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {isExpanded && presetServices.length === 0 && (
                      <div className="p-3 text-sm text-gray-500 text-center border-t border-primary-100">
                        No services configured for this preset
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex gap-2">
            <div className="flex-1">
              <CustomSelect
                id="template-fixed-preset-select"
                value={selectedPresetId}
                onValueChange={setSelectedPresetId}
                options={presetOptions}
                placeholder={isLoadingPresets ? 'Loading presets...' : 'Select a preset'}
                disabled={isLoadingPresets}
              />
            </div>
            <Button
              id="template-fixed-add-preset"
              type="button"
              variant="secondary"
              onClick={async () => {
                if (selectedPresetId) {
                  await handleAddPreset(selectedPresetId);
                  setSelectedPresetId('');
                  setPreviewPresetData(null);
                }
              }}
              disabled={!selectedPresetId}
              className="bg-primary-100 hover:bg-primary-200 text-primary-900"
            >
              <Plus className="h-4 w-4 mr-2" />
              {selectedPresetId ? 'Add This Preset' : 'Add Preset'}
            </Button>
          </div>
        </div>

        <div className="space-y-4">
          <Label className="flex items-center gap-2">
            <Package className="h-4 w-4" />
            Services
          </Label>

          {data.fixed_services.map((service, index) => (
            <div
              key={index}
              className="flex items-start gap-3 p-4 border border-gray-200 rounded-md bg-gray-50"
            >
              <div className="flex-1 space-y-3">
                <div className="space-y-2">
                  <Label htmlFor={`template-fixed-service-${index}`} className="text-sm">
                    Service {index + 1}
                  </Label>
                  <CustomSelect
                    id={`template-fixed-service-${index}`}
                    value={service.service_id}
                    onValueChange={(value: string) => handleServiceChange(index, value)}
                    options={serviceOptions}
                    placeholder={isLoadingServices ? 'Loading…' : 'Select a service'}
                    disabled={isLoadingServices}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor={`template-fixed-quantity-${index}`} className="text-sm">
                      Quantity (Optional)
                    </Label>
                    <Input
                      id={`template-fixed-quantity-${index}`}
                      type="number"
                      min="1"
                      value={service.quantity ?? 1}
                      onChange={(event) =>
                        handleQuantityChange(index, Math.max(1, Number(event.target.value) || 1))
                      }
                      className="w-24"
                    />
                    <p className="text-xs text-gray-500">Suggested quantity when creating contracts</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor={`template-fixed-rate-${index}`} className="text-sm">
                      Rate (Optional)
                    </Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                      <Input
                        id={`template-fixed-rate-${index}`}
                        type="text"
                        inputMode="decimal"
                        value={rateInputs[index] ?? ''}
                        onChange={(event) => {
                          const value = event.target.value.replace(/[^0-9.]/g, '');
                          const decimalCount = (value.match(/\./g) || []).length;
                          if (decimalCount <= 1) {
                            setRateInputs((prev) => ({ ...prev, [index]: value }));
                          }
                        }}
                        onBlur={() => {
                          const inputValue = rateInputs[index] ?? '';
                          if (inputValue.trim() === '' || inputValue === '.') {
                            setRateInputs((prev) => ({ ...prev, [index]: '' }));
                            handleRateChange(index, undefined);
                          } else {
                            const dollars = parseFloat(inputValue) || 0;
                            handleRateChange(index, dollars);
                            setRateInputs((prev) => ({ ...prev, [index]: dollars.toFixed(2) }));
                          }
                        }}
                        placeholder="0.00"
                        className="pl-7"
                      />
                    </div>
                    <p className="text-xs text-gray-500">Suggested rate when creating contracts</p>
                  </div>
                </div>
              </div>

              <Button
                id={`template-fixed-remove-service-${index}`}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleRemoveService(index)}
                className="mt-8 text-red-600 hover:text-red-700 hover:bg-red-50"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}

          <Button
            id="template-fixed-add-service"
            type="button"
            variant="secondary"
            onClick={handleAddService}
            className="inline-flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Add Service
          </Button>
        </div>
      </div>
    </ReflectionContainer>
  );
}
