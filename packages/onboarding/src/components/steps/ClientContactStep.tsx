'use client';

// Onboarding step: add primary client contact.

import React, { useState, useEffect } from 'react';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import type { StepProps } from '@alga-psa/types';
import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export function ClientContactStep({ data, updateData }: StepProps) {
  const { t } = useTranslation('msp/onboarding');
  const hasClientInfo = !!(data.clientName || data.clientEmail || data.clientPhone || data.clientUrl || data.clientId);
  const isContactCreated = !!data.contactId;
  const [emailError, setEmailError] = useState<string | null>(null);
  const [hasInteractedWithEmail, setHasInteractedWithEmail] = useState(false);

  // Email validation
  useEffect(() => {
    if (!hasInteractedWithEmail || !data.contactEmail) {
      setEmailError(null);
      return;
    }

    const email = data.contactEmail.trim();
    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        setEmailError(t('clientContactStep.validation.email.invalid', {
          defaultValue: 'Please enter a valid email address'
        }));
      } else {
        setEmailError(null);
      }
    }
  }, [data.contactEmail, hasInteractedWithEmail, t]);

  if (!hasClientInfo) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <h2 className="text-xl font-semibold">
            {t('clientContactStep.empty.title', {
              defaultValue: 'Client Contact'
            })}
          </h2>
          <p className="text-sm text-gray-600">
            {t('clientContactStep.empty.description', {
              defaultValue: 'No client information was provided. Skip this step or go back to add a client first.'
            })}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">
          {t('clientContactStep.header.title', {
            defaultValue: 'Add Contact for {{clientName}}',
            clientName: data.clientName || t('clientContactStep.header.clientFallback', {
              defaultValue: 'Client'
            })
          })}
        </h2>
        <p className="text-sm text-gray-600">
          {t('clientContactStep.header.description', {
            defaultValue: 'Add a primary contact person for this client.'
          })}
        </p>
      </div>

      {isContactCreated && (
        <Alert variant="success">
          <AlertDescription>
            <p className="font-medium">
              {t('clientContactStep.created.title', {
                defaultValue: 'Contact created successfully!'
              })}
            </p>
            <p className="text-sm mt-1">
              {t('clientContactStep.created.description', {
                defaultValue: '{{contactName}} has been added to {{clientName}}.',
                contactName: data.contactName || t('clientContactStep.created.contactFallback', {
                  defaultValue: 'The contact'
                }),
                clientName: data.clientName || t('clientContactStep.created.clientFallback', {
                  defaultValue: 'the client'
                })
              })}
            </p>
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="contactName">
            {t('clientContactStep.fields.contactName.label', {
              defaultValue: 'Contact Name'
            })}
          </Label>
          <Input
            id="contactName"
            value={data.contactName}
            onChange={(e) => updateData({ contactName: e.target.value })}
            placeholder={t('clientContactStep.fields.contactName.placeholder', {
              defaultValue: 'John Smith'
            })}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="contactEmail">
            {t('clientContactStep.fields.contactEmail.label', {
              defaultValue: 'Contact Email'
            })}
          </Label>
          <Input
            id="contactEmail"
            type="email"
            value={data.contactEmail}
            onChange={(e) => {
              updateData({ contactEmail: e.target.value });
              if (!hasInteractedWithEmail && e.target.value) {
                setHasInteractedWithEmail(true);
              }
            }}
            onBlur={() => setHasInteractedWithEmail(true)}
            placeholder={t('clientContactStep.fields.contactEmail.placeholder', {
              defaultValue: 'john.smith@example.com'
            })}
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
          <Label htmlFor="contactRole">
            {t('clientContactStep.fields.contactRole.label', {
              defaultValue: 'Role/Title'
            })}
          </Label>
          <Input
            id="contactRole"
            value={data.contactRole}
            onChange={(e) => updateData({ contactRole: e.target.value })}
            placeholder={t('clientContactStep.fields.contactRole.placeholder', {
              defaultValue: 'IT Manager'
            })}
          />
        </div>
      </div>

      <Alert variant="info">
        <AlertDescription>
          <span className="font-semibold">
            {t('clientContactStep.common.optionalLabel', {
              defaultValue: 'Optional:'
            })}
          </span>{' '}
          {t('clientContactStep.footer.optional', {
            defaultValue: 'You can skip this step and add contacts later from the client\'s profile.'
          })}
        </AlertDescription>
      </Alert>
    </div>
  );
}
