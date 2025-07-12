'use client';

import React from 'react';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { StepProps } from '../types';
import { CheckCircle } from 'lucide-react';

export function AddClientStep({ data, updateData }: StepProps) {
  const isClientCreated = !!data.clientId;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Add Your First Client</h2>
        <p className="text-sm text-gray-600">
          Let's add your first client to get started. You can skip this and add clients later.
        </p>
      </div>

      {isClientCreated && (
        <div className="rounded-md bg-green-50 border border-green-200 p-4 flex items-center gap-3">
          <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-green-800">Client created successfully!</p>
            <p className="text-sm text-green-600 mt-1">
              <span className="font-semibold">{data.clientName}</span> has been added to your client list.
            </p>
          </div>
        </div>
      )}

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="clientName">Client Name</Label>
          <Input
            id="clientName"
            value={data.clientName}
            onChange={(e) => updateData({ clientName: e.target.value })}
            placeholder="Example Corp"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="clientEmail">Client Email</Label>
          <Input
            id="clientEmail"
            type="email"
            value={data.clientEmail}
            onChange={(e) => updateData({ clientEmail: e.target.value })}
            placeholder="contact@example.com"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="clientPhone">Phone Number</Label>
          <Input
            id="clientPhone"
            value={data.clientPhone}
            onChange={(e) => updateData({ clientPhone: e.target.value })}
            placeholder="+1 (555) 123-4567"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="clientUrl">Website</Label>
          <Input
            id="clientUrl"
            value={data.clientUrl}
            onChange={(e) => updateData({ clientUrl: e.target.value })}
            placeholder="https://example.com"
          />
        </div>
      </div>

      <div className="rounded-md bg-gray-50 p-4">
        <p className="text-sm text-gray-700">
          <span className="font-semibold">Optional:</span> You can skip this step and add clients later from your dashboard.
        </p>
      </div>
    </div>
  );
}