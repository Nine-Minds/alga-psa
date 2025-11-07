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
import { Plus, X, Activity, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import { TemplateServicePreviewSection } from '../TemplateServicePreviewSection';

interface TemplateHourlyServicesStepProps {
  data: TemplateWizardData;
  updateData: (data: Partial<TemplateWizardData>) => void;
}

type PresetWithServices = {
  preset: IContractLinePreset;
  services: Array<IContractLinePresetService & { service_name?: string }>;
};

export function TemplateHourlyServicesStep({
  data,
  updateData,
}: TemplateHourlyServicesStepProps) {
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
          const hourlyServices = result.services.filter(
            (service) => service.billing_method === 'hourly'
          );
          setServices(hourlyServices);
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
        const hourlyPresets = allPresets.filter(
          (preset) => preset.contract_line_type === 'Hourly'
        );
        setPresets(hourlyPresets);
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
      hourly_services: [
        ...data.hourly_services,
        { service_id: '', service_name: '', bucket_overlay: undefined, suggested_rate: undefined },
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

    const existingPresets = data.hourly_presets ?? [];
    if (existingPresets.some((p) => p.preset_id === presetId)) {
      return;
    }

    // Treat 0, null, or undefined as "not set" and use default of 15
    const minBillable = (preset.minimum_billable_time && preset.minimum_billable_time > 0)
      ? preset.minimum_billable_time
      : 15;
    const roundUp = (preset.round_up_to_nearest && preset.round_up_to_nearest > 0)
      ? preset.round_up_to_nearest
      : 15;

    updateData({
      hourly_presets: [
        ...existingPresets,
        {
          preset_id: presetId,
          preset_name: preset.preset_name,
          minimum_billable_time: minBillable,
          round_up_to_nearest: roundUp,
        },
      ],
    });

    await loadPresetServices(presetId);
  };

  const handleRemovePreset = (index: number) => {
    const existingPresets = data.hourly_presets ?? [];
    const removedPreset = existingPresets[index];
    const next = existingPresets.filter((_, i) => i !== index);
    updateData({ hourly_presets: next });

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

  const handlePresetMinBillableTimeChange = (presetIndex: number, value: number) => {
    const existingPresets = data.hourly_presets ?? [];
    const updatedPresets = [...existingPresets];
    const preset = updatedPresets[presetIndex];

    if (preset) {
      preset.minimum_billable_time = Math.max(0, value);
      updateData({ hourly_presets: updatedPresets });
    }
  };

  const handlePresetRoundUpChange = (presetIndex: number, value: number) => {
    const existingPresets = data.hourly_presets ?? [];
    const updatedPresets = [...existingPresets];
    const preset = updatedPresets[presetIndex];

    if (preset) {
      preset.round_up_to_nearest = Math.max(0, value);
      updateData({ hourly_presets: updatedPresets });
    }
  };

  const handleRemoveService = (index: number) => {
    const next = data.hourly_services.filter((_, i) => i !== index);
    updateData({ hourly_services: next });
  };

  const handleServiceChange = (index: number, serviceId: string) => {
    const service = services.find((s) => s.service_id === serviceId);
    const next = [...data.hourly_services];
    next[index] = {
      ...next[index],
      service_id: serviceId,
      service_name: service?.service_name ?? '',
    };
    updateData({ hourly_services: next });
  };

  const getDefaultOverlay = (billingFrequency: string): TemplateBucketOverlayInput => ({
    total_minutes: undefined,
    overage_rate: undefined,
    allow_rollover: false,
    billing_period: billingFrequency,
  });

  const toggleBucketOverlay = (index: number, enabled: boolean) => {
    const next = [...data.hourly_services];
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
    updateData({ hourly_services: next });
  };

  const updateBucketOverlay = (index: number, overlay: TemplateBucketOverlayInput) => {
    const next = [...data.hourly_services];
    next[index] = { ...next[index], bucket_overlay: { ...overlay } };
    updateData({ hourly_services: next });
  };

  const handleRateChange = (index: number, rate: number | undefined) => {
    const next = [...data.hourly_services];
    next[index] = { ...next[index], suggested_rate: rate };
    updateData({ hourly_services: next });
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
    for (const preset of data.hourly_presets ?? []) {
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
    for (const service of data.hourly_services) {
      if (service.service_id) {
        items.push({
          id: `service-${service.service_id}`,
          name: service.service_name || 'Unknown Service',
          serviceId: service.service_id,
        });
      }
    }

    return items;
  }, [data.hourly_presets, data.hourly_services, presetServicesMap]);

  const handlePreviewRemoveService = (itemId: string, fromPresetId?: string) => {
    if (fromPresetId) {
      // Remove entire preset
      const presetIndex = (data.hourly_presets ?? []).findIndex((p) => p.preset_id === fromPresetId);
      if (presetIndex !== -1) {
        handleRemovePreset(presetIndex);
      }
    } else if (itemId.startsWith('service-')) {
      // Remove individual service
      const serviceId = itemId.replace('service-', '');
      const serviceIndex = data.hourly_services.findIndex((s) => s.service_id === serviceId);
      if (serviceIndex !== -1) {
        handleRemoveService(serviceIndex);
      }
    }
  };

  return (
    <ReflectionContainer id="template-hourly-services-step">
      <div className="space-y-6">
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-2">Hourly Services</h3>
          <p className="text-sm text-gray-600">
            Configure services that are billed based on time tracked. Perfect for T&M (Time & Materials) work.
          </p>
        </div>

        <div className="p-4 bg-accent-50 border border-accent-200 rounded-md mb-6">
          <p className="text-sm text-accent-900">
            <strong>What are Hourly Services?</strong> These services are billed based on actual time tracked. Each time entry will be multiplied by the hourly rate to calculate the invoice amount.
          </p>
        </div>

        <TemplateServicePreviewSection
          services={previewServices}
          serviceType="hourly"
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
              ) : (
                <>
                  {/* Preset Configuration */}
                  <div className="mb-3 p-3 bg-gray-50 border border-gray-200 rounded-md">
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <span className="font-medium text-gray-700">Minimum billable minutes:</span>
                        <span className="ml-2 text-gray-900">
                          {previewPresetData.preset.minimum_billable_time ?? 'Not set'}
                        </span>
                      </div>
                      <div>
                        <span className="font-medium text-gray-700">Round up to nearest:</span>
                        <span className="ml-2 text-gray-900">
                          {previewPresetData.preset.round_up_to_nearest ?? 'Not set'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Services */}
                  {previewPresetData.services.length > 0 ? (
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
                            <Activity className="h-3 w-3 text-gray-600" />
                            <span className="text-sm font-medium text-gray-900">
                              {presetService.service_name}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-gray-500 text-center py-2">
                      No services configured for this preset
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {(data.hourly_presets ?? []).length > 0 && (
            <div className="space-y-3">
              {(data.hourly_presets ?? []).map((preset, index) => {
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
                        id={`template-hourly-remove-preset-${index}`}
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
                      <div className="p-3 space-y-3 bg-white border-t border-primary-100">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-2">
                            <Label htmlFor={`preset-${index}-min-billable`} className="text-sm">
                              Minimum billable minutes
                            </Label>
                            <Input
                              id={`preset-${index}-min-billable`}
                              type="number"
                              min="0"
                              value={preset.minimum_billable_time ?? ''}
                              onChange={(e) =>
                                handlePresetMinBillableTimeChange(
                                  index,
                                  Math.max(0, Number(e.target.value) || 0)
                                )
                              }
                              placeholder="15"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor={`preset-${index}-round-up`} className="text-sm">
                              Round up to nearest (minutes)
                            </Label>
                            <Input
                              id={`preset-${index}-round-up`}
                              type="number"
                              min="0"
                              value={preset.round_up_to_nearest ?? ''}
                              onChange={(e) =>
                                handlePresetRoundUpChange(
                                  index,
                                  Math.max(0, Number(e.target.value) || 0)
                                )
                              }
                              placeholder="15"
                            />
                          </div>
                        </div>

                        <div className="space-y-2 pt-2 border-t border-gray-200">
                          <Label className="text-sm font-medium">Services in this preset</Label>
                          {presetServices.map((presetService, svcIndex) => (
                            <div
                              key={svcIndex}
                              className="p-3 bg-gray-50 border border-gray-200 rounded-md"
                            >
                              <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                  <Activity className="h-4 w-4 text-gray-600" />
                                  <span className="text-sm font-medium text-gray-900">
                                    {presetService.service_name}
                                  </span>
                                </div>
                                {presetService.quantity && (
                                  <div className="text-xs text-gray-600">
                                    <span className="font-medium">Quantity Guidance:</span> {presetService.quantity}
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
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
                id="template-hourly-preset-select"
                value={selectedPresetId}
                onValueChange={setSelectedPresetId}
                options={presetOptions}
                placeholder={isLoadingPresets ? 'Loading presets...' : 'Select a preset'}
                disabled={isLoadingPresets}
              />
            </div>
            <Button
              id="template-hourly-add-preset"
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
            <Activity className="h-4 w-4" />
            Services
          </Label>

          {data.hourly_services.map((service, index) => (
            <div
              key={index}
              className="flex items-start gap-3 p-4 border border-gray-200 rounded-md bg-gray-50"
            >
              <div className="flex-1 space-y-3">
                <div className="space-y-2">
                  <Label htmlFor={`template-hourly-service-${index}`} className="text-sm">
                    Service {index + 1}
                  </Label>
                  <CustomSelect
                    id={`template-hourly-service-${index}`}
                    value={service.service_id}
                    onValueChange={(value: string) => handleServiceChange(index, value)}
                    options={serviceOptions}
                    placeholder={isLoadingServices ? 'Loading…' : 'Select a service'}
                    disabled={isLoadingServices}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`template-hourly-rate-${index}`} className="text-sm">
                    Suggested Hourly Rate ($/hr)
                  </Label>
                  <Input
                    id={`template-hourly-rate-${index}`}
                    type="number"
                    min="0"
                    step="0.01"
                    value={service.suggested_rate ?? ''}
                    onChange={(event) =>
                      handleRateChange(index, event.target.value ? Number(event.target.value) : undefined)
                    }
                    placeholder="Optional - leave blank to set per contract"
                  />
                  <p className="text-xs text-gray-500">Suggested rate when creating contracts</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor={`template-min-time-${index}`} className="text-sm">
                      Minimum billable minutes
                    </Label>
                    <Input
                      id={`template-min-time-${index}`}
                      type="number"
                      min="0"
                      value={data.minimum_billable_time ?? ''}
                      onChange={(event) =>
                        updateData({
                          minimum_billable_time: Math.max(
                            0,
                            Number(event.target.value) || 0
                          ),
                        })
                      }
                      placeholder="e.g., 15"
                    />
                    <p className="text-xs text-gray-500">Suggested minimum when creating contracts</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`template-round-up-${index}`} className="text-sm">
                      Round up to nearest (minutes)
                    </Label>
                    <Input
                      id={`template-round-up-${index}`}
                      type="number"
                      min="0"
                      value={data.round_up_to_nearest ?? ''}
                      onChange={(event) =>
                        updateData({
                          round_up_to_nearest: Math.max(
                            0,
                            Number(event.target.value) || 0
                          ),
                        })
                      }
                      placeholder="e.g., 15"
                    />
                    <p className="text-xs text-gray-500">Suggested rounding when creating contracts</p>
                  </div>
                </div>

                <div className="space-y-3 pt-2 border-t border-dashed border-secondary-100">
                  <SwitchWithLabel
                    label="Recommend bucket of hours"
                    checked={Boolean(service.bucket_overlay)}
                    onCheckedChange={(checked) => toggleBucketOverlay(index, Boolean(checked))}
                  />
                  {service.bucket_overlay && (
                    <BucketOverlayFields
                      mode="hours"
                      value={service.bucket_overlay ?? getDefaultOverlay(data.billing_frequency)}
                      onChange={(overlay) => updateBucketOverlay(index, overlay)}
                      automationId={`template-hourly-bucket-${index}`}
                      billingFrequency={data.billing_frequency}
                    />
                  )}
                </div>
              </div>

              <Button
                id={`template-hourly-remove-service-${index}`}
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
            id="template-hourly-add-service"
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
