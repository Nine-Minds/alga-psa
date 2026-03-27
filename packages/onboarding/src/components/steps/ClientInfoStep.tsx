'use client';

// Onboarding step: initial MSP + client identity capture.

import React, { useState, useEffect } from 'react';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Eye, EyeOff } from 'lucide-react';
import type { StepProps } from '@alga-psa/types';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { validateEmailAddress } from '@alga-psa/validation';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface ClientInfoStepProps extends StepProps {
  isRevisit?: boolean;
}

export function ClientInfoStep({ data, updateData, isRevisit = false }: ClientInfoStepProps) {
  const { t } = useTranslation('msp/onboarding');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordStrength, setPasswordStrength] = useState<'weak' | 'medium' | 'strong' | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  
  // Use a local variable for cleaner code
  const password = data.newPassword || '';
  const confirmPassword = data.confirmPassword || '';

  const translateEmailValidationMessage = (message: string | null) => {
    if (!message) return '';

    const validationMessages: Record<string, { key: string; defaultValue: string }> = {
      'Email address is required': {
        key: 'clientInfoStep.validation.email.required',
        defaultValue: 'Email address is required'
      },
      'Email address cannot contain only spaces': {
        key: 'clientInfoStep.validation.email.spacesOnly',
        defaultValue: 'Email address cannot contain only spaces'
      },
      'Email address cannot contain emojis': {
        key: 'clientInfoStep.validation.email.noEmoji',
        defaultValue: 'Email address cannot contain emojis'
      },
      'Please enter a valid email address': {
        key: 'clientInfoStep.validation.email.invalid',
        defaultValue: 'Please enter a valid email address'
      },
      'Please use a permanent business email address': {
        key: 'clientInfoStep.validation.email.permanentBusiness',
        defaultValue: 'Please use a permanent business email address'
      },
      'Please enter a valid business email address': {
        key: 'clientInfoStep.validation.email.business',
        defaultValue: 'Please enter a valid business email address'
      },
      'Please enter a valid email domain': {
        key: 'clientInfoStep.validation.email.domain',
        defaultValue: 'Please enter a valid email domain'
      }
    };

    const translation = validationMessages[message];
    return translation ? t(translation.key, { defaultValue: translation.defaultValue }) : message;
  };

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
          <h2 className="text-xl font-semibold">
            {t('clientInfoStep.revisit.title', {
              defaultValue: 'Company Information'
            })}
          </h2>
          <p className="text-sm text-gray-600">
            {t('clientInfoStep.revisit.description', {
              defaultValue: 'Review or update your company details.'
            })}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="clientName">
            {t('clientInfoStep.revisit.fields.companyName.label', {
              defaultValue: 'Company Name'
            })} <span className="text-red-500">*</span>
          </Label>
          <Input
            id="clientName"
            value={data.clientName}
            onChange={(e) => updateData({ clientName: e.target.value })}
            placeholder={t('clientInfoStep.revisit.fields.companyName.placeholder', {
              defaultValue: 'Acme IT Solutions'
            })}
            required
          />
        </div>

        <Alert variant="info">
          <AlertDescription>
            <span className="font-semibold">
              {t('clientInfoStep.common.noteLabel', {
                defaultValue: 'Note:'
              })}
            </span>{' '}
            {t('clientInfoStep.revisit.note', {
              defaultValue: 'You can use this wizard to reconfigure your workspace settings at any time.'
            })}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // For first-time users, show full form
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">
          {t('clientInfoStep.header.title', {
            defaultValue: 'Client Information'
          })}
        </h2>
        <p className="text-sm text-gray-600">
          {t('clientInfoStep.header.description', {
            defaultValue: 'Let\'s start by setting up your client profile.'
          })}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="firstName">
            {t('clientInfoStep.fields.firstName.label', {
              defaultValue: 'First Name'
            })} <span className="text-red-500">*</span>
          </Label>
          <Input
            id="firstName"
            value={data.firstName}
            onChange={(e) => updateData({ firstName: e.target.value })}
            placeholder={t('clientInfoStep.fields.firstName.placeholder', {
              defaultValue: 'John'
            })}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="lastName">
            {t('clientInfoStep.fields.lastName.label', {
              defaultValue: 'Last Name'
            })} <span className="text-red-500">*</span>
          </Label>
          <Input
            id="lastName"
            value={data.lastName}
            onChange={(e) => updateData({ lastName: e.target.value })}
            placeholder={t('clientInfoStep.fields.lastName.placeholder', {
              defaultValue: 'Doe'
            })}
            required
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="clientName">
          {t('clientInfoStep.fields.clientName.label', {
            defaultValue: 'Client Name'
          })} <span className="text-red-500">*</span>
        </Label>
        <Input
          id="clientName"
          value={data.clientName}
          onChange={(e) => updateData({ clientName: e.target.value })}
          placeholder={t('clientInfoStep.fields.clientName.placeholder', {
            defaultValue: 'Acme IT Solutions'
          })}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">
          {t('clientInfoStep.fields.email.label', {
            defaultValue: 'Email Address'
          })} <span className="text-red-500">*</span>
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
            setFieldErrors(prev => ({ ...prev, email: translateEmailValidationMessage(error) }));
          }}
          placeholder={t('clientInfoStep.fields.email.placeholder', {
            defaultValue: 'john@acmeit.com'
          })}
          required
          disabled
          className={fieldErrors.email ? 'border-red-500' : ''}
        />
        {fieldErrors.email && (
          <p className="text-sm text-red-600 mt-1">{fieldErrors.email}</p>
        )}
        <p className="text-xs text-gray-500">
          {t('clientInfoStep.fields.email.help', {
            defaultValue: 'This will be used for signing in to your account.'
          })}
        </p>
      </div>

      <div className="space-y-4 pt-4 border-t">
        <Alert variant="warning" className="mb-4">
          <AlertDescription>
            <p className="font-semibold">
              {t('clientInfoStep.password.resetRequired.title', {
                defaultValue: 'Password Reset Required'
              })}
            </p>
            <p className="mt-1 text-sm">
              {t('clientInfoStep.password.resetRequired.description', {
                defaultValue: 'You must set a new password to continue with the setup process. This step cannot be skipped.'
              })}
            </p>
          </AlertDescription>
        </Alert>

        <div className="space-y-2">
          <h3 className="text-lg font-medium">
            {t('clientInfoStep.password.title', {
              defaultValue: 'Set Your Password'
            })}
          </h3>
          <p className="text-sm text-gray-600">
            {t('clientInfoStep.password.description', {
              defaultValue: 'Please set a new password to replace your temporary password.'
            })}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="newPassword">
            {t('clientInfoStep.password.fields.newPassword.label', {
              defaultValue: 'New Password'
            })} <span className="text-red-500">*</span>
          </Label>
          <div className="relative">
            <Input
              id="newPassword"
              type={showNewPassword ? "text" : "password"}
              value={password}
              onChange={(e) => updateData({ newPassword: e.target.value })}
              placeholder={t('clientInfoStep.password.fields.newPassword.placeholder', {
                defaultValue: 'Create a strong password'
              })}
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
            <p className="text-gray-500">
              {t('clientInfoStep.password.requirements.title', {
                defaultValue: 'Password must contain:'
              })}
            </p>
            <ul className="list-disc list-inside space-y-1">
              <li className={password.length >= 8 ? 'text-green-500' : 'text-gray-500'}>
                {t('clientInfoStep.password.requirements.minLength', {
                  defaultValue: 'At least 8 characters'
                })}
              </li>
              <li className={/[A-Z]/.test(password) ? 'text-green-500' : 'text-gray-500'}>
                {t('clientInfoStep.password.requirements.uppercase', {
                  defaultValue: 'One uppercase letter'
                })}
              </li>
              <li className={/[a-z]/.test(password) ? 'text-green-500' : 'text-gray-500'}>
                {t('clientInfoStep.password.requirements.lowercase', {
                  defaultValue: 'One lowercase letter'
                })}
              </li>
              <li className={/\d/.test(password) ? 'text-green-500' : 'text-gray-500'}>
                {t('clientInfoStep.password.requirements.number', {
                  defaultValue: 'One number'
                })}
              </li>
              <li className={/[!@#$%^&*(),.?":{}|<>]/.test(password) ? 'text-green-500' : 'text-gray-500'}>
                {t('clientInfoStep.password.requirements.specialCharacter', {
                  defaultValue: 'One special character'
                })}
              </li>
            </ul>
            {passwordStrength && (
              <p className={`mt-2 font-medium ${
                passwordStrength === 'strong' ? 'text-green-600' :
                passwordStrength === 'medium' ? 'text-yellow-600' :
                'text-red-600'
              }`}>
                {t('clientInfoStep.password.strength.label', {
                  defaultValue: 'Password strength: {{strength}}',
                  strength:
                    passwordStrength === 'strong'
                      ? t('clientInfoStep.password.strength.strong', { defaultValue: 'Strong' })
                      : passwordStrength === 'medium'
                        ? t('clientInfoStep.password.strength.medium', { defaultValue: 'Medium' })
                        : t('clientInfoStep.password.strength.weak', { defaultValue: 'Weak' })
                })}
              </p>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirmPassword">
            {t('clientInfoStep.password.fields.confirmPassword.label', {
              defaultValue: 'Confirm Password'
            })} <span className="text-red-500">*</span>
          </Label>
          <div className="relative">
            <Input
              id="confirmPassword"
              type={showConfirmPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => updateData({ confirmPassword: e.target.value })}
              placeholder={t('clientInfoStep.password.fields.confirmPassword.placeholder', {
                defaultValue: 'Re-enter your password'
              })}
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
              {confirmPassword === password
                ? t('clientInfoStep.password.fields.confirmPassword.match', {
                    defaultValue: 'Passwords match'
                  })
                : t('clientInfoStep.password.fields.confirmPassword.mismatch', {
                    defaultValue: 'Passwords do not match'
                  })}
            </p>
          )}
        </div>
      </div>

      <Alert variant="info">
        <AlertDescription>
          <span className="font-semibold">
            {t('clientInfoStep.common.noteLabel', {
              defaultValue: 'Note:'
            })}
          </span>{' '}
          {t('clientInfoStep.footer.note', {
            defaultValue: 'All fields on this page are required to proceed.'
          })}
        </AlertDescription>
      </Alert>
    </div>
  );
}
