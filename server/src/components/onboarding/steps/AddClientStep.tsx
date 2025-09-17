'use client';

import React, { useState, useEffect } from 'react';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { StepProps } from '../types';
import { CheckCircle, AlertCircle } from 'lucide-react';
import { validateCompanyName, validateEmailAddress, validateWebsiteUrl, validatePhoneNumber } from 'server/src/lib/utils/clientFormValidation';

export function AddClientStep({ data, updateData }: StepProps) {
  const isClientCreated = !!data.clientId;
  const [nameError, setNameError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [hasInteractedWithName, setHasInteractedWithName] = useState(false);
  const [hasInteractedWithEmail, setHasInteractedWithEmail] = useState(false);
  const [hasInteractedWithUrl, setHasInteractedWithUrl] = useState(false);
  const [hasInteractedWithPhone, setHasInteractedWithPhone] = useState(false);

  // Company name validation - enterprise grade
  useEffect(() => {
    if (!hasInteractedWithName) {
      setNameError(null);
      return;
    }

    const error = validateCompanyName(data.clientName || '');
    setNameError(error);
  }, [data.clientName, hasInteractedWithName]);

  // Email validation - enterprise grade
  useEffect(() => {
    if (!hasInteractedWithEmail) {
      setEmailError(null);
      return;
    }

    // Immediate check for spaces-only input
    if (data.clientEmail && data.clientEmail.trim() === '') {
      setEmailError('Email address cannot contain only spaces');
      return;
    }

    const error = validateEmailAddress(data.clientEmail || '');
    setEmailError(error);
  }, [data.clientEmail, hasInteractedWithEmail]);

  // URL validation - enterprise grade
  useEffect(() => {
    if (!hasInteractedWithUrl) {
      setUrlError(null);
      return;
    }

    const error = validateWebsiteUrl(data.clientUrl || '');
    setUrlError(error);
  }, [data.clientUrl, hasInteractedWithUrl]);

  // Phone validation - enterprise grade
  useEffect(() => {
    if (!hasInteractedWithPhone) {
      setPhoneError(null);
      return;
    }

    const error = validatePhoneNumber(data.clientPhone || '');
    setPhoneError(error);
  }, [data.clientPhone, hasInteractedWithPhone]);

  // Check if form is valid for submit button
  const isFormValid = (): boolean => {
    // Company name is required
    if (!data.clientName || !data.clientName.trim()) {
      return false;
    }

    // Check for validation errors
    if (nameError || emailError || urlError || phoneError) {
      return false;
    }

    // Validate all fields that have content
    if (data.clientName && validateCompanyName(data.clientName)) {
      return false;
    }

    if (data.clientEmail && validateEmailAddress(data.clientEmail)) {
      return false;
    }

    if (data.clientUrl && validateWebsiteUrl(data.clientUrl)) {
      return false;
    }

    if (data.clientPhone && validatePhoneNumber(data.clientPhone)) {
      return false;
    }

    return true;
  };

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
          <Label htmlFor="clientName">Client Name *</Label>
          <Input
            id="clientName"
            value={data.clientName || ''}
            onChange={(e) => {
              updateData({ clientName: e.target.value });
              if (!hasInteractedWithName && e.target.value) {
                setHasInteractedWithName(true);
              }
            }}
            onBlur={() => setHasInteractedWithName(true)}
            placeholder="Example Corp"
            className={nameError ? 'border-red-500' : ''}
            aria-describedby="name-error"
          />
          {nameError && (
            <div id="name-error" className="flex items-center gap-1.5 text-sm text-red-600">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>{nameError}</span>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="clientEmail">Client Email</Label>
          <Input
            id="clientEmail"
            type="email"
            value={data.clientEmail || ''}
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
            value={data.clientPhone || ''}
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
            value={data.clientUrl || ''}
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
        <div className="rounded-md bg-blue-50 p-4 space-y-2">
          <p className="text-sm text-blue-800">
            <span className="font-semibold">Note:</span> The client will be created with default non-taxable (0%) tax settings. You can configure tax rates later in the company settings.
          </p>
          <p className="text-sm text-blue-800">
            <span className="font-semibold">Optional:</span> You can skip this step and add clients later from your dashboard.
          </p>
          <p className="text-sm text-blue-600 mt-2">
            <span className="font-semibold">Form Status:</span> {isFormValid() ? 'Ready to submit' : 'Please complete required fields with valid data'}
          </p>
        </div>
      )}
    </div>
  );
}