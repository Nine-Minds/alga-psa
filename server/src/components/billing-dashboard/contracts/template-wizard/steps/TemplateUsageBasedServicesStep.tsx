'use client';

import React, { useEffect, useState } from 'react';
import { IService, IContractLinePreset, IContractLinePresetService } from 'server/src/interfaces';
import { getServices } from 'server/src/lib/actions/serviceActions';
import { getContractLinePresets, getContractLinePresetServices } from 'server/src/lib/actions/contractLinePresetActions';
import { TemplateWizardData, TemplateBucketOverlayInput } from '../TemplateWizard';
import { Label } from 'server/src/components/ui/Label';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { SwitchWithLabel } from 'server/src/components/ui/SwitchWithLabel';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { BucketOverlayFields } from '../../BucketOverlayFields';
import { BarChart3, Plus, X, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import { TemplateServicePreviewSection } from '../TemplateServicePreviewSection';

interface TemplateUsageBasedServicesStepProps {
  data: TemplateWizardData;
  updateData: (data: Partial<TemplateWizardData>) => void;
}

type PresetWithServices = {
  preset: IContractLinePreset;
  services: Array<IContractLinePresetService & { service_name?: string }>;
};

export function TemplateUsageBasedServicesStep({
  data,
  updateData,
}: TemplateUsageBasedServicesStepProps) {
  const [services, setServices] = useState<IService[]>([]);
  const [isLoadingServices, setIsLoadingServices] = useState(true);
  const [presets, setPresets] = useState<IContractLinePreset[]>([]);
  const [isLoadingPresets, setIsLoadingPresets] = useState(true);
  const [selectedPresetId, setSelectedPresetId] = useState<string>('');
  const [presetServicesMap, setPresetServicesMap] = useState<Map<string, PresetWithServices>>(new Map());
  const [expandedPresets, setExpandedPresets] = useState<Set<string>>(new Set());
  const [previewPresetData, setPreviewPresetData] = useState<PresetWithServices | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const result = await getServices();
        if (result && Array.isArray(result.services)) {
          const usageServices = result.services.filter(
            (service) => service.billing_method === 'usage'
          );
          setServices(usageServices);
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
    const loadPresets = async () => {
      try {
        const allPresets = await getContractLinePresets();
        const usagePresets = allPresets.filter(
          (preset) => preset.contract_line_type === 'Usage'
        );
        setPresets(usagePresets);
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
      usage_services: [
        ...(data.usage_services ?? []),
        { service_id: '', service_name: '', unit_of_measure: '', bucket_overlay: undefined },
      ],
    });
  };

  const loadPresetServices = async (presetId: string) => {
    try {
      const preset = presets.find((p) => p.preset_id === presetId);
      if (!preset) return;

      const presetServices = await getContractLinePresetServices(presetId);

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

      setExpandedPresets((prev) => new Set([...prev, presetId]));
    } catch (error) {
      console.error(`Error loading services for preset ${presetId}:`, error);
    }
  };

  const handleAddPreset = async (presetId: string) => {
    const preset = presets.find((p) => p.preset_id === presetId);
    if (!preset) return;

    const existingPresets = data.usage_presets ?? [];
    if (existingPresets.some((p) => p.preset_id === presetId)) {
      return;
    }

    updateData({
      usage_presets: [
        ...existingPresets,
        { preset_id: presetId, preset_name: preset.preset_name },
      ],
    });

    await loadPresetServices(presetId);
  };

  const handleRemovePreset = (index: number) => {
    const existingPresets = data.usage_presets ?? [];
    const removedPreset = existingPresets[index];
    const next = existingPresets.filter((_, i) => i !== index);
    updateData({ usage_presets: next });

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
    const next = (data.usage_services ?? []).filter((_, i) => i !== index);
    updateData({ usage_services: next });
  };

  const handleServiceChange = (index: number, serviceId: string) => {
    const service = services.find((s) => s.service_id === serviceId);
    const next = [...(data.usage_services ?? [])];
    next[index] = {
      ...next[index],
      service_id: serviceId,
      service_name: service?.service_name ?? '',
      unit_of_measure: service?.unit_of_measure ?? next[index].unit_of_measure ?? '',
    };
    updateData({ usage_services: next });
  };

  const handleUnitChange = (index: number, unit: string) => {
    const next = [...(data.usage_services ?? [])];
    next[index] = { ...next[index], unit_of_measure: unit };
    updateData({ usage_services: next });
  };

  const getDefaultOverlay = (billingFrequency: string): TemplateBucketOverlayInput => ({
    total_minutes: undefined,
    overage_rate: undefined,
    allow_rollover: false,
    billing_period: billingFrequency,
  });

  const toggleBucketOverlay = (index: number, enabled: boolean) => {
    const next = [...(data.usage_services ?? [])];
    if (enabled) {
      next[index] = {
        ...next[index],
        bucket_overlay: next[index].bucket_overlay
          ? { ...next[index].bucket_overlay }
          : getDefaultOverlay(data.billing_frequency),
      };
    } else {
      next[index] = { ...next[index], bucket_overlay: undefined };
    }
    updateData({ usage_services: next });
  };

  const updateBucketOverlay = (index: number, overlay: TemplateBucketOverlayInput) => {
    const next = [...(data.usage_services ?? [])];
    next[index] = { ...next[index], bucket_overlay: { ...overlay } };
    updateData({ usage_services: next });
  };

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
      fromPreset?: {
        presetId: string;
        presetName: string;
      };
      serviceId: string;
    }> = [];

    // Add preset services
    for (const preset of data.usage_presets ?? []) {
      const presetData = presetServicesMap.get(preset.preset_id);
      if (presetData) {
        for (const presetService of presetData.services) {
          items.push({
            id: `preset-${preset.preset_id}-${presetService.service_id}`,
            name: presetService.service_name || 'Unknown Service',
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
    for (const service of data.usage_services ?? []) {
      if (service.service_id) {
        items.push({
          id: `service-${service.service_id}`,
          name: service.service_name || 'Unknown Service',
          serviceId: service.service_id,
        });
      }
    }

    return items;
  }, [data.usage_presets, data.usage_services, presetServicesMap]);

  const handlePreviewRemoveService = (itemId: string, fromPresetId?: string) => {
    if (fromPresetId) {
      // Remove entire preset
      const presetIndex = (data.usage_presets ?? []).findIndex((p) => p.preset_id === fromPresetId);
      if (presetIndex !== -1) {
        handleRemovePreset(presetIndex);
      }
    } else if (itemId.startsWith('service-')) {
      // Remove individual service
      const serviceId = itemId.replace('service-', '');
      const serviceIndex = (data.usage_services ?? []).findIndex((s) => s.service_id === serviceId);
      if (serviceIndex !== -1) {
        handleRemoveService(serviceIndex);
      }
    }
  };

  return (
    <ReflectionContainer id="template-usage-services-step">
      <div className="space-y-6">
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-2">Usage-Based Services</h3>
          <p className="text-sm text-gray-600">
            Configure services that are billed based on usage or consumption. Perfect for metered services like data transfer, API calls, or storage.
          </p>
        </div>

        <div className="p-4 bg-accent-50 border border-accent-200 rounded-md mb-6">
          <p className="text-sm text-accent-900">
            <strong>What are Usage-Based Services?</strong> These services are billed based on actual consumption or usage metrics. Each unit consumed will be multiplied by the unit rate to calculate the invoice amount.
          </p>
        </div>

        <TemplateServicePreviewSection
          services={previewServices}
          serviceType="usage"
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
                      <div className="flex items-start gap-2">
                        <BarChart3 className="h-3 w-3 text-gray-600 mt-0.5" />
                        <div className="flex-1">
                          <div className="text-sm font-medium text-gray-900">
                            {presetService.service_name}
                          </div>
                          {presetService.unit_of_measure && (
                            <div className="text-xs text-gray-600 mt-1">
                              Unit: {presetService.unit_of_measure}
                            </div>
                          )}
                        </div>
                        {presetService.quantity && (
                          <span className="text-xs text-gray-600">
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

          {(data.usage_presets ?? []).length > 0 && (
            <div className="space-y-3">
              {(data.usage_presets ?? []).map((preset, index) => {
                const presetData = presetServicesMap.get(preset.preset_id);
                const isExpanded = expandedPresets.has(preset.preset_id);
                const presetServices = presetData?.services || [];

                return (
                  <div
                    key={index}
                    className="bg-white border border-primary-200 rounded-md overflow-hidden"
                  >
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
                        id={`template-usage-remove-preset-${index}`}
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemovePreset(index)}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50 ml-2"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>

                    {isExpanded && presetServices.length > 0 && (
                      <div className="p-3 space-y-2 bg-white border-t border-primary-100">
                        {presetServices.map((presetService, svcIndex) => (
                          <div
                            key={svcIndex}
                            className="p-3 bg-gray-50 border border-gray-200 rounded-md"
                          >
                            <div className="space-y-2">
                              <div className="flex items-center gap-2">
                                <BarChart3 className="h-4 w-4 text-gray-600" />
                                <span className="text-sm font-medium text-gray-900">
                                  {presetService.service_name}
                                </span>
                              </div>
                              {presetService.quantity && (
                                <div className="text-xs text-gray-600">
                                  <span className="font-medium">Quantity Guidance:</span> {presetService.quantity}
                                </div>
                              )}
                              {presetService.unit_of_measure && (
                                <div className="text-xs text-gray-600">
                                  <span className="font-medium">Unit of Measure:</span> {presetService.unit_of_measure}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
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
                id="template-usage-preset-select"
                value={selectedPresetId}
                onValueChange={setSelectedPresetId}
                options={presetOptions}
                placeholder={isLoadingPresets ? 'Loading presets...' : 'Select a preset'}
                disabled={isLoadingPresets}
              />
            </div>
            <Button
              id="template-usage-add-preset"
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
            <BarChart3 className="h-4 w-4" />
            Services
          </Label>

          {(data.usage_services ?? []).map((service, index) => (
            <div
              key={index}
              className="flex items-start gap-3 p-4 border border-gray-200 rounded-md bg-gray-50"
            >
              <div className="flex-1 space-y-3">
                <div className="space-y-2">
                  <Label htmlFor={`template-usage-service-${index}`} className="text-sm">
                    Service {index + 1}
                  </Label>
                  <CustomSelect
                    id={`template-usage-service-${index}`}
                    value={service.service_id}
                    onValueChange={(value: string) => handleServiceChange(index, value)}
                    options={serviceOptions}
                    placeholder={isLoadingServices ? 'Loading…' : 'Select a service'}
                    disabled={isLoadingServices}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`template-unit-${index}`} className="text-sm">
                    Unit of measure
                  </Label>
                  <Input
                    id={`template-unit-${index}`}
                    value={service.unit_of_measure ?? ''}
                    onChange={(event) => handleUnitChange(index, event.target.value)}
                    placeholder="e.g., GB, devices, tickets"
                  />
                </div>

                <div className="space-y-3 pt-2 border-t border-dashed border-secondary-100">
                  <SwitchWithLabel
                    label="Recommend bucket of consumption"
                    checked={Boolean(service.bucket_overlay)}
                    onCheckedChange={(checked) => toggleBucketOverlay(index, Boolean(checked))}
                  />
                  {service.bucket_overlay && (
                    <BucketOverlayFields
                      mode="usage"
                      value={service.bucket_overlay ?? getDefaultOverlay(data.billing_frequency)}
                      onChange={(overlay) => updateBucketOverlay(index, overlay)}
                      automationId={`template-usage-bucket-${index}`}
                      billingFrequency={data.billing_frequency}
                    />
                  )}
                </div>
              </div>

              <Button
                id={`template-usage-remove-service-${index}`}
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
            id="template-usage-add-service"
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
