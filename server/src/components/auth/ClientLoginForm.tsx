'use client'

import { signIn } from 'next-auth/react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Label } from '@/components/ui/Label'
import { Alert, AlertDescription } from '@/components/ui/Alert'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRegisterUIComponent } from '../../types/ui-reflection/useRegisterUIComponent'
import { FormComponent } from '../../types/ui-reflection/types'
import { withDataAutomationId } from '../../types/ui-reflection/withDataAutomationId'

interface ClientLoginFormProps {
  callbackUrl: string;
  onError: (error: string) => void;
  onTwoFactorRequired: () => void;
  onRegister: () => void;
}

export default function ClientLoginForm({ callbackUrl, onError, onTwoFactorRequired, onRegister }: ClientLoginFormProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  // Register with UI reflection system
  const updateMetadata = useRegisterUIComponent<FormComponent>({
    id: 'client-login-form',
    type: 'form',
    label: 'Client Login',
    fields: [
      {
        id: 'client-email-field',
        type: 'textField',
        label: 'Email',
        value: email,
        required: true
      },
      {
        id: 'client-password-field',
        type: 'textField',
        label: 'Password',
        value: password,
        required: true
      }
    ],
    actions: ['submit']
  });

  // Update metadata when form values change
  useEffect(() => {
    updateMetadata({
      fields: [
        {
          id: 'client-email-field',
          type: 'textField',
          label: 'Email',
          value: email,
          required: true
        },
        {
          id: 'client-password-field',
          type: 'textField',
          label: 'Password',
          value: password,
          required: true
        }
      ]
    });
  }, [email, password, updateMetadata]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true)

    try {
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
        callbackUrl,
      })

      if (result?.error) {
        if (result.error === '2FA_REQUIRED') {
          onTwoFactorRequired();
        } else {
          onError('Invalid email or password')
        }
      } else if (result?.url) {
        window.location.href = result.url
      }
    } catch (error) {
      onError('An error occurred during login')
      console.error('Login error:', error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" {...withDataAutomationId({ id: 'client-login-form' })}>
      <div className="space-y-2">
        <Label htmlFor="client-email-field">Email</Label>
        <Input
          id="client-email-field"
          name="email"
          type="email"
          placeholder="Enter your email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={isLoading}
          required
          className="w-full"
          autoComplete="email"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="client-password-field">Password</Label>
        <Input
          id="client-password-field"
          name="password"
          type="password"
          placeholder="Enter your password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={isLoading}
          required
          className="w-full"
          autoComplete="current-password"
        />
      </div>

      <Button
        id="client-sign-in-button"
        type="submit"
        className="w-full"
        disabled={isLoading}
      >
        {isLoading ? 'Signing in...' : 'Sign In'}
      </Button>

      <div className="flex justify-between text-sm">
        <Link
          href="/client-portal/auth/forgot-password"
          className="text-blue-600 hover:text-blue-800 transition-colors"
          {...withDataAutomationId({ id: 'client-forgot-password-link' })}
        >
          Forgot your password?
        </Link>
        <button
          type="button"
          onClick={onRegister}
          className="text-blue-600 hover:text-blue-800 transition-colors"
          {...withDataAutomationId({ id: 'client-register-button' })}
        >
          Register
        </button>
      </div>
    </form>
  )
}
