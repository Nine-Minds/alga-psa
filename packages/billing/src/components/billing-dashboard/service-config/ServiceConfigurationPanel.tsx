'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardContent, CardTitle, CardDescription } from '@alga-psa/ui/components/Card';
import { UnitOfMeasureInput } from '@alga-psa/ui/components/UnitOfMeasureInput';
import { ServiceTaxSettings } from './ServiceTaxSettings';
import { ServiceRateTiers } from './ServiceRateTiers';
import { IService } from 'server/src/interfaces/billing.interfaces';
import { getServiceById } from 'server/src/lib/actions/serviceActions';

interface ServiceConfigurationPanelProps {
  serviceId: string;
  onUpdate?: () => void;
}

export function ServiceConfigurationPanel({ serviceId, onUpdate }: ServiceConfigurationPanelProps) {
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
          setError('Service not found');
        }
      } catch (err) {
        console.error('Error fetching service:', err);
        setError('Failed to load service configuration');
      } finally {
        setLoading(false);
      }
    };

    if (serviceId) {
      fetchData();
    }
  }, [serviceId]);

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
            <p className="text-gray-500">Loading service configuration...</p>
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
            <p className="text-red-500">{error || 'Service not found'}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Service Configuration: {service.service_name}</CardTitle>
          <CardDescription>
            Configure service details, pricing, and tax settings
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="text-lg font-medium mb-2">Unit of Measure</h3>
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
              <h3 className="text-lg font-medium mb-2">Base Rate</h3>
              <p className="text-sm text-gray-500 mb-2">
                ${service.default_rate} per {service.unit_of_measure}
              </p>
              <p className="text-sm text-gray-500">
                The base rate can be overridden with quantity-based tiers below.
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