'use client';

import React, { useState, useEffect } from 'react';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { StepProps } from '../types';
import { CheckCircle, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';

export function AddClientStep({ data, updateData }: StepProps) {
  const isClientCreated = !!data.clientId;
  const [emailError, setEmailError] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [hasInteractedWithEmail, setHasInteractedWithEmail] = useState(false);
  const [hasInteractedWithUrl, setHasInteractedWithUrl] = useState(false);
  const [hasInteractedWithPhone, setHasInteractedWithPhone] = useState(false);

  // Email validation
  useEffect(() => {
    if (!hasInteractedWithEmail || !data.clientEmail) {
      setEmailError(null);
      return;
    }

    const email = data.clientEmail.trim();
    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        setEmailError('Please enter a valid email address');
      } else {
        setEmailError(null);
      }
    }
  }, [data.clientEmail, hasInteractedWithEmail]);

  // URL validation - simplified
  useEffect(() => {
    if (!hasInteractedWithUrl || !data.clientUrl) {
      setUrlError(null);
      return;
    }

    const url = data.clientUrl.trim();
    if (url) {
      // Simple validation: must contain a dot and look like a domain
      // Accepts: example.com, www.example.com, https://example.com, subdomain.example.co.uk
      const urlPattern = /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,})([\/\w \.-]*)*\/?$/i;
      
      if (!url.includes('.')) {
        setUrlError('Please enter a valid website (e.g., example.com)');
      } else if (!urlPattern.test(url)) {
        setUrlError('Please enter a valid website format');
      } else {
        setUrlError(null);
      }
    }
  }, [data.clientUrl, hasInteractedWithUrl]);

  // Phone validation - light validation
  useEffect(() => {
    if (!hasInteractedWithPhone || !data.clientPhone) {
      setPhoneError(null);
      return;
    }

    const phone = data.clientPhone.trim();
    if (phone) {
      // Remove common formatting characters but keep letters and numbers
      const cleanedPhone = phone.replace(/[\s\-\(\)\+\.]/g, '');
      
      // Check length (7-20 characters to accommodate letters)
      if (cleanedPhone.length < 7) {
        setPhoneError('Phone number seems too short');
      } else if (cleanedPhone.length > 20) {
        setPhoneError('Phone number seems too long');
      } else if (!/^[a-zA-Z0-9]+$/.test(cleanedPhone)) {
        // Only allow letters and numbers after removing formatting
        setPhoneError('Phone number contains invalid characters');
      } else {
        setPhoneError(null);
      }
    }
  }, [data.clientPhone, hasInteractedWithPhone]);

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
            onBlur={() => {
              // Only validate if there's actual content to check for spaces-only
              if (data.clientName && data.clientName.trim() === '') {
                // This would be handled by the validation logic if implemented
              }
            }}
            placeholder="Example Corp"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="clientEmail">Client Email</Label>
          <Input
            id="clientEmail"
            type="email"
            value={data.clientEmail}
            onChange={(e) => {
              updateData({ clientEmail: e.target.value });
              if (!hasInteractedWithEmail && e.target.value) {
                setHasInteractedWithEmail(true);
              }
            }}
            onBlur={() => setHasInteractedWithEmail(true)}
            placeholder="contact@example.com"
            className={emailError ? 'border-red-500' : ''}
            aria-describedby="email-error"
          />
          {emailError && (
            <div id="email-error" className="flex items-center gap-1.5 text-sm text-red-600">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>{emailError}</span>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="clientPhone">Phone Number</Label>
          <Input
            id="clientPhone"
            value={data.clientPhone}
            onChange={(e) => {
              updateData({ clientPhone: e.target.value });
              if (!hasInteractedWithPhone && e.target.value) {
                setHasInteractedWithPhone(true);
              }
            }}
            onBlur={() => setHasInteractedWithPhone(true)}
            placeholder="+1 (555) 123-4567"
            className={phoneError ? 'border-red-500' : ''}
            aria-describedby="phone-error"
          />
          {phoneError && (
            <div id="phone-error" className="flex items-center gap-1.5 text-sm text-red-600">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>{phoneError}</span>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="clientUrl">Website</Label>
          <Input
            id="clientUrl"
            value={data.clientUrl}
            onChange={(e) => {
              updateData({ clientUrl: e.target.value });
              if (!hasInteractedWithUrl && e.target.value) {
                setHasInteractedWithUrl(true);
              }
            }}
            onBlur={() => setHasInteractedWithUrl(true)}
            placeholder="https://example.com"
            className={urlError ? 'border-red-500' : ''}
            aria-describedby="url-error"
          />
          {urlError && (
            <div id="url-error" className="flex items-center gap-1.5 text-sm text-red-600">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>{urlError}</span>
            </div>
          )}
        </div>
      </div>

      {!isClientCreated && (
        <Alert variant="info">
          <AlertDescription className="space-y-2">
            <p>
              <span className="font-semibold">Note:</span> The client will be created with default non-taxable (0%) tax settings. You can configure tax rates later in the client settings.
            </p>
            <p>
              <span className="font-semibold">Optional:</span> You can skip this step and add clients later from your dashboard.
            </p>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}