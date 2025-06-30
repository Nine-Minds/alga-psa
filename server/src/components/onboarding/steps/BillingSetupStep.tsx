'use client';

import React from 'react';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { TextArea } from 'server/src/components/ui/TextArea';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { StepProps } from '../types';

export function BillingSetupStep({ data, updateData }: StepProps) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Basic Billing Setup</h2>
        <p className="text-sm text-gray-600">
          Configure your basic service and billing information. You can update this later.
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="serviceName">Service Name</Label>
          <Input
            id="serviceName"
            value={data.serviceName}
            onChange={(e) => updateData({ serviceName: e.target.value })}
            placeholder="Managed IT Services"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="serviceDescription">Service Description</Label>
          <TextArea
            id="serviceDescription"
            value={data.serviceDescription}
            onChange={(e) => updateData({ serviceDescription: e.target.value })}
            placeholder="Comprehensive IT support and management services..."
            rows={3}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="servicePrice">Default Price</Label>
            <Input
              id="servicePrice"
              value={data.servicePrice}
              onChange={(e) => updateData({ servicePrice: e.target.value })}
              placeholder="$500"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="planName">Billing Cycle</Label>
            <CustomSelect
              value={data.planName}
              onValueChange={(value) => updateData({ planName: value })}
              options={[
                { value: 'monthly', label: 'Monthly' },
                { value: 'quarterly', label: 'Quarterly' },
                { value: 'annually', label: 'Annually' },
                { value: 'per-ticket', label: 'Per Ticket' }
              ]}
            />
          </div>
        </div>
      </div>

      <div className="rounded-md bg-gray-50 p-4">
        <p className="text-sm text-gray-700">
          <span className="font-semibold">Optional:</span> You can skip this step and configure billing later in your settings.
        </p>
      </div>
    </div>
  );
}