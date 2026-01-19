'use client';

import React, { useState, useEffect } from 'react';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Eye, EyeOff, AlertTriangle } from 'lucide-react';
import { StepProps } from '../types';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { validateEmailAddress, validateContactName, validateClientName } from '@alga-psa/validation';

interface ClientInfoStepProps extends StepProps {
  isRevisit?: boolean;
}

export function ClientInfoStep({ data, updateData, isRevisit = false }: ClientInfoStepProps) {
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordStrength, setPasswordStrength] = useState<'weak' | 'medium' | 'strong' | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  
  // Use a local variable for cleaner code
  const password = data.newPassword || '';
  const confirmPassword = data.confirmPassword || '';

  // Password strength validation
  useEffect(() => {
    if (!password) {
      setPasswordStrength(null);
      return;
    }

    const hasLowerCase = /[a-z]/.test(password);
    const hasUpperCase = /[A-Z]/.test(password);
    const hasNumber = /\d/.test(password);
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);
    const isLongEnough = password.length >= 8;

    const score = [hasLowerCase, hasUpperCase, hasNumber, hasSpecialChar, isLongEnough]
      .filter(Boolean).length;

    if (score <= 2) setPasswordStrength('weak');
    else if (score <= 4) setPasswordStrength('medium');
    else setPasswordStrength('strong');
  }, [password]);

  // For returning users, show simplified view
  if (isRevisit) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <h2 className="text-xl font-semibold">Company Information</h2>
          <p className="text-sm text-gray-600">
            Review or update your company details.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="clientName">
            Company Name <span className="text-red-500">*</span>
          </Label>
          <Input
            id="clientName"
            value={data.clientName}
            onChange={(e) => updateData({ clientName: e.target.value })}
            placeholder="Acme IT Solutions"
            required
          />
        </div>

        <Alert variant="info">
          <AlertDescription>
            <span className="font-semibold">Note:</span> You can use this wizard to reconfigure your workspace settings at any time.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // For first-time users, show full form
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Client Information</h2>
        <p className="text-sm text-gray-600">
          Let's start by setting up your client profile.
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
        <Label htmlFor="clientName">
          Client Name <span className="text-red-500">*</span>
        </Label>
        <Input
          id="clientName"
          value={data.clientName}
          onChange={(e) => updateData({ clientName: e.target.value })}
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
          onChange={(e) => {
            updateData({ email: e.target.value });
            // Clear error when user starts typing
            if (fieldErrors.email) {
              setFieldErrors(prev => ({ ...prev, email: '' }));
            }
          }}
          onBlur={() => {
            const error = validateEmailAddress(data.email || '');
            setFieldErrors(prev => ({ ...prev, email: error || '' }));
          }}
          placeholder="john@acmeit.com"
          required
          disabled
          className={fieldErrors.email ? 'border-red-500' : ''}
        />
        {fieldErrors.email && (
          <p className="text-sm text-red-600 mt-1">{fieldErrors.email}</p>
        )}
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
              value={password}
              onChange={(e) => updateData({ newPassword: e.target.value })}
              placeholder="Create a strong password"
              required
              autoComplete="new-password"
              className="pr-10"
              aria-describedby="password-requirements"
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

          <div id="password-requirements" className="text-sm mt-1">
            <p className="text-gray-500">Password must contain:</p>
            <ul className="list-disc list-inside space-y-1">
              <li className={password.length >= 8 ? 'text-green-500' : 'text-gray-500'}>
                At least 8 characters
              </li>
              <li className={/[A-Z]/.test(password) ? 'text-green-500' : 'text-gray-500'}>
                One uppercase letter
              </li>
              <li className={/[a-z]/.test(password) ? 'text-green-500' : 'text-gray-500'}>
                One lowercase letter
              </li>
              <li className={/\d/.test(password) ? 'text-green-500' : 'text-gray-500'}>
                One number
              </li>
              <li className={/[!@#$%^&*(),.?":{}|<>]/.test(password) ? 'text-green-500' : 'text-gray-500'}>
                One special character
              </li>
            </ul>
            {passwordStrength && (
              <p className={`mt-2 font-medium ${
                passwordStrength === 'strong' ? 'text-green-600' :
                passwordStrength === 'medium' ? 'text-yellow-600' :
                'text-red-600'
              }`}>
                Password strength: {passwordStrength.charAt(0).toUpperCase() + passwordStrength.slice(1)}
              </p>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirmPassword">
            Confirm Password <span className="text-red-500">*</span>
          </Label>
          <div className="relative">
            <Input
              id="confirmPassword"
              type={showConfirmPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => updateData({ confirmPassword: e.target.value })}
              placeholder="Re-enter your password"
              required
              autoComplete="new-password"
              className={`pr-10 ${
                confirmPassword && password &&
                confirmPassword !== password ? 'border-red-500' : ''
              }`}
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
          {confirmPassword && password && (
            <p className={`text-sm ${
              confirmPassword === password ? 'text-green-500' : 'text-red-500'
            }`}>
              {confirmPassword === password ? 'Passwords match' : 'Passwords do not match'}
            </p>
          )}
        </div>
      </div>

      <Alert variant="info">
        <AlertDescription>
          <span className="font-semibold">Note:</span> All fields on this page are required to proceed.
        </AlertDescription>
      </Alert>
    </div>
  );
}