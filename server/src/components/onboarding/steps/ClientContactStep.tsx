'use client';

import React from 'react';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { StepProps } from '../types';
import { CheckCircle } from 'lucide-react';

export function ClientContactStep({ data, updateData }: StepProps) {
  const hasClientInfo = !!(data.clientName || data.clientEmail || data.clientPhone || data.clientUrl || data.clientId);
  const isContactCreated = !!data.contactId;

  if (!hasClientInfo) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <h2 className="text-xl font-semibold">Client Contact</h2>
          <p className="text-sm text-gray-600">
            No client information was provided. Skip this step or go back to add a client first.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Add Contact for {data.clientName || 'Client'}</h2>
        <p className="text-sm text-gray-600">
          Add a primary contact person for this client.
        </p>
      </div>

      {isContactCreated && (
        <div className="rounded-md bg-green-50 border border-green-200 p-4 flex items-center gap-3">
          <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-green-800">Contact created successfully!</p>
            <p className="text-sm text-green-600 mt-1">
              <span className="font-semibold">{data.contactName || 'The contact'}</span> has been added to <span className="font-semibold">{data.clientName || 'the client'}</span>.
            </p>
          </div>
        </div>
      )}

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="contactName">Contact Name</Label>
          <Input
            id="contactName"
            value={data.contactName}
            onChange={(e) => updateData({ contactName: e.target.value })}
            placeholder="John Smith"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="contactEmail">Contact Email</Label>
          <Input
            id="contactEmail"
            type="email"
            value={data.contactEmail}
            onChange={(e) => updateData({ contactEmail: e.target.value })}
            placeholder="john.smith@example.com"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="contactRole">Role/Title</Label>
          <Input
            id="contactRole"
            value={data.contactRole}
            onChange={(e) => updateData({ contactRole: e.target.value })}
            placeholder="IT Manager"
          />
        </div>
      </div>

      <div className="rounded-md bg-blue-50 p-4 space-y-2">
        <p className="text-sm text-blue-700">
          <span className="font-semibold">Optional:</span> You can skip this step and add contacts later from the client's profile.
        </p>
      </div>
    </div>
  );
}