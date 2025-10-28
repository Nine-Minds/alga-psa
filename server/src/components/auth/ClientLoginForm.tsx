'use client'

import { signIn } from 'next-auth/react';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { Eye, EyeOff } from 'lucide-react';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRegisterUIComponent } from '../../types/ui-reflection/useRegisterUIComponent';
import { FormComponent, FormFieldComponent, ButtonComponent } from '../../types/ui-reflection/types';
import { withDataAutomationId } from '../../types/ui-reflection/withDataAutomationId';
import { useTranslation } from 'server/src/lib/i18n/client';

interface ClientLoginFormProps {
  callbackUrl: string;
  onError: (error: string) => void;
  onTwoFactorRequired: () => void;
  tenantSlug?: string;
}

export default function ClientLoginForm({ callbackUrl, onError, onTwoFactorRequired, tenantSlug }: ClientLoginFormProps) {
  const { t } = useTranslation('clientPortal');
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false);

  // Register the form component
  const updateForm = useRegisterUIComponent<FormComponent>({
    id: 'client-login-form',
    type: 'form',
    label: 'Client Login'
  });

  // Register email field as child of form
  const updateEmailField = useRegisterUIComponent<FormFieldComponent>({
    id: 'client-email-field',
    type: 'formField',
    fieldType: 'textField',
    label: t('auth.email', 'Email'),
    value: email,
    required: true,
    parentId: 'client-login-form'
  });

  // Register password field as child of form
  const updatePasswordField = useRegisterUIComponent<FormFieldComponent>({
    id: 'client-password-field',
    type: 'formField',
    fieldType: 'textField',
    label: t('auth.password', 'Password'),
    value: password,
    required: true,
    parentId: 'client-login-form'
  });

  // Register sign in button as child of form
  const updateSignInButton = useRegisterUIComponent<ButtonComponent>({
    id: 'client-sign-in-button',
    type: 'button',
    label: isLoading ? t('auth.signingIn', 'Signing in...') : t('auth.signIn', 'Sign In'),
    disabled: isLoading,
    parentId: 'client-login-form'
  });



  // Update field values when they change
  useEffect(() => {
    updateEmailField({ value: email });
    updatePasswordField({ value: password });
    updateSignInButton({ 
      label: isLoading ? t('auth.signingIn', 'Signing in...') : t('auth.signIn', 'Sign In'),
      disabled: isLoading 
    });
  }, [email, password, isLoading, updateEmailField, updatePasswordField, updateSignInButton]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true)

    try {
      const signInPayload: Record<string, unknown> = {
        email,
        password,
        userType: 'client',
        redirect: false,
        callbackUrl,
      };

      if (tenantSlug) {
        signInPayload.tenant = tenantSlug;
      }

      const result = (await signIn('credentials', signInPayload)) as unknown as { error?: string; url?: string } | null

      if (result?.error) {
        if (result.error === '2FA_REQUIRED') {
          onTwoFactorRequired();
        } else {
          onError(t('auth.invalidCredentials', 'Invalid email or password'))
        }
      } else if (result?.url) {
        if (process.env.NODE_ENV !== 'production') {
          console.log('[client-login-form] navigating to', result.url);
        }
        window.location.href = result.url
      }
    } catch (error) {
      onError(t('auth.loginError', 'An error occurred during login'))
      console.error('Login error:', error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <form 
      onSubmit={onSubmit} 
      method="POST"
      className="space-y-4" 
      {...withDataAutomationId({ id: 'client-login-form' })}
    >
      <div className="space-y-2">
        <Label htmlFor="client-email-field">{t('auth.email', 'Email')}</Label>
        {tenantSlug ? (
          <input type="hidden" id="client-tenant-slug" name="tenant" value={tenantSlug} />
        ) : null}
        <Input
          id="client-email-field"
          name="email"
          type="email"
          placeholder={t('auth.emailPlaceholder', 'Enter your email')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={isLoading}
          required
          className="w-full"
          autoComplete="email"
        />
      </div>

      <div className="space-y-2 relative">
        <Label htmlFor="client-password-field">{t('auth.password', 'Password')}</Label>
        <div className="relative">
          <Input
            id="client-password-field"
            name="password"
            type={showPassword ? "text" : "password"}
            placeholder={t('auth.passwordPlaceholder', 'Enter your password')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isLoading}
            required
            className="w-full"
            autoComplete="current-password"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="absolute inset-y-0 right-0 pr-3 flex items-center hover:bg-transparent"
            onClick={() => setShowPassword(!showPassword)}
            id="msp-toggle-password-visibility"
          >
            {showPassword ? (
              <Eye className="h-5 w-5 text-gray-400" />
            ) : (
              <EyeOff className="h-5 w-5 text-gray-400" />
            )}
          </Button>
        </div>
      </div>

      <div className="text-right">
        <Link
          href="/auth/client-portal/forgot-password"
          className="text-sm text-blue-600 hover:text-blue-800 transition-colors"
          {...withDataAutomationId({ id: 'client-forgot-password-link' })}
        >
          {t('auth.forgotPassword', 'Forgot your password?')}
        </Link>
      </div>

      <Button
        id="client-sign-in-button"
        type="submit"
        className="w-full"
        disabled={isLoading}
      >
        {isLoading ? t('auth.signingIn', 'Signing in...') : t('auth.signIn', 'Sign In')}
      </Button>
    </form>
  )
}
