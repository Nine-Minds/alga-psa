'use client';

import React, { useState } from 'react';
import { Label } from 'server/src/components/ui/Label';
import { Input } from 'server/src/components/ui/Input';
import { Button } from 'server/src/components/ui/Button';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';
import { X, Package, Activity, BarChart3, Sparkles } from 'lucide-react';

interface ServiceItem {
  id: string;
  name: string;
  quantity?: number;
  fromPreset?: {
    presetId: string;
    presetName: string;
  };
}

interface TemplateServicePreviewSectionProps {
  services: ServiceItem[];
  serviceType: 'fixed' | 'hourly' | 'usage';
  onQuantityChange?: (serviceId: string, quantity: number) => void;
  onRemoveService: (serviceId: string, fromPresetId?: string) => void;
}

export function TemplateServicePreviewSection({
  services,
  serviceType,
  onQuantityChange,
  onRemoveService,
}: TemplateServicePreviewSectionProps) {
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    serviceId: string;
    serviceName: string;
    presetId?: string;
    presetName?: string;
  } | null>(null);

  const getServiceIcon = () => {
    switch (serviceType) {
      case 'fixed':
        return Package;
      case 'hourly':
        return Activity;
      case 'usage':
        return BarChart3;
    }
  };

  const getServiceTypeLabel = () => {
    switch (serviceType) {
      case 'fixed':
        return 'Fixed Fee';
      case 'hourly':
        return 'Hourly';
      case 'usage':
        return 'Usage-Based';
    }
  };

  const handleRemoveClick = (service: ServiceItem) => {
    if (service.fromPreset) {
      // Show confirmation dialog for preset services
      setConfirmDialog({
        isOpen: true,
        serviceId: service.id,
        serviceName: service.name,
        presetId: service.fromPreset.presetId,
        presetName: service.fromPreset.presetName,
      });
    } else {
      // Directly remove individual services
      onRemoveService(service.id);
    }
  };

  const handleConfirmRemove = () => {
    if (confirmDialog) {
      onRemoveService(confirmDialog.serviceId, confirmDialog.presetId);
      setConfirmDialog(null);
    }
  };

  if (services.length === 0) {
    return null;
  }

  const ServiceIcon = getServiceIcon();

  return (
    <>
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-md">
        <div className="flex items-center gap-2 mb-3">
          <ServiceIcon className="h-5 w-5 text-blue-700" />
          <h4 className="text-sm font-semibold text-blue-900">
            Selected {getServiceTypeLabel()} Services ({services.length})
          </h4>
        </div>

        <div className="space-y-2">
          {services.map((service) => (
            <div
              key={service.id}
              className="flex items-center gap-3 p-3 bg-white border border-blue-200 rounded-md"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900">
                    {service.name}
                  </span>
                  {service.fromPreset && (
                    <div className="flex items-center gap-1 px-2 py-0.5 bg-purple-100 border border-purple-200 rounded text-xs text-purple-700">
                      <Sparkles className="h-3 w-3" />
                      <span>{service.fromPreset.presetName}</span>
                    </div>
                  )}
                </div>
              </div>

              {onQuantityChange && service.quantity !== undefined && (
                <div className="flex items-center gap-2">
                  <Label htmlFor={`preview-quantity-${service.id}`} className="text-xs text-gray-600">
                    Qty:
                  </Label>
                  <Input
                    id={`preview-quantity-${service.id}`}
                    type="number"
                    min="1"
                    value={service.quantity}
                    onChange={(e) => onQuantityChange(service.id, Math.max(1, Number(e.target.value) || 1))}
                    className="w-20 h-8 text-sm"
                  />
                </div>
              )}

              <Button
                id={`preview-remove-${service.id}`}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleRemoveClick(service)}
                className="text-red-600 hover:text-red-700 hover:bg-red-50"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      </div>

      <ConfirmationDialog
        isOpen={confirmDialog?.isOpen ?? false}
        onClose={() => setConfirmDialog(null)}
        onConfirm={handleConfirmRemove}
        title="Remove Contract Line Preset"
        message={`Are you sure you want to remove "${confirmDialog?.serviceName}" from "${confirmDialog?.presetName}"? This will remove all other services associated with this contract line preset as well.`}
        confirmLabel="Remove All"
        cancelLabel="Cancel"
        id="remove-preset-service-confirmation"
      />
    </>
  );
}
