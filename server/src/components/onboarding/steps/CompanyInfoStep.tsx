'use client';

import React, { useState } from 'react';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { Eye, EyeOff, AlertTriangle } from 'lucide-react';
import { StepProps } from '../types';

export function CompanyInfoStep({ data, updateData }: StepProps) {
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

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

      <div className="space-y-4 pt-4 border-t">
        <div className="rounded-md bg-amber-50 border border-amber-200 p-4 mb-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <AlertTriangle className="h-5 w-5 text-amber-400" />
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-semibold text-amber-800">
                Password Reset Required
              </h3>
              <div className="mt-1 text-sm text-amber-700">
                <p>You must set a new password to continue with the setup process. This step cannot be skipped.</p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="space-y-2">
          <h3 className="text-lg font-medium">Set Your Password</h3>
          <p className="text-sm text-gray-600">
            Please set a new password to replace your temporary password.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="newPassword">
            New Password <span className="text-red-500">*</span>
          </Label>
          <div className="relative">
            <Input
              id="newPassword"
              type={showNewPassword ? "text" : "password"}
              value={data.newPassword || ''}
              onChange={(e) => updateData({ newPassword: e.target.value })}
              placeholder="Enter your new password"
              required
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowNewPassword(!showNewPassword)}
              className="absolute inset-y-0 right-0 pr-3 flex items-center"
            >
              {showNewPassword ? (
                <EyeOff className="h-4 w-4 text-gray-400" />
              ) : (
                <Eye className="h-4 w-4 text-gray-400" />
              )}
            </button>
          </div>
          <p className="text-xs text-gray-500">
            Must be at least 8 characters long.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirmPassword">
            Confirm Password <span className="text-red-500">*</span>
          </Label>
          <div className="relative">
            <Input
              id="confirmPassword"
              type={showConfirmPassword ? "text" : "password"}
              value={data.confirmPassword || ''}
              onChange={(e) => updateData({ confirmPassword: e.target.value })}
              placeholder="Confirm your new password"
              required
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className="absolute inset-y-0 right-0 pr-3 flex items-center"
            >
              {showConfirmPassword ? (
                <EyeOff className="h-4 w-4 text-gray-400" />
              ) : (
                <Eye className="h-4 w-4 text-gray-400" />
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-md bg-blue-50 p-4">
        <p className="text-sm text-blue-800">
          <span className="font-semibold">Note:</span> All fields on this page are required to proceed.
        </p>
      </div>
    </div>
  );
}