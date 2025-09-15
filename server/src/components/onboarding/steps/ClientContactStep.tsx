'use client';

import React, { useState, useEffect } from 'react';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { StepProps } from '../types';
import { CheckCircle, AlertCircle } from 'lucide-react';
import { validateContactName, validateEmailAddress } from 'server/src/lib/utils/clientFormValidation';

export function ClientContactStep({ data, updateData }: StepProps) {
  const hasClientInfo = !!(data.clientName || data.clientEmail || data.clientPhone || data.clientUrl || data.clientId);
  const isContactCreated = !!data.contactId;
  const [nameError, setNameError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [hasInteractedWithName, setHasInteractedWithName] = useState(false);
  const [hasInteractedWithEmail, setHasInteractedWithEmail] = useState(false);
  const [hasInteractedWithRole, setHasInteractedWithRole] = useState(false);

  // Contact name validation - enterprise grade
  useEffect(() => {
    if (!hasInteractedWithName) {
      setNameError(null);
      return;
    }

    const error = validateContactName(data.contactName || '');
    setNameError(error);
  }, [data.contactName, hasInteractedWithName]);

  // Email validation - enterprise grade
  useEffect(() => {
    if (!hasInteractedWithEmail) {
      setEmailError(null);
      return;
    }

    // Immediate check for spaces-only input
    if (data.contactEmail && data.contactEmail.trim() === '') {
      setEmailError('Email address cannot contain only spaces');
      return;
    }

    const error = validateEmailAddress(data.contactEmail || '');
    setEmailError(error);
  }, [data.contactEmail, hasInteractedWithEmail]);

  // Role validation - basic professional validation
  useEffect(() => {
    if (!hasInteractedWithRole) {
      setRoleError(null);
      return;
    }

    if (data.contactRole && data.contactRole.trim() === '') {
      setRoleError('Role cannot contain only spaces');
      return;
    }

    // Basic validation for role/title field
    if (data.contactRole && data.contactRole.trim().length > 0) {
      const trimmedRole = data.contactRole.trim();
      if (trimmedRole.length > 100) {
        setRoleError('Role must be 100 characters or less');
        return;
      }
    }

    setRoleError(null);
  }, [data.contactRole, hasInteractedWithRole]);

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
            value={data.contactName || ''}
            onChange={(e) => {
              updateData({ contactName: e.target.value });
              if (!hasInteractedWithName && e.target.value) {
                setHasInteractedWithName(true);
              }
            }}
            onBlur={() => setHasInteractedWithName(true)}
            placeholder="John Smith"
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
          <Label htmlFor="contactEmail">Contact Email</Label>
          <Input
            id="contactEmail"
            type="email"
            value={data.contactEmail || ''}
            onChange={(e) => {
              updateData({ contactEmail: e.target.value });
              if (!hasInteractedWithEmail && e.target.value) {
                setHasInteractedWithEmail(true);
              }
            }}
            onBlur={() => setHasInteractedWithEmail(true)}
            placeholder="john.smith@example.com"
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
          <Label htmlFor="contactRole">Role/Title</Label>
          <Input
            id="contactRole"
            value={data.contactRole || ''}
            onChange={(e) => {
              updateData({ contactRole: e.target.value });
              if (!hasInteractedWithRole && e.target.value) {
                setHasInteractedWithRole(true);
              }
            }}
            onBlur={() => setHasInteractedWithRole(true)}
            placeholder="IT Manager"
            className={roleError ? 'border-red-500' : ''}
            aria-describedby="role-error"
          />
          {roleError && (
            <div id="role-error" className="flex items-center gap-1.5 text-sm text-red-600">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>{roleError}</span>
            </div>
          )}
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