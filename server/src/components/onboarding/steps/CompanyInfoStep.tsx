'use client';

import React from 'react';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { StepProps } from '../types';

export function CompanyInfoStep({ data, updateData }: StepProps) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Company Information</h2>
        <p className="text-sm text-gray-600">
          Let's start by setting up your company profile.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="firstName">
            First Name <span className="text-red-500">*</span>
          </Label>
          <Input
            id="firstName"
            value={data.firstName}
            onChange={(e) => updateData({ firstName: e.target.value })}
            placeholder="John"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="lastName">
            Last Name <span className="text-red-500">*</span>
          </Label>
          <Input
            id="lastName"
            value={data.lastName}
            onChange={(e) => updateData({ lastName: e.target.value })}
            placeholder="Doe"
            required
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="companyName">
          Company Name <span className="text-red-500">*</span>
        </Label>
        <Input
          id="companyName"
          value={data.companyName}
          onChange={(e) => updateData({ companyName: e.target.value })}
          placeholder="Acme IT Solutions"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">
          Email Address <span className="text-red-500">*</span>
        </Label>
        <Input
          id="email"
          type="email"
          value={data.email}
          onChange={(e) => updateData({ email: e.target.value })}
          placeholder="john@acmeit.com"
          required
        />
        <p className="text-xs text-gray-500">
          This will be used for signing in to your account.
        </p>
      </div>

      <div className="rounded-md bg-blue-50 p-4">
        <p className="text-sm text-blue-800">
          <span className="font-semibold">Note:</span> All fields on this page are required to proceed.
        </p>
      </div>
    </div>
  );
}