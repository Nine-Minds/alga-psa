'use client';

import React, { useState } from 'react';
import { Label } from '@alga-psa/ui/components/Label';
import { Input } from '@alga-psa/ui/components/Input';
import { Button } from '@alga-psa/ui/components/Button';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { X, Package, Activity, BarChart3, Sparkles } from 'lucide-react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

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
  serviceType: 'fixed' | 'products' | 'hourly' | 'usage';
  onQuantityChange?: (serviceId: string, quantity: number) => void;
  onRemoveService: (serviceId: string, fromPresetId?: string) => void;
}

export function TemplateServicePreviewSection({
  services,
  serviceType,
  onQuantityChange,
  onRemoveService,
}: TemplateServicePreviewSectionProps) {
  const { t } = useTranslation('msp/contracts');
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
      case 'products':
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
        return t('templatePreview.serviceType.fixedFee', { defaultValue: 'Fixed Fee' });
      case 'products':
        return t('templatePreview.serviceType.products', { defaultValue: 'Products' });
      case 'hourly':
        return t('templatePreview.serviceType.hourly', { defaultValue: 'Hourly' });
      case 'usage':
        return t('templatePreview.serviceType.usageBased', { defaultValue: 'Usage-Based' });
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
      <Alert variant="info">
        <ServiceIcon className="h-4 w-4" />
        <AlertDescription>
          <h4 className="text-sm font-semibold mb-3">
            {t('templatePreview.selectedHeading', {
              type: getServiceTypeLabel(),
              count: services.length,
              defaultValue: 'Selected {{type}} Services ({{count}})',
            })}
          </h4>

          <div className="space-y-2">
            {services.map((service) => (
              <div
                key={service.id}
                className="flex items-center gap-3 p-3 bg-[rgb(var(--color-card))] border border-[rgb(var(--color-border-200))] rounded-md"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[rgb(var(--color-text-900))]">
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
                    <Label htmlFor={`preview-quantity-${service.id}`} className="text-xs text-[rgb(var(--color-text-500))]">
                      {t('templatePreview.labels.qty', { defaultValue: 'Qty:' })}
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
                  className="text-[rgb(var(--color-destructive))] hover:text-[rgb(var(--color-destructive))] hover:bg-[rgb(var(--color-destructive)/0.1)]"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </AlertDescription>
      </Alert>

      <ConfirmationDialog
        isOpen={confirmDialog?.isOpen ?? false}
        onClose={() => setConfirmDialog(null)}
        onConfirm={handleConfirmRemove}
        title={t('templatePreview.removeDialog.title', {
          defaultValue: 'Remove Contract Line Preset',
        })}
        message={t('templatePreview.removeDialog.message', {
          serviceName: confirmDialog?.serviceName,
          presetName: confirmDialog?.presetName,
          defaultValue:
            'Are you sure you want to remove "{{serviceName}}" from "{{presetName}}"? This will remove all other services associated with this contract line preset as well.',
        })}
        confirmLabel={t('templatePreview.removeDialog.confirm', { defaultValue: 'Remove All' })}
        cancelLabel={t('templatePreview.removeDialog.cancel', { defaultValue: 'Cancel' })}
        id="remove-preset-service-confirmation"
      />
    </>
  );
}
