'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardContent, CardTitle, CardDescription } from '@alga-psa/ui/components/Card';
import { UnitOfMeasureInput } from '@alga-psa/ui/components/UnitOfMeasureInput';
import { ServiceTaxSettings } from './ServiceTaxSettings';
import { ServiceRateTiers } from './ServiceRateTiers';
import { IService } from '@alga-psa/types';
import { getServiceById } from '@alga-psa/billing/actions';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface ServiceConfigurationPanelProps {
  serviceId: string;
  onUpdate?: () => void;
}

export function ServiceConfigurationPanel({ serviceId, onUpdate }: ServiceConfigurationPanelProps) {
  const { t } = useTranslation('msp/service-catalog');
  const { formatCurrency } = useFormatters();
  const [service, setService] = useState<IService | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // Fetch service data
        const serviceData = await getServiceById(serviceId);
        if (serviceData) {
          setService(serviceData);
        } else {
          setError(t('serviceDetail.errors.notFound', { defaultValue: 'Service not found' }));
        }
      } catch (err) {
        console.error('Error fetching service:', err);
        setError(t('serviceDetail.errors.load', {
          defaultValue: 'Failed to load service configuration',
        }));
      } finally {
        setLoading(false);
      }
    };

    if (serviceId) {
      fetchData();
    }
  }, [serviceId, t]);

  const handleServiceUpdate = async () => {
    try {
      setLoading(true);
      const updatedService = await getServiceById(serviceId);
      if (updatedService) {
        setService(updatedService);
      }
      
      if (onUpdate) {
        onUpdate();
      }
    } catch (err) {
      console.error('Error refreshing service data:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading && !service) {
    return (
      <Card className="w-full">
        <CardContent className="pt-6">
          <div className="flex justify-center items-center h-40">
            <p className="text-muted-foreground">
              {t('serviceDetail.loading', { defaultValue: 'Loading service configuration...' })}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !service) {
    return (
      <Card className="w-full">
        <CardContent className="pt-6">
          <div className="flex justify-center items-center h-40">
            <p className="text-red-500">
              {error || t('serviceDetail.errors.notFound', { defaultValue: 'Service not found' })}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>
            {t('serviceDetail.title', {
              serviceName: service.service_name,
              defaultValue: 'Service Configuration: {{serviceName}}',
            })}
          </CardTitle>
          <CardDescription>
            {t('serviceDetail.description', {
              defaultValue: 'Configure service details, pricing, and tax settings',
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="text-lg font-medium mb-2">
                {t('serviceDetail.sections.unitOfMeasure', {
                  defaultValue: 'Unit of Measure',
                })}
              </h3>
              <UnitOfMeasureInput
                value={service.unit_of_measure}
                onChange={() => {}} // Handled internally by the component
                serviceId={service.service_id}
                onSaveComplete={handleServiceUpdate}
                serviceType={service.service_type_name}
                required
              />
            </div>
            
            <div>
              <h3 className="text-lg font-medium mb-2">
                {t('serviceDetail.sections.baseRate', { defaultValue: 'Base Rate' })}
              </h3>
              <p className="text-sm text-muted-foreground mb-2">
                {t('serviceDetail.baseRate.summary', {
                  rate: formatCurrency(
                    service.default_rate,
                    service.prices?.[0]?.currency_code || 'USD',
                  ),
                  unit: service.unit_of_measure,
                  defaultValue: '{{rate}} per {{unit}}',
                })}
              </p>
              <p className="text-sm text-muted-foreground">
                {t('serviceDetail.baseRate.help', {
                  defaultValue: 'The base rate can be overridden with quantity-based tiers below.',
                })}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <ServiceTaxSettings 
        service={service} 
        onUpdate={handleServiceUpdate}
      />

      <ServiceRateTiers 
        service={service}
        onUpdate={handleServiceUpdate}
      />
    </div>
  );
}
