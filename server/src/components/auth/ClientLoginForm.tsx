'use client'

import { signIn } from 'next-auth/react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Label } from '@/components/ui/Label'
import { Alert, AlertDescription } from '@/components/ui/Alert'
import { useState } from 'react'
import Link from 'next/link'

interface ClientLoginFormProps {
  callbackUrl: string;
  onError: (error: string) => void;
  onTwoFactorRequired: () => void;
}

export default function ClientLoginForm({ callbackUrl, onError, onTwoFactorRequired }: ClientLoginFormProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)

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
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
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
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
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
        type="submit"
        className="w-full"
        disabled={isLoading}
      >
        {isLoading ? 'Signing in...' : 'Sign In'}
      </Button>

      <div className="flex justify-between text-sm">
        <Link 
          href="/customer-portal/auth/forgot-password"
          className="text-blue-600 hover:text-blue-800 transition-colors"
        >
          Forgot your password?
        </Link>
        <Link 
          href="/customer-portal/auth/register"
          className="text-blue-600 hover:text-blue-800 transition-colors"
        >
          Register
        </Link>
      </div>
    </form>
  )
}
